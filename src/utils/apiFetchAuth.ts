import { getAuth } from 'firebase/auth';
import { apiUrl } from './apiBase';

/** GET/POST autenticados com Bearer; caminhos passam por `apiUrl`. */
export async function apiFetchJson<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const u = getAuth().currentUser;
  if (!u) throw new Error('Sessão expirada. Entre novamente.');
  const token = await u.getIdToken();
  const r = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {})
    }
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
  return j;
}
