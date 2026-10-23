import { createHash, randomBytes } from 'crypto';
import type { Express, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getZapmassPool } from '../db/postgres.js';
import { authGoogleOAuthLimiter } from '../httpRateLimit.js';
import { notifyAdminsNewAccountRegistered } from '../adminNewSignupNotify.js';
import { issueVpsSession } from './vpsSession.js';
import {
  createUserFromGoogle,
  findUserByEmail,
  findUserByGoogleSub,
  linkGoogleSubToUser,
  type UserRow
} from './userRepository.js';
import { vpsAuthCookieBaseFlags } from './authCookieDomain.js';
import { getSurveyLinksBaseOrigin } from '../publicSurveyAppOrigin.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const OAUTH_STATE_COOKIE = 'zapmass_google_state';
const OAUTH_PKCE_COOKIE = 'zapmass_google_pkce';
const OAUTH_RETURN_COOKIE = 'zapmass_google_return';

const OAUTH_COOKIE_MAX_AGE_SEC = 600;

export type GoogleOAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleIdClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

function truthyEnv(v: string | undefined): boolean {
  if (!v) return false;
  const n = v.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes' || n === 'on';
}

let loggedInvalidGoogleSecret = false;

/** Client secret must be GOCSPX-… from GCP, never the Client ID string. */
export function isInvalidGoogleOAuthClientSecret(clientId: string, clientSecret: string): boolean {
  if (clientSecret === clientId) return true;
  if (clientSecret.includes('.apps.googleusercontent.com')) return true;
  return false;
}

export function readGoogleOAuthEnv(): GoogleOAuthEnv | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  if (isInvalidGoogleOAuthClientSecret(clientId, clientSecret)) {
    if (!loggedInvalidGoogleSecret) {
      loggedInvalidGoogleSecret = true;
      console.error(
        '[googleOAuth] GOOGLE_OAUTH_CLIENT_SECRET inválido: use o Client secret (GOCSPX-…) do Google Cloud, não o Client ID (*.apps.googleusercontent.com).'
      );
    }
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleLoginEnabled(): boolean {
  if (!truthyEnv(process.env.ZAPMASS_GOOGLE_LOGIN)) return false;
  return readGoogleOAuthEnv() != null;
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildGoogleAuthorizationUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}): string {
  const scopes = opts.scopes ?? ['openid', 'email', 'profile'];
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('state', opts.state);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

export function parseGoogleIdTokenPayload(payload: JWTPayload): GoogleIdClaims | null {
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const emailVerified =
    payload.email_verified === true || String(payload.email_verified) === 'true';
  if (!sub || !email.includes('@')) return null;
  const name = typeof payload.name === 'string' ? payload.name : undefined;
  const picture = typeof payload.picture === 'string' ? payload.picture : undefined;
  return { sub, email, emailVerified, name, picture };
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string
): Promise<GoogleIdClaims | null> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId
  });
  return parseGoogleIdTokenPayload(payload);
}

function oauthCookieFlags(): string {
  return vpsAuthCookieBaseFlags();
}

