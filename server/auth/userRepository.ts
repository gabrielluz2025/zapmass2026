import { randomUUID } from 'crypto';
import type pg from 'pg';
import { getZapmassPool } from '../db/postgres.js';
import { hashPassword, verifyPassword } from './password.js';

export type UserRow = {
  id: string;
  email: string;
  email_normalized: string;
  password_hash: string | null;
  display_name: string | null;
  photo_url: string | null;
  disabled_at: Date | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const norm = normalizeEmail(email);
  const r = await pool.query<UserRow>(
    `SELECT id::text, email, email_normalized, password_hash, display_name, photo_url, disabled_at
     FROM zapmass.users WHERE email_normalized = $1 LIMIT 1`,
    [norm]
  );
  return r.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<UserRow>(
    `SELECT id::text, email, email_normalized, password_hash, display_name, photo_url, disabled_at
     FROM zapmass.users WHERE id = $1::uuid LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function createUserWithPassword(
  email: string,
  password: string,
  displayName?: string
): Promise<UserRow> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const norm = normalizeEmail(email);
  const id = randomUUID();
  const password_hash = await hashPassword(password);
  const r = await pool.query<UserRow>(
    `INSERT INTO zapmass.users (id, email, email_normalized, password_hash, display_name)
     VALUES ($1::uuid, $2, $3, $4, $5)
     RETURNING id::text, email, email_normalized, password_hash, display_name, photo_url, disabled_at`,
    [id, email.trim(), norm, password_hash, displayName?.trim() || null]
  );
  return r.rows[0]!;
}

export async function verifyUserPassword(user: UserRow, password: string): Promise<boolean> {
  if (!user.password_hash || user.disabled_at) return false;
  return verifyPassword(password, user.password_hash);
}

export async function insertRefreshToken(
  client: pg.PoolClient,
  opts: {
    subjectId: string;
    tokenHash: string;
    role: 'owner' | 'staff';
    ownerUserId: string | null;
    expiresAt: Date;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO zapmass.refresh_tokens (subject_id, token_hash, role, owner_user_id, expires_at)
     VALUES ($1::uuid, $2, $3, $4::uuid, $5)`,
    [opts.subjectId, opts.tokenHash, opts.role, opts.ownerUserId, opts.expiresAt]
  );
}

export async function revokeRefreshTokenHash(tokenHash: string): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `UPDATE zapmass.refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
}

export async function updateUserDisplayName(
  userId: string,
  displayName: string
): Promise<UserRow | null> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const r = await pool.query<UserRow>(
    `UPDATE zapmass.users SET display_name = $2 WHERE id = $1::uuid
     RETURNING id::text, email, email_normalized, password_hash, display_name, photo_url, disabled_at`,
    [userId, displayName.trim() || null]
  );
  return r.rows[0] ?? null;
}

export async function updateUserPhotoUrl(userId: string, photoUrl: string | null): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  await pool.query(`UPDATE zapmass.users SET photo_url = $2 WHERE id = $1::uuid`, [userId, photoUrl]);
}

export async function updateUserEmail(userId: string, email: string): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const norm = normalizeEmail(email);
  await pool.query(`UPDATE zapmass.users SET email = $2, email_normalized = $3 WHERE id = $1::uuid`, [
    userId,
    email.trim(),
    norm
  ]);
}

export async function updateUserPassword(userId: string, password: string): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const password_hash = await hashPassword(password);
  await pool.query(`UPDATE zapmass.users SET password_hash = $2 WHERE id = $1::uuid`, [
    userId,
    password_hash
  ]);
}

export async function findValidRefreshToken(
  tokenHash: string
): Promise<{
  subject_id: string;
  role: 'owner' | 'staff';
  owner_user_id: string | null;
} | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<{
    subject_id: string;
    role: 'owner' | 'staff';
    owner_user_id: string | null;
  }>(
    `SELECT subject_id::text, role, owner_user_id::text
     FROM zapmass.refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
     LIMIT 1`,
    [tokenHash]
  );
  return r.rows[0] ?? null;
}
