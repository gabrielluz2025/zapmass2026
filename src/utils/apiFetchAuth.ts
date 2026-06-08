import { apiUrl } from './apiBase';
import { getSessionIdToken } from './sessionAuth';
import { useVpsAuth } from '../services/vpsAuth';

/** GET/POST autenticados com Bearer; caminhos passam por `apiUrl`. Renova token uma vez em 401. */
export async function apiFetchJson<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
  retried = false
): Promise<T> {
  const token = await getSessionIdToken(retried);
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  const r = await fetch(apiUrl(path), {
    ...init,
    credentials: useVpsAuth() ? 'include' : init?.credentials,
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
  }
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
  return j;
}
