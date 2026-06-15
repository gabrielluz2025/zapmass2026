import { apiUrl } from './apiBase';
import { getSessionIdToken } from './sessionAuth';

const FETCH_TIMEOUT_MS = 30_000;

async function fetchWithAbort(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Tempo esgotado ao conectar ao servidor (30s). Verifique a conexão.');
    }
    // "Failed to fetch" — conexão recusada ou servidor offline
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Sem conexão com o servidor: ${msg}`);
  } finally {
    clearTimeout(tid);
  }
}

/** GET/POST autenticados com Bearer; caminhos passam por `apiUrl`. Renova token uma vez em 401. */
export async function apiFetchJson<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
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
