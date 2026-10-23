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
const LOGOUT_FLAG_KEY = 'zapmass_logout_flag';
/** Sincroniza logout entre abas (sessionStorage é por aba). */
const LOGOUT_BROADCAST_KEY = 'zapmass_logout_broadcast';

let refreshInFlight: Promise<string | null> | null = null;
let crossTabLogoutBound = false;

/** Auth 100% VPS (Firebase removido do frontend). */
export function useVpsAuth(): boolean {
  return true;
}

export type VpsAuthConfig = {
  ok?: boolean;
  googleLoginEnabled?: boolean;
};

let authConfigCache: { at: number; value: VpsAuthConfig | null } | null = null;
const AUTH_CONFIG_TTL_MS = 60_000;

export async function fetchVpsAuthConfig(): Promise<VpsAuthConfig> {
  const hit = authConfigCache;
  if (hit && Date.now() - hit.at < AUTH_CONFIG_TTL_MS && hit.value) {
    return hit.value;
  }
  try {
    const r = await fetchWithTimeout(apiUrl('/api/auth/config'), {}, 8_000);
    const data = (await r.json().catch(() => ({}))) as VpsAuthConfig;
    authConfigCache = { at: Date.now(), value: data };
    return data;
  } catch {
    return { ok: false, googleLoginEnabled: false };
  }
}

const GOOGLE_OAUTH_AT_STASH = 'zapmass_google_oauth_at';

