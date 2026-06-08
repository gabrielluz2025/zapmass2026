import { apiUrl } from '../utils/apiBase';

export type VpsAuthUser = {
  id: string;
  email: string;
  displayName?: string | null;
  role: 'owner' | 'staff';
  tenantUid?: string;
  ownerUid?: string;
};

const ACCESS_KEY = 'zapmass_access_token';
const USER_KEY = 'zapmass_auth_user';

/** Padrão: auth VPS. Desligar só com VITE_USE_VPS_AUTH=false no build/.env. */
export function useVpsAuth(): boolean {
  return import.meta.env.VITE_USE_VPS_AUTH !== 'false';
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
