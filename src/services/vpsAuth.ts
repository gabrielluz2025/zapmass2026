import { apiUrl } from '../utils/apiBase';

export type VpsAuthUser = {
  id: string;
  email: string;
  displayName?: string | null;
  photoUrl?: string | null;
  role: 'owner' | 'staff';
  tenantUid?: string;
  ownerUid?: string;
  loginSlug?: string;
};

const ACCESS_KEY = 'zapmass_access_token';
const USER_KEY = 'zapmass_auth_user';

/** Auth 100% VPS (Firebase removido do frontend). */
export function useVpsAuth(): boolean {
  return true;
}

export function getVpsAccessToken(): string | null {
  try {
    return sessionStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

export function getVpsAuthUser(): VpsAuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as VpsAuthUser;
  } catch {
    return null;
  }
}

function persistSession(accessToken: string, user: VpsAuthUser): void {
  sessionStorage.setItem(ACCESS_KEY, accessToken);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearVpsSession(): void {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(USER_KEY);
}

async function parseJson<T>(r: Response): Promise<T & { ok?: boolean; error?: string }> {
  return (await r.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
}

const AUTH_FETCH_TIMEOUT_MS = 25_000;

async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), AUTH_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('O servidor demorou para responder. Tente de novo.');
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function vpsRegister(
  email: string,
  password: string,
  displayName?: string
): Promise<VpsAuthUser> {
  const r = await fetch(apiUrl('/api/auth/register'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName })
  });
  const data = await parseJson<{
    accessToken?: string;
    user?: VpsAuthUser;
  }>(r);
  if (!r.ok || !data.accessToken || !data.user) {
    throw new Error(data.error || 'Não foi possível criar a conta.');
  }
  persistSession(data.accessToken, data.user);
  return data.user;
}

export async function vpsLogin(email: string, password: string): Promise<VpsAuthUser> {
  const r = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await parseJson<{
    accessToken?: string;
    user?: VpsAuthUser;
  }>(r);
  if (!r.ok || !data.accessToken || !data.user) {
    throw new Error(data.error || 'E-mail ou senha incorretos.');
  }
  persistSession(data.accessToken, data.user);
  return data.user;
}

export async function vpsStaffLogin(
  managerEmail: string,
  loginName: string,
  password: string
): Promise<VpsAuthUser> {
  const r = await fetch(apiUrl('/api/workspace/staff/sign-in'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ managerEmail, loginName, password })
  });
  const data = await parseJson<{
    accessToken?: string;
    user?: VpsAuthUser;
    authProvider?: string;
  }>(r);
  if (!r.ok || !data.accessToken || !data.user) {
    throw new Error(data.error || 'Não foi possível entrar.');
  }
  persistSession(data.accessToken, data.user);
  return data.user;
}

export async function vpsRefreshAccessToken(): Promise<string | null> {
  const r = await fetch(apiUrl('/api/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const data = await parseJson<{ accessToken?: string; user?: VpsAuthUser }>(r);
  if (!r.ok || !data.accessToken) {
    clearVpsSession();
    return null;
  }
  const prev = getVpsAuthUser();
  const user = data.user || prev;
  if (user) persistSession(data.accessToken, user);
  else sessionStorage.setItem(ACCESS_KEY, data.accessToken);
  return data.accessToken;
}

export async function vpsLogout(): Promise<void> {
  try {
    await fetch(apiUrl('/api/auth/logout'), {
      method: 'POST',
      credentials: 'include'
    });
  } catch {
    /* ignore */
  }
  clearVpsSession();
}

function accessTokenExpired(token: string, skewSec = 60): boolean {
  try {
    const part = token.split('.')[1];
    if (!part) return true;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    if (typeof payload.exp !== 'number') return true;
    return Date.now() / 1000 >= payload.exp - skewSec;
  } catch {
    return true;
  }
}

export async function vpsGetAccessToken(): Promise<string | null> {
  const t = getVpsAccessToken();
  if (t && !accessTokenExpired(t)) return t;
  return vpsRefreshAccessToken();
}

export function patchVpsAuthUser(patch: Partial<VpsAuthUser>): VpsAuthUser | null {
  const prev = getVpsAuthUser();
  if (!prev) return null;
  const next = { ...prev, ...patch };
  sessionStorage.setItem(USER_KEY, JSON.stringify(next));
  return next;
}

export function persistVpsAuthUser(user: VpsAuthUser): void {
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function vpsFetchMe(): Promise<VpsAuthUser> {
  const token = await vpsGetAccessToken();
  if (!token) throw new Error('Sessão expirada.');
  const r = await authFetch(apiUrl('/api/auth/me'), {
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await parseJson<{ user?: VpsAuthUser }>(r);
  if (!r.ok || !data.user) throw new Error(data.error || 'Não foi possível carregar o perfil.');
  const accessToken = getVpsAccessToken();
  if (accessToken) persistSession(accessToken, data.user);
  else patchVpsAuthUser(data.user);
  return data.user;
}

export async function vpsUpdateProfile(opts: {
  displayName?: string;
  photoBase64?: string;
  removePhoto?: boolean;
}): Promise<VpsAuthUser> {
  const token = await vpsGetAccessToken();
  if (!token) throw new Error('Sessão expirada.');
  const r = await authFetch(apiUrl('/api/auth/profile'), {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(opts)
  });
  const data = await parseJson<{ user?: VpsAuthUser }>(r);
  if (!r.ok || !data.user) throw new Error(data.error || 'Não foi possível atualizar o perfil.');
  persistVpsAuthUser(data.user);
  return data.user;
}

export async function vpsChangeEmail(newEmail: string, currentPassword: string): Promise<VpsAuthUser> {
  const token = await vpsGetAccessToken();
  if (!token) throw new Error('Sessão expirada.');
  const r = await fetch(apiUrl('/api/auth/email'), {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ newEmail, currentPassword })
  });
  const data = await parseJson<{ user?: VpsAuthUser; accessToken?: string }>(r);
  if (!r.ok || !data.user) throw new Error(data.error || 'Não foi possível alterar o e-mail.');
  if (data.accessToken) persistSession(data.accessToken, data.user);
  else patchVpsAuthUser(data.user);
  return data.user;
}

export async function vpsChangePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const token = await vpsGetAccessToken();
  if (!token) throw new Error('Sessão expirada.');
  const r = await fetch(apiUrl('/api/auth/password'), {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  const data = await parseJson(r);
  if (!r.ok) throw new Error(data.error || 'Não foi possível alterar a senha.');
}
