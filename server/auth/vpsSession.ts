import type { Request, Response } from 'express';
import { getZapmassPool } from '../db/postgres.js';
import {
  accessTokenTtlSec,
  hashRefreshToken,
  newRefreshTokenPlain,
  refreshTokenTtlMs,
  signAccessToken
} from './jwt.js';
import { insertRefreshToken } from './userRepository.js';
import { vpsAuthCookieBaseFlags } from './authCookieDomain.js';

export const REFRESH_COOKIE = 'zapmass_refresh';

export function readRefreshCookie(req: Request): string | null {
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

export function setRefreshCookie(res: Response, value: string, maxAgeMs: number): void {
  const flags = vpsAuthCookieBaseFlags();
  res.append(
    'Set-Cookie',
    `${REFRESH_COOKIE}=${encodeURIComponent(value)}; Max-Age=${Math.floor(maxAgeMs / 1000)}; ${flags}`
  );
}

export function clearRefreshCookie(res: Response): void {
  const flags = vpsAuthCookieBaseFlags();
  res.append('Set-Cookie', `${REFRESH_COOKIE}=; Max-Age=0; ${flags}`);
}

export async function issueVpsSession(
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