function setOAuthCookie(res: Response, name: string, value: string): void {
  res.append(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Max-Age=${OAUTH_COOKIE_MAX_AGE_SEC}; ${oauthCookieFlags()}`
  );
}

function clearOAuthCookies(res: Response): void {
  const clear = `Max-Age=0; ${oauthCookieFlags()}`;
  for (const name of [OAUTH_STATE_COOKIE, OAUTH_PKCE_COOKIE, OAUTH_RETURN_COOKIE]) {
    res.append('Set-Cookie', `${name}=; ${clear}`);
  }
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return rest.join('=');
      }
    }
  }
  return null;
}

function defaultAppOrigin(): string {
  const explicit = process.env.GOOGLE_OAUTH_APP_REDIRECT_URI?.trim();
  if (explicit) {
    try {
      const u = new URL(explicit);
      return u.origin;
    } catch {
      /* ignore */
    }
  }
  const fromPublic = getSurveyLinksBaseOrigin();
  if (fromPublic) {
    try {
      return new URL(fromPublic).origin;
    } catch {
      /* ignore */
    }
  }
  return 'http://localhost:8000';
}

/** Evita cookie de sessão no apex e SPA no www (ou vice-versa) após o callback Google. */
export function alignOAuthReturnToHost(returnTo: string, oauthRedirectUri: string): string {
  let cbOrigin: string;
  try {
    cbOrigin = new URL(oauthRedirectUri).origin;
  } catch {
    return returnTo;
  }
  try {
    const u = new URL(returnTo);
    if (u.origin === cbOrigin) return returnTo;
    const stripWww = (h: string) => h.replace(/^www\./i, '');
    if (stripWww(u.hostname) !== stripWww(new URL(cbOrigin).hostname)) return returnTo;
    const aligned = new URL(returnTo);
    const cb = new URL(cbOrigin);
    aligned.protocol = cb.protocol;
    aligned.host = cb.host;
    return aligned.toString();
  } catch {
    return returnTo;
  }
}

function sanitizeReturnTo(raw: string | undefined): string {
  const fallback = `${defaultAppOrigin()}/`;
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    const allowed = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.length === 0) return fallback;
    const ok = allowed.some((origin) => {
      try {
        return new URL(origin).origin === u.origin;
      } catch {
        return false;
      }
    });
    return ok ? u.toString() : fallback;
  } catch {
    return fallback;
  }
}

function redirectWithError(res: Response, returnTo: string, code: string): void {
  clearOAuthCookies(res);
  const u = new URL(returnTo);
  u.searchParams.set('google_login', 'error');
  u.searchParams.set('google_error', code);
  res.redirect(302, u.toString());
}

function redirectSuccess(res: Response, returnTo: string, accessToken?: string): void {
  clearOAuthCookies(res);
  const u = new URL(returnTo);
  u.searchParams.set('google_login', '1');
  if (accessToken) {
    u.hash = `zapmass_at=${encodeURIComponent(accessToken)}`;
  }
  res.redirect(302, u.toString());
}

async function exchangeCodeForTokens(
  env: GoogleOAuthEnv,
  code: string,
  codeVerifier: string
): Promise<{ id_token?: string }> {
  const body = new URLSearchParams({
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier
  });
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!r.ok || !data.id_token) {
    throw new Error(data.error || 'TOKEN_EXCHANGE_FAILED');
  }
  return data;
}

async function resolveOrCreateUser(claims: GoogleIdClaims): Promise<{ user: UserRow; isNew: boolean }> {
  if (!claims.emailVerified) {
    throw new Error('EMAIL_NOT_VERIFIED');
  }

  const bySub = await findUserByGoogleSub(claims.sub);
  if (bySub) {
    if (bySub.disabled_at) throw new Error('ACCOUNT_DISABLED');
    return { user: bySub, isNew: false };
  }

  const byEmail = await findUserByEmail(claims.email);
  if (byEmail) {
    if (byEmail.disabled_at) throw new Error('ACCOUNT_DISABLED');
    const linked = await linkGoogleSubToUser(byEmail.id, claims.sub, {
      displayName: claims.name,
      photoUrl: claims.picture
    });
    return { user: linked, isNew: false };
  }

  const created = await createUserFromGoogle({
    email: claims.email,
    googleSub: claims.sub,
    displayName: claims.name,
    photoUrl: claims.picture
  });
  return { user: created, isNew: true };
}

export function registerGoogleOAuthRoutes(app: Express): void {
  app.get('/api/auth/google/start', authGoogleOAuthLimiter, (req: Request, res: Response) => {
    const env = readGoogleOAuthEnv();
    if (!isGoogleLoginEnabled() || !env) {
      return res.status(503).json({ ok: false, error: 'Login com Google não está disponível.' });
    }
    if (!getZapmassPool()) {
      return res.status(503).json({ ok: false, error: 'Postgres ZapMass não disponível.' });
    }

    const state = base64Url(randomBytes(24));
    const { verifier, challenge } = generatePkcePair();
    let returnTo = sanitizeReturnTo(
      typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined
    );
    returnTo = alignOAuthReturnToHost(returnTo, env.redirectUri);

    setOAuthCookie(res, OAUTH_STATE_COOKIE, state);
    setOAuthCookie(res, OAUTH_PKCE_COOKIE, verifier);
    setOAuthCookie(res, OAUTH_RETURN_COOKIE, returnTo);

    const url = buildGoogleAuthorizationUrl({
      clientId: env.clientId,
      redirectUri: env.redirectUri,
      state,
      codeChallenge: challenge
    });
    res.redirect(302, url);
  });

  app.get('/api/auth/google/callback', authGoogleOAuthLimiter, async (req: Request, res: Response) => {
    const env = readGoogleOAuthEnv();
    let returnTo = sanitizeReturnTo(readCookie(req, OAUTH_RETURN_COOKIE) || undefined);

    if (!isGoogleLoginEnabled() || !env) {
      return redirectWithError(res, returnTo, 'disabled');
    }
    returnTo = alignOAuthReturnToHost(returnTo, env.redirectUri);
    if (!getZapmassPool()) {
      return redirectWithError(res, returnTo, 'postgres');
    }

    const err = typeof req.query.error === 'string' ? req.query.error : null;
    if (err) {
      return redirectWithError(res, returnTo, err === 'access_denied' ? 'cancelled' : 'oauth');
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const savedState = readCookie(req, OAUTH_STATE_COOKIE);
    const verifier = readCookie(req, OAUTH_PKCE_COOKIE);

    if (!code || !state || !savedState || state !== savedState || !verifier) {
      return redirectWithError(res, returnTo, 'state');
    }

    try {
      const tokens = await exchangeCodeForTokens(env, code, verifier);
      const idClaims = await verifyGoogleIdToken(tokens.id_token!, env.clientId);
      if (!idClaims) {
        return redirectWithError(res, returnTo, 'token');
      }

      const { user, isNew } = await resolveOrCreateUser(idClaims);
      const session = await issueVpsSession(res, {
        sub: user.id,
        email: user.email,
        role: 'owner',
        tenantUid: user.id
      });

      if (isNew) {
        void notifyAdminsNewAccountRegistered(user.id);
      }

      redirectSuccess(res, returnTo, session.accessToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[auth/google/callback]', msg);
      const codeMap: Record<string, string> = {
        EMAIL_NOT_VERIFIED: 'email_unverified',
        ACCOUNT_DISABLED: 'disabled_account',
        GOOGLE_SUB_CONFLICT: 'link_conflict',
        POSTGRES_UNAVAILABLE: 'postgres'
      };
      redirectWithError(res, returnTo, codeMap[msg] || 'failed');
    }
  });
}
