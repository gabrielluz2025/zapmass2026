import { apiUrl } from './apiBase';
import { getSessionIdToken } from './sessionAuth';

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

/** GET/POST autenticados com Bearer; caminhos passam por `apiUrl`. Renova token uma vez em 401. */
export async function apiFetchJson<T = Record<string, unknown>>(
  path: string,
  init?: ApiFetchInit,
  retried = false
): Promise<T> {
  const token = await getSessionIdToken(retried);
  if (!token) throw new Error('Sessão expirada. Entre novamente.');

  const method = methodOf(init);
  const extraRetries = init?.retries ?? (method === 'GET' || method === 'HEAD' ? 1 : 0);

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
      const j = (await r.json().catch(() => ({}))) as T & { error?: string };
      if (r.status === 401 && !retried) {
        const refreshed = await getSessionIdToken(true);
        if (refreshed) {
          return apiFetchJson<T>(path, init, true);
        }
        throw new Error('Sessão expirada. Entre novamente.');
      }
      if (!r.ok) {
        const transient = r.status === 502 || r.status === 503 || r.status === 504;
        if (transient && attempt < extraRetries) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw new Error(j.error || `Erro HTTP ${r.status}`);
      }
      return j;
    } catch (err) {
      lastErr = err;
      const timeout = isApiTimeoutError(err);
      const net = err instanceof Error && err.message.startsWith('Sem conexão');
      if (attempt < extraRetries && (timeout || net)) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Falha ao contactar o servidor.');
}
