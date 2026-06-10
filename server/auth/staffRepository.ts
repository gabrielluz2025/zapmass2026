import { randomUUID } from 'crypto';
import { getZapmassPool } from '../db/postgres.js';
import { hashPassword, verifyPassword } from './password.js';
import { findUserByEmail } from './userRepository.js';

export type WorkspaceMemberRow = {
  id: string;
  owner_user_id: string;
  login_slug: string;
  display_name: string;
  photo_url: string | null;
  revoked_at: Date | null;
  password_hash: string;
};

export async function findStaffMember(
  ownerUserId: string,
  loginSlug: string
): Promise<WorkspaceMemberRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<WorkspaceMemberRow>(
    `SELECT id::text, owner_user_id::text, login_slug, display_name, photo_url, revoked_at, password_hash
     FROM zapmass.workspace_members
     WHERE owner_user_id = $1::uuid AND login_slug = $2
     LIMIT 1`,
    [ownerUserId, loginSlug]
  );
  return r.rows[0] ?? null;
}

export async function listActiveStaffMemberIds(ownerUserId: string): Promise<string[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<{ id: string }>(
    `SELECT id::text FROM zapmass.workspace_members
     WHERE owner_user_id = $1::uuid AND revoked_at IS NULL`,
    [ownerUserId]
  );
  return r.rows.map((x) => x.id);
}

export async function countActiveStaffMembers(ownerUserId: string): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM zapmass.workspace_members
     WHERE owner_user_id = $1::uuid AND revoked_at IS NULL`,
    [ownerUserId]
  );
  return Number(r.rows[0]?.n || 0);
}

export async function createStaffMember(opts: {
  ownerUserId: string;
  loginSlug: string;
  password: string;
  displayName: string;
}): Promise<WorkspaceMemberRow> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const id = randomUUID();
  const password_hash = await hashPassword(opts.password);
  const r = await pool.query<WorkspaceMemberRow>(
    `INSERT INTO zapmass.workspace_members (id, owner_user_id, login_slug, password_hash, display_name)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5)
     RETURNING id::text, owner_user_id::text, login_slug, display_name, photo_url, revoked_at, password_hash`,
    [id, opts.ownerUserId, opts.loginSlug, password_hash, opts.displayName]
  );
  return r.rows[0]!;
}

export async function verifyStaffPassword(
  member: WorkspaceMemberRow,
  password: string
): Promise<boolean> {
  if (member.revoked_at) return false;
  return verifyPassword(password, member.password_hash);
}

export async function staffSignInByManagerEmail(
  managerEmail: string,
  loginSlug: string,
  password: string
): Promise<
  | { ok: true; member: WorkspaceMemberRow; ownerUserId: string; ownerEmail: string }
  | { ok: false; code: string }
> {
  const owner = await findUserByEmail(managerEmail);
  if (!owner) return { ok: false, code: 'MANAGER_NOT_FOUND' };
  if (owner.disabled_at) return { ok: false, code: 'MANAGER_DISABLED' };
  const member = await findStaffMember(owner.id, loginSlug);
  if (!member) return { ok: false, code: 'STAFF_NOT_FOUND' };
  if (member.revoked_at) return { ok: false, code: 'STAFF_REVOKED' };
  const ok = await verifyStaffPassword(member, password);
  if (!ok) return { ok: false, code: 'WRONG_PASSWORD' };
  return { ok: true, member, ownerUserId: owner.id, ownerEmail: owner.email };
}

export async function findStaffMemberById(memberId: string): Promise<WorkspaceMemberRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<WorkspaceMemberRow>(
    `SELECT id::text, owner_user_id::text, login_slug, display_name, photo_url, revoked_at, password_hash
     FROM zapmass.workspace_members WHERE id = $1::uuid LIMIT 1`,
    [memberId]
  );
  return r.rows[0] ?? null;
}

export async function updateStaffDisplayName(
  memberId: string,
  displayName: string
): Promise<WorkspaceMemberRow | null> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const r = await pool.query<WorkspaceMemberRow>(
    `UPDATE zapmass.workspace_members SET display_name = $2 WHERE id = $1::uuid
     RETURNING id::text, owner_user_id::text, login_slug, display_name, photo_url, revoked_at, password_hash`,
    [memberId, displayName.trim()]
  );
  return r.rows[0] ?? null;
}

export async function updateStaffPhotoUrl(memberId: string, photoUrl: string | null): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  await pool.query(`UPDATE zapmass.workspace_members SET photo_url = $2 WHERE id = $1::uuid`, [
    memberId,
    photoUrl
  ]);
}

export async function updateStaffPassword(memberId: string, password: string): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const password_hash = await hashPassword(password);
  await pool.query(`UPDATE zapmass.workspace_members SET password_hash = $2 WHERE id = $1::uuid`, [
    memberId,
    password_hash
  ]);
}

export async function getWorkspaceMemberUidSetVps(tenantUid: string): Promise<Set<string>> {
  const out = new Set<string>();
  const uid = tenantUid.trim();
  if (!uid) return out;
  out.add(uid);
  for (const id of await listActiveStaffMemberIds(uid)) {
    out.add(id);
  }
  return out;
}