/** Extrai JWT do fragment `#zapmass_at=…` (evita URLSearchParams truncar valores atípicos). */
export function parseGoogleLoginFragmentAccessToken(raw: string): string | null {
  const trimmed = raw.replace(/^#/, '').trim();
  if (!trimmed) return null;
  const prefix = 'zapmass_at=';
  if (trimmed.startsWith(prefix)) {
    try {
      return decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return new URLSearchParams(trimmed).get('zapmass_at');
}

/** Remove flag de logout local para não bloquear refresh/bootstrap após redirect OAuth. */
export function prepareForGoogleOAuthCallback(): void {
  clearLogoutFlag();
}

/** Lê access token do fragment (#zapmass_at=…) após redirect Google; persiste em sessionStorage (Strict Mode). */
export function consumeGoogleLoginFragmentToken(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#/, '');
  if (raw) {
    const parsed = parseGoogleLoginFragmentAccessToken(raw);
    if (parsed) {
      try {
        sessionStorage.setItem(GOOGLE_OAUTH_AT_STASH, parsed);
      } catch {
        /* ignore */
      }
      const path = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState({}, '', path);
    }
  }
  try {
    return sessionStorage.getItem(GOOGLE_OAUTH_AT_STASH);
  } catch {
    return null;
  }
}

export function clearGoogleLoginFragmentStash(): void {
  try {
    sessionStorage.removeItem(GOOGLE_OAUTH_AT_STASH);
  } catch {
    /* ignore */
  }
}

/** Redireciona o browser para o início do OAuth Google (servidor VPS). */
export function vpsStartGoogleLogin(returnTo?: string): void {
  const q =
    returnTo && returnTo.startsWith('http')
      ? `?returnTo=${encodeURIComponent(returnTo)}`
      : '';
  window.location.assign(apiUrl(`/api/auth/google/start${q}`));
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
  if (isLogoutInProgress()) return;
  clearLogoutFlag();
  sessionStorage.setItem(ACCESS_KEY, accessToken);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearVpsSession(): void {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(USER_KEY);
}

function markLoggedOut(): void {
  const ts = String(Date.now());
  try {
    sessionStorage.setItem(LOGOUT_FLAG_KEY, ts);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(LOGOUT_BROADCAST_KEY, ts);
  } catch {
    /* ignore */
  }
}

function clearLogoutFlag(): void {
  try {
    sessionStorage.removeItem(LOGOUT_FLAG_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LOGOUT_BROADCAST_KEY);
  } catch {
    /* ignore */
  }
}

function isLogoutInProgress(): boolean {
  try {
    if (sessionStorage.getItem(LOGOUT_FLAG_KEY) != null) return true;
    return localStorage.getItem(LOGOUT_BROADCAST_KEY) != null;
  } catch {
    return false;
  }
}

function consumeLogoutFlag(): boolean {
  try {
    const hit = sessionStorage.getItem(LOGOUT_FLAG_KEY);
    if (hit) sessionStorage.removeItem(LOGOUT_FLAG_KEY);
    if (hit) return true;
    const broadcast = localStorage.getItem(LOGOUT_BROADCAST_KEY);
    if (broadcast) {
      sessionStorage.setItem(LOGOUT_FLAG_KEY, broadcast);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Outra aba fez logout — limpa sessão local sem chamar o servidor. */
export function bindCrossTabLogoutSync(): void {
  if (crossTabLogoutBound || typeof window === 'undefined') return;
  if (typeof window.addEventListener !== 'function') return;
  crossTabLogoutBound = true;
  window.addEventListener('storage', (ev) => {
    if (ev.key !== LOGOUT_BROADCAST_KEY || !ev.newValue) return;
    markLoggedOut();
    clearVpsSession();
  });
}

async function parseJson<T>(r: Response): Promise<T & { ok?: boolean; error?: string }> {
  return (await r.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
}

const AUTH_FETCH_TIMEOUT_MS = 25_000;
const PROFILE_FETCH_TIMEOUT_MS = 45_000;
const REFRESH_FETCH_TIMEOUT_MS = 12_000;
const LOGOUT_FETCH_TIMEOUT_MS = 8_000;
const AUTH_TIMEOUT_MESSAGE = 'O servidor demorou para responder. Tente de novo.';

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error(AUTH_TIMEOUT_MESSAGE);
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

async function authFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = AUTH_FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetchWithTimeout(url, init, timeoutMs);
}

export async function vpsRegister(
  email: string,
  password: string,
  displayName?: string
): Promise<VpsAuthUser> {
  const r = await authFetch(apiUrl('/api/auth/register'), {
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
  const r = await authFetch(apiUrl('/api/auth/login'), {
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
  const r = await authFetch(apiUrl('/api/workspace/staff/sign-in'), {
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

async function performRefreshAccessToken(): Promise<string | null> {
  if (consumeLogoutFlag()) {
    clearVpsSession();
    return null;
  }
  const r = await fetchWithTimeout(
    apiUrl('/api/auth/refresh'),
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    },
    REFRESH_FETCH_TIMEOUT_MS
  );
  const data = await parseJson<{ accessToken?: string; user?: VpsAuthUser }>(r);
  if (!r.ok || !data.accessToken) {
    // 5xx/429 = servidor ou banco indisponível (não é sessão inválida): mantém o login local para o
    // próximo retry em vez de deslogar o cliente por um soluço de infraestrutura.
    if (r.status >= 500 || r.status === 429) return null;
    clearVpsSession();
    return null;
  }
  if (isLogoutInProgress()) {
    clearVpsSession();
    return null;
  }
  const prev = getVpsAuthUser();
  const user = data.user || prev;
  if (user) persistSession(data.accessToken, user);
  else if (!isLogoutInProgress()) sessionStorage.setItem(ACCESS_KEY, data.accessToken);
  return data.accessToken;
}

/** Renova access token — pedidos concorrentes partilham a mesma Promise. */
/** Completa login Google quando o refresh cookie falhou mas o callback enviou token no fragment. */
export async function vpsBootstrapSessionFromAccessToken(accessToken: string): Promise<VpsAuthUser | null> {
  if (isLogoutInProgress()) return null;
  sessionStorage.setItem(ACCESS_KEY, accessToken);
  try {
    const r = await fetchWithTimeout(
      apiUrl('/api/auth/me'),
      {
        credentials: 'include',
        headers: { Authorization: `Bearer ${accessToken}` }
      },
      REFRESH_FETCH_TIMEOUT_MS
    );
    const data = await parseJson<{ user?: VpsAuthUser }>(r);
    if (!r.ok || !data.user) {
      clearVpsSession();
      return null;
    }
    persistSession(accessToken, data.user);
    return data.user;
  } catch {
    clearVpsSession();
    return null;
  }
}

/** Após redirect Google: fragment (#zapmass_at) e cookie refresh em paralelo; usa o que concluir com sucesso. */
export async function vpsEstablishSessionAfterGoogleOAuth(
  fragmentToken: string | null
): Promise<string | null> {
  if (isLogoutInProgress()) return null;

  if (!fragmentToken) {
    return vpsRefreshAccessToken();
  }

  const refreshPromise = vpsRefreshAccessToken();
  const bootstrapPromise = vpsBootstrapSessionFromAccessToken(fragmentToken).then((user) =>
    user ? fragmentToken : null
  );

  const firstSuccess = await new Promise<string | null>((resolve) => {
    let pending = 2;
    let settled = false;
    const done = (token: string | null) => {
      if (settled) return;
      if (token) {
        settled = true;
        resolve(token);
        return;
      }
      pending -= 1;
      if (pending === 0) resolve(null);
    };
    void refreshPromise.then(done).catch(() => done(null));
    void bootstrapPromise.then(done).catch(() => done(null));
  });

  if (firstSuccess) return firstSuccess;

  const [refreshToken, bootstrapToken] = await Promise.all([refreshPromise, bootstrapPromise]);
  return refreshToken || bootstrapToken;
}

export async function vpsRefreshAccessToken(): Promise<string | null> {
  bindCrossTabLogoutSync();
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = performRefreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function vpsLogout(): Promise<void> {
  markLoggedOut();
  clearVpsSession();
  try {
    await fetchWithTimeout(
      apiUrl('/api/auth/logout'),
      {
        method: 'POST',
        credentials: 'include'
      },
      LOGOUT_FETCH_TIMEOUT_MS
    );
  } catch {
    /* ignore — sessão local já foi limpa */
  }
}

export async function vpsRequestPasswordReset(
  email: string
): Promise<{ mailerConfigured: boolean; message?: string }> {
  const r = await fetchWithTimeout(
    apiUrl('/api/auth/forgot-password'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() })
    },
    AUTH_FETCH_TIMEOUT_MS
  );
  const data = await parseJson<{ message?: string; mailerConfigured?: boolean }>(r);
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Não foi possível enviar o e-mail de redefinição.');
  }
  return {
    mailerConfigured: data.mailerConfigured !== false,
    message: data.message
  };
}

export async function vpsResetPasswordWithToken(token: string, password: string): Promise<void> {
  const r = await fetchWithTimeout(
    apiUrl('/api/auth/reset-password'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password })
    },
    AUTH_FETCH_TIMEOUT_MS
  );
  const data = await parseJson(r);
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Não foi possível redefinir a senha.');
  }
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

/** Usa token em cache quando ainda válido; só chama refresh se necessário. */
async function resolveAccessTokenForWrite(): Promise<string | null> {
  const cached = getVpsAccessToken();
  if (cached && !accessTokenExpired(cached)) return cached;
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
  const displayNameOnly =
    typeof opts.displayName === 'string' && !opts.photoBase64 && !opts.removePhoto;
  const timeoutMs = displayNameOnly ? PROFILE_FETCH_TIMEOUT_MS : AUTH_FETCH_TIMEOUT_MS;

  const patchProfile = async (token: string): Promise<VpsAuthUser> => {
    const r = await authFetch(
      apiUrl('/api/auth/profile'),
      {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(opts)
      },
      timeoutMs
    );
    const data = await parseJson<{ user?: VpsAuthUser }>(r);
    if (r.status === 401) throw new Error('__AUTH_EXPIRED__');
    if (!r.ok || !data.user) throw new Error(data.error || 'Não foi possível atualizar o perfil.');
    persistVpsAuthUser(data.user);
    return data.user;
  };

  let token = await resolveAccessTokenForWrite();
  if (!token) throw new Error('Sessão expirada.');

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await patchProfile(token);
    } catch (e) {
      if (e instanceof Error && e.message === '__AUTH_EXPIRED__') {
        token = (await vpsRefreshAccessToken()) || '';
        if (!token) throw new Error('Sessão expirada.');
        continue;
      }
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (lastErr.message !== AUTH_TIMEOUT_MESSAGE || attempt === 1) throw lastErr;
    }
  }
  throw lastErr || new Error('Não foi possível atualizar o perfil.');
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
