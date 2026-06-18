import { randomBytes } from 'crypto';
import { getZapmassPool } from '../db/postgres.js';
import { findUserByEmail } from './userRepository.js';
import { hashPassword } from './password.js';
import { hashRefreshToken } from './jwt.js';
import { sendPasswordResetEmail } from '../emailService.js';
import { getSurveyLinksBaseOrigin } from '../publicSurveyAppOrigin.js';

const RESET_TTL_MS = 60 * 60 * 1000;

function hashResetToken(plain: string): string {
  return hashRefreshToken(plain.trim());
}

/** Sempre resolve com sucesso visível (não revela se o e-mail existe). */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || user.disabled_at) return;

  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');

  const plain = randomBytes(32).toString('base64url');
  const tokenHash = hashResetToken(plain);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  await pool.query(
    `UPDATE zapmass.password_reset_tokens SET used_at = now()
     WHERE user_id = $1::uuid AND used_at IS NULL`,
    [user.id]
  );
  await pool.query(
    `INSERT INTO zapmass.password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1::uuid, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  );

  const origin = getSurveyLinksBaseOrigin() || 'https://zap-mass.com';
  const resetUrl = `${origin}/?reset=${encodeURIComponent(plain)}`;

  await sendPasswordResetEmail({
    to: user.email,
    displayName: user.display_name || undefined,
    resetUrl
  });
}

export async function resetPasswordWithToken(token: string, password: string): Promise<void> {
  if (password.length < 8) {
    throw new Error('Senha deve ter ao menos 8 caracteres.');
  }
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');

  const tokenHash = hashResetToken(token);
  const r = await pool.query<{ user_id: string }>(
    `SELECT user_id::text FROM zapmass.password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     LIMIT 1`,
    [tokenHash]
  );
  const row = r.rows[0];
  if (!row) {
    throw new Error('Link inválido ou expirado. Peça um novo e-mail de redefinição.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE zapmass.password_reset_tokens SET used_at = now() WHERE token_hash = $1`,
      [tokenHash]
    );
    const password_hash = await hashPassword(password);
    await client.query(`UPDATE zapmass.users SET password_hash = $2 WHERE id = $1::uuid`, [
      row.user_id,
      password_hash
    ]);
    await client.query(
      `UPDATE zapmass.refresh_tokens SET revoked_at = now()
       WHERE subject_id = $1::uuid AND revoked_at IS NULL`,
      [row.user_id]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
