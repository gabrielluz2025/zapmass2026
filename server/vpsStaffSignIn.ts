import type { Request, Response } from 'express';
import { getZapmassPool } from './db/postgres.js';
import { vpsAuthEnabled } from './auth/authMode.js';
import { staffSignInByManagerEmail } from './auth/staffRepository.js';
import { sanitizeLoginSlug } from './workspaceStaffPasswordRoutes.js';
import {
  accessTokenTtlSec,
  hashRefreshToken,
  newRefreshTokenPlain,
  refreshTokenTtlMs,
  signAccessToken
} from './auth/jwt.js';
import { insertRefreshToken } from './auth/userRepository.js';

const REFRESH_COOKIE = 'zapmass_refresh';

function setRefreshCookie(res: Response, value: string, maxAgeMs: number): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${REFRESH_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`
  );
}

const STAFF_ERRORS: Record<string, string> = {
  MANAGER_NOT_FOUND: 'E-mail do gestor não encontrado.',
  MANAGER_DISABLED: 'Conta do gestor desativada.',
  STAFF_NOT_FOUND: 'Nome de usuário não encontrado nesta conta.',
  STAFF_REVOKED: 'Este acesso foi revogado.',
  WRONG_PASSWORD: 'Senha incorreta.'
};

/** @returns true se a resposta já foi enviada (fluxo VPS). */
export async function tryVpsStaffSignIn(req: Request, res: Response): Promise<boolean> {
  if (!vpsAuthEnabled() || !getZapmassPool()) return false;

  const body = req.body as { managerEmail?: unknown; loginName?: unknown; password?: unknown };
  const managerEmail =
    typeof body.managerEmail === 'string' ? body.managerEmail.trim().toLowerCase() : '';
  const loginName = typeof body.loginName === 'string' ? body.loginName : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const slug = sanitizeLoginSlug(loginName);
  if (!managerEmail || !managerEmail.includes('@') || !slug || password.length < 8) {
    res.status(400).json({
      ok: false,
      error: 'Informe o e-mail do gestor, o nome de usuário e a senha (mínimo 8 caracteres).'
    });
    return true;
  }

  const result = await staffSignInByManagerEmail(managerEmail, slug, password);
  if (result.ok === false) {
    res.status(401).json({
      ok: false,
      error: STAFF_ERRORS[result.code] || 'Não foi possível entrar.'
    });
    return true;
  }

  try {
    const pool = getZapmassPool()!;
    const accessToken = await signAccessToken({
      sub: result.member.id,
      email: result.ownerEmail,
      role: 'staff',
      tenantUid: result.ownerUserId,
      ownerUid: result.ownerUserId
    });
    const refreshPlain = newRefreshTokenPlain();
    const tokenHash = hashRefreshToken(refreshPlain);
    const expiresAt = new Date(Date.now() + refreshTokenTtlMs());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await insertRefreshToken(client, {
        subjectId: result.member.id,
        tokenHash,
        role: 'staff',
        ownerUserId: result.ownerUserId,
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
    res.json({
      ok: true,
      authProvider: 'vps',
      accessToken,
      expiresIn: accessTokenTtlSec(),
      user: {
        id: result.member.id,
        email: result.ownerEmail,
        displayName: result.member.display_name,
        photoUrl: result.member.photo_url || null,
        role: 'staff',
        tenantUid: result.ownerUserId,
        ownerUid: result.ownerUserId
      }
    });
    return true;
  } catch (e) {
    console.error('[vpsStaffSignIn]', e);
    res.status(500).json({ ok: false, error: 'Falha ao iniciar sessão.' });
    return true;
  }
}
