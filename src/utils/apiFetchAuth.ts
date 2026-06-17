import { apiUrl } from './apiBase';
import { getSessionIdToken } from './sessionAuth';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export type ApiFetchInit = RequestInit & {
  /** Timeout da requisição; padrão 30s. Endpoints pesados (ex.: mapa) podem usar mais. */
  timeoutMs?: number;
};

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

async function fetchWithAbort(url: string, init?: ApiFetchInit): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const { timeoutMs: _ignored, ...fetchInit } = init ?? {};

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
      throw new Error(`Tempo esgotado ao conectar ao servidor (${secs}s). Verifique a conexão.`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Sem conexão com o servidor: ${msg}`);
  } finally {
    clearTimeout(tid);
  }
}

/** GET/POST autenticados com Bearer; caminhos passam por `apiUrl`. Renova token uma vez em 401. */
export async function apiFetchJson<T = Record<string, unknown>>(
  path: string,
  init?: ApiFetchInit,
  retried = false
): Promise<T> {
  const token = await getSessionIdToken(retried);
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  const r = await fetchWithAbort(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {})
    }
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (r.status === 401 && !retried) {
    const refreshed = await getSessionIdToken(true);
    if (refreshed) {
      return apiFetchJson<T>(path, init, true);
    }
    throw new Error('Sessão expirada. Entre novamente.');
  }
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
  return j;
}
