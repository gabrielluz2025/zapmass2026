import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomBytes } from 'crypto';
import { createHash } from 'crypto';

export type AccessTokenClaims = {
  sub: string;
  email: string;
  role: 'owner' | 'staff';
  ownerUid?: string;
  tenantUid: string;
};

// Padrão: 8h (28800s). Suficiente para sessões de trabalho sem forçar logout durante disparos.
// Sobrescrever via ZAPMASS_ACCESS_TTL_SEC no .env da VPS.
const ACCESS_TTL_SEC = Number(process.env.ZAPMASS_ACCESS_TTL_SEC || 28800);
const REFRESH_TTL_DAYS = Number(process.env.ZAPMASS_REFRESH_TTL_DAYS || 30);

function jwtSecret(): Uint8Array {
  const raw = process.env.ZAPMASS_JWT_SECRET?.trim();
  if (raw && raw.length >= 16) return new TextEncoder().encode(raw);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ZAPMASS_JWT_SECRET obrigatório em produção com auth VPS.');
  }
  return new TextEncoder().encode('zapmass-dev-insecure-jwt-secret-change-me');
}

export function accessTokenTtlSec(): number {
  return Math.max(60, Math.min(ACCESS_TTL_SEC, 86400));
}

export function refreshTokenTtlMs(): number {
  const days = Math.max(1, Math.min(REFRESH_TTL_DAYS, 90));
  return days * 24 * 60 * 60 * 1000;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({
    email: claims.email,
    role: claims.role,
    ownerUid: claims.ownerUid,
    tenantUid: claims.tenantUid
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${accessTokenTtlSec()}s`)
    .setIssuer('zapmass')
    .sign(jwtSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { issuer: 'zapmass' });
    return payloadToClaims(payload);
  } catch {
    return null;
  }
}

function payloadToClaims(payload: JWTPayload): AccessTokenClaims | null {
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  const role = payload.role === 'staff' ? 'staff' : payload.role === 'owner' ? 'owner' : null;
  const tenantUid =
    typeof payload.tenantUid === 'string' && payload.tenantUid.trim()
      ? payload.tenantUid.trim()
      : sub;
  const ownerUid =
    typeof payload.ownerUid === 'string' && payload.ownerUid.trim() ? payload.ownerUid.trim() : undefined;
  if (!sub || !role) return null;
  return { sub, email, role, ownerUid, tenantUid };
}

export function newRefreshTokenPlain(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
