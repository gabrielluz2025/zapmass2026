import { apiUrl } from './apiBase';
import { getSessionIdToken } from './sessionAuth';
import { getVpsAccessToken, vpsProbeAccessToken } from '../services/vpsAuth';
import {
  SubscriptionRequiredError,
  emitSubscriptionRequired,
  formatSubscriptionRequiredMessage,
  isSubscriptionRequiredHttpPayload,
} from './subscriptionRequiredFlow';
import { ApiForbiddenError, SESSION_EXPIRED_MESSAGE } from './sessionExpiryFlow';

export { SESSION_EXPIRED_MESSAGE, ApiForbiddenError, isSessionExpiredMessage } from './sessionExpiryFlow';

export { isSubscriptionRequiredError, SubscriptionRequiredError } from './subscriptionRequiredFlow';

const DEFAULT_FETCH_TIMEOUT_MS = 18_000;

export type ApiFetchInit = RequestInit & {
  /** Timeout da requisição; padrão 18s. Endpoints pesados podem usar mais. */
  timeoutMs?: number;
  /** Tentativas extras após timeout/rede (GET por padrão 1). */
  retries?: number;
};

export function isApiTimeoutError(err: unknown): boolean {
  return err instanceof Error && /Tempo esgotado ao (conectar|falar) com o servidor/i.test(err.message);
}

export function isApiNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.startsWith('Sem conexão') ||
    /Failed to fetch/i.test(err.message) ||
    /NetworkError|Load failed|ERR_CONNECTION|ECONNRESET/i.test(err.message)
  );
}

/** Nginx/API a reiniciar — 502/503/504 não são erro de negócio. */
export function isApiHttpTransientError(err: unknown): boolean {
  return err instanceof Error && /Erro HTTP 50[234]\b/.test(err.message);
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') {
    return anyFn(signals);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

function methodOf(init?: ApiFetchInit): string {
  return String(init?.method || 'GET').toUpperCase();
}

async function fetchWithAbort(url: string, init?: ApiFetchInit): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const { timeoutMs: _ignored, retries: _retries, ...fetchInit } = init ?? {};

  const timeoutController = new AbortController();
  const tid = setTimeout(() => timeoutController.abort(), timeoutMs);

  const externalSignal = fetchInit.signal;
  const signal =
    externalSignal != null
      ? mergeAbortSignals([timeoutController.signal, externalSignal])
      : timeoutController.signal;

  try {
    return await fetch(url, { ...fetchInit, signal });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      const secs = Math.round(timeoutMs / 1000);
      throw new Error(`Tempo esgotado ao falar com o servidor (${secs}s). Tente de novo.`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Sem conexão com o servidor: ${msg}`);
  } finally {
    clearTimeout(tid);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Evita rotação dupla do refresh cookie quando vários `apiFetchJson` recebem 401 em paralelo. */
let refreshAfter401InFlight: Promise<string | null> | null = null;

async function refreshSessionAfter401(): Promise<string | null> {
  if (refreshAfter401InFlight) return refreshAfter401InFlight;
  refreshAfter401InFlight = getSessionIdToken(true).finally(() => {
    refreshAfter401InFlight = null;
  });
  return refreshAfter401InFlight;
}

async function sessionStillAlive(): Promise<boolean> {
  const cached = getVpsAccessToken();
  if (!cached) return false;
  return vpsProbeAccessToken(cached);
}

async function throwIfSessionDead(fallbackError?: string): Promise<never> {
  if (await sessionStillAlive()) {
    throw new Error(fallbackError || 'Não autorizado.');
  }
  throw new Error(SESSION_EXPIRED_MESSAGE);
}

/** GET/POST autenticados com Bearer; caminhos passam por `apiUrl`. Renova token uma vez em 401. */
export async function apiFetchJson<T = Record<string, unknown>>(
  path: string,
  init?: ApiFetchInit,
  retried = false
): Promise<T> {
  // Após 401, o token já foi renovado — usar cache (nunca forçar 2.º refresh em paralelo).
  const token = await getSessionIdToken(false);
  if (!token) {
    await throwIfSessionDead();
  }

  const method = methodOf(init);
  const extraRetries = init?.retries ?? (method === 'GET' || method === 'HEAD' ? 4 : 0);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= extraRetries; attempt++) {
    try {
      const r = await fetchWithAbort(apiUrl(path), {
        ...init,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers || {}),
        },
      });
      const j = (await r.json().catch(() => ({}))) as T & { error?: string; code?: string };
      if (r.status === 403) {
        throw new ApiForbiddenError(
          typeof j.error === 'string' && j.error.trim() ? j.error : 'Sem permissão para esta ação.'
        );
      }
      if (r.status === 401 && !retried) {
        const refreshed = await refreshSessionAfter401();
        if (refreshed) {
          return apiFetchJson<T>(path, init, true);
        }
        const apiMsg = typeof j.error === 'string' && j.error.trim() ? j.error : undefined;
        await throwIfSessionDead(apiMsg);
      }
      if (isSubscriptionRequiredHttpPayload(r.status, j)) {
        const msg = formatSubscriptionRequiredMessage(j.error);
        emitSubscriptionRequired(msg);
        throw new SubscriptionRequiredError(msg);
      }
      if (!r.ok) {
        const transient = r.status === 502 || r.status === 503 || r.status === 504;
        if (transient && attempt < extraRetries) {
          await sleep(Math.min(8_000, 600 * 2 ** attempt));
          continue;
        }
        throw new Error(j.error || `Erro HTTP ${r.status}`);
      }
      return j;
    } catch (err) {
      lastErr = err;
      const timeout = isApiTimeoutError(err);
      const net = isApiNetworkError(err);
      const httpTransient = isApiHttpTransientError(err);
      if (attempt < extraRetries && (timeout || net || httpTransient)) {
        await sleep(Math.min(8_000, 600 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Falha ao contactar o servidor.');
}
