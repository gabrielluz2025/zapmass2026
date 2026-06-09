import type { Express, Request, Response } from 'express';
import { getZapmassPool } from './db/postgres.js';
import { vpsAuthEnabled } from './auth/authMode.js';
import {
  createUserWithPassword,
  findUserByEmail,
  findUserById,
  insertRefreshToken,
  revokeRefreshTokenHash,
  findValidRefreshToken,
  verifyUserPassword
} from './auth/userRepository.js';
import {
  accessTokenTtlSec,
  hashRefreshToken,
  newRefreshTokenPlain,
  refreshTokenTtlMs,
  signAccessToken
} from './auth/jwt.js';
import { authRegisterLimiter, authLoginLimiter, authEmailStepLimiter } from './httpRateLimit.js';
import { parseBearer, resolveAuthPrincipal } from './resolveAuth.js';

const REFRESH_COOKIE = 'zapmass_refresh';

function readRefreshCookie(req: Request): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === REFRESH_COOKIE) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return rest.join('=');
      }
    }
  }
  return null;
}

function setRefreshCookie(res: Response, value: string, maxAgeMs: number): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${REFRESH_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`
  );
}

function clearRefreshCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${REFRESH_COOKIE}=; Path=/api/auth; HttpOnly; Max-Age=0`);
}

async function issueSession(
  res: Response,
  claims: {
    sub: string;
    email: string;
    role: 'owner' | 'staff';
    tenantUid: string;
    ownerUid?: string;
  }
): Promise<{ accessToken: string; expiresIn: number }> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');

  const accessToken = await signAccessToken({
    sub: claims.sub,
    email: claims.email,
    role: claims.role,
    tenantUid: claims.tenantUid,
    ownerUid: claims.ownerUid
  });

  const refreshPlain = newRefreshTokenPlain();
  const tokenHash = hashRefreshToken(refreshPlain);
  const expiresAt = new Date(Date.now() + refreshTokenTtlMs());

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertRefreshToken(client, {
      subjectId: claims.sub,
      tokenHash,
      role: claims.role,
      ownerUserId: claims.role === 'staff' ? claims.tenantUid : null,
      expiresAt
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  setRefreshCookie(res, refreshPlain, refreshTokenTtlMs());
  return { accessToken, expiresIn: accessTokenTtlSec() };
}

export function registerVpsAuthRoutes(app: Express): void {
  if (!vpsAuthEnabled()) return;

  app.get('/api/auth/config', (_req, res) => {
    res.json({
      ok: true,
      authProvider: process.env.ZAPMASS_AUTH_PROVIDER || 'firebase',
      dataProvider: process.env.ZAPMASS_DATA_PROVIDER || 'auto',
      postgres: !!getZapmassPool()
    });
  });

  app.post('/api/auth/email-step', authEmailStepLimiter, async (req: Request, res: Response) => {
    if (!getZapmassPool()) {
      return res.status(503).json({ ok: false, error: 'Postgres ZapMass não disponível.' });
    }
    const body = req.body as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!email.includes('@')) {
      return res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });
    }
    const existing = await findUserByEmail(email);
    return res.json({
      ok: true,
      step: existing && !existing.disabled_at ? 'sign-in' : 'sign-up'
    });
  });

  app.post('/api/auth/register', authRegisterLimiter, async (req: Request, res: Response) => {
    if (!getZapmassPool()) {
      return res.status(503).json({ ok: false, error: 'Postgres ZapMass não disponível.' });
    }
    const body = req.body as { email?: unknown; password?: unknown; displayName?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (!email.includes('@') || password.length < 8) {
      return res.status(400).json({ ok: false, error: 'E-mail válido e senha com mínimo 8 caracteres.' });
    }
    try {
      const existing = await findUserByEmail(email);
      if (existing) {
        return res.status(400).json({ ok: false, error: 'Este e-mail já está registado. Entre com a senha.' });
      }
      const user = await createUserWithPassword(email, password, displayName || undefined);
      const session = await issueSession(res, {
        sub: user.id,
        email: user.email,
        role: 'owner',
        tenantUid: user.id
      });
      return res.json({
        ok: true,
        authProvider: 'vps',
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: 'owner',
          tenantUid: user.id
        },
        ...session
      });
    } catch (e) {
      console.error('[auth/register]', e);
      return res.status(400).json({ ok: false, error: 'Não foi possível criar a conta.' });
    }
  });

  app.post('/api/auth/login', authLoginLimiter, async (req: Request, res: Response) => {
    if (!getZapmassPool()) {
      return res.status(503).json({ ok: false, error: 'Postgres ZapMass não disponível.' });
    }
    const body = req.body as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email.includes('@') || !password) {
      return res.status(400).json({ ok: false, error: 'Informe e-mail e senha.' });
    }
    const user = await findUserByEmail(email);
    if (!user || !(await verifyUserPassword(user, password))) {
      return res.status(401).json({ ok: false, error: 'E-mail ou senha incorretos.' });
    }
    try {
      const session = await issueSession(res, {
        sub: user.id,
        email: user.email,
        role: 'owner',
        tenantUid: user.id
      });
      return res.json({
        ok: true,
        authProvider: 'vps',
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: 'owner',
          tenantUid: user.id
        },
        ...session
      });
    } catch (e) {
      console.error('[auth/login]', e);
      return res.status(500).json({ ok: false, error: 'Falha ao iniciar sessão.' });
    }
  });

  app.post('/api/auth/refresh', async (req: Request, res: Response) => {
    if (!getZapmassPool()) {
      return res.status(503).json({ ok: false, error: 'Postgres indisponível.' });
    }
    const plain =
      readRefreshCookie(req) ||
      (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null);
    if (!plain) {
      return res.status(401).json({ ok: false, error: 'Sessão expirada.' });
    }
    const row = await findValidRefreshToken(hashRefreshToken(plain));
    if (!row) {
      return res.status(401).json({ ok: false, error: 'Sessão inválida ou expirada.' });
    }
    await revokeRefreshTokenHash(hashRefreshToken(plain));

    if (row.role === 'staff') {
      const owner = row.owner_user_id ? await findUserById(row.owner_user_id) : null;
      const session = await issueSession(res, {
        sub: row.subject_id,
        email: owner?.email || '',
        role: 'staff',
        tenantUid: row.owner_user_id || row.subject_id,
        ownerUid: row.owner_user_id || undefined
      });
      return res.json({ ok: true, authProvider: 'vps', role: 'staff', ...session });
    }

    const user = await findUserById(row.subject_id);
    if (!user || user.disabled_at) {
      return res.status(401).json({ ok: false, error: 'Conta desativada.' });
    }
    const session = await issueSession(res, {
      sub: user.id,
      email: user.email,
      role: 'owner',
      tenantUid: user.id
    });
    return res.json({
      ok: true,
      authProvider: 'vps',
      user: { id: user.id, email: user.email, displayName: user.display_name, role: 'owner' },
      ...session
    });
  });

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    const plain = readRefreshCookie(req);
    if (plain) await revokeRefreshTokenHash(hashRefreshToken(plain));
    clearRefreshCookie(res);
    return res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const principal = await resolveAuthPrincipal(parseBearer(req));
    if (!principal || principal.provider !== 'vps') {
      return res.status(401).json({ ok: false, error: 'Não autenticado.' });
    }
    return res.json({
      ok: true,
      user: {
        id: principal.authUid,
        email: principal.email,
        role: principal.role,
        tenantUid: principal.tenantUid,
        ownerUid: principal.ownerUid
      }
    });
  });

}

