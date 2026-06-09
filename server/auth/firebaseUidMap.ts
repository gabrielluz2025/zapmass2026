import { getZapmassPool } from '../db/postgres.js';
import {
  firebaseUidToTenantUuid,
  isUuid,
  tenantScopeUidsMatch,
  expandTenantScopeUids
} from './tenantUidScopeServer.js';

export { firebaseUidToTenantUuid, isUuid, tenantScopeUidsMatch, expandTenantScopeUids };

/** Converte UID Firebase (ou UUID já migrado) para tenant_id Postgres. */
export function resolvePostgresTenantId(uid: string): string {
  const id = String(uid || '').trim();
  if (!id) return id;
  if (isUuid(id)) return id;
  return firebaseUidToTenantUuid(id);
}

let uidCache = new Map<string, string>();

export function clearFirebaseUidMapCache(): void {
  uidCache = new Map();
}

/** Resolve tenant Postgres; usa cache em memória + coluna `firebase_uid` quando existir. */
export async function resolvePostgresTenantIdAsync(firebaseOrUuid: string): Promise<string> {
  const raw = String(firebaseOrUuid || '').trim();
  if (!raw) return raw;
  if (isUuid(raw)) return raw;

  const cached = uidCache.get(raw);
  if (cached) return cached;

  const derived = firebaseUidToTenantUuid(raw);
  const pool = getZapmassPool();
  if (pool) {
    try {
      const r = await pool.query<{ id: string }>(
        `SELECT id::text FROM zapmass.users WHERE firebase_uid = $1 LIMIT 1`,
        [raw]
      );
      if (r.rows[0]?.id) {
        uidCache.set(raw, r.rows[0].id);
        return r.rows[0].id;
      }
      const r2 = await pool.query<{ id: string }>(
        `SELECT id::text FROM zapmass.users WHERE id = $1::uuid LIMIT 1`,
        [derived]
      );
      if (r2.rows[0]?.id) {
        uidCache.set(raw, r2.rows[0].id);
        return r2.rows[0].id;
      }
    } catch {
      /* schema antigo sem firebase_uid */
    }
  }
  uidCache.set(raw, derived);
  return derived;
}

/** Funcionário Firebase → `workspace_members.id` (modo VPS). */
export async function resolveStaffAuthSubjectIdAsync(firebaseStaffUid: string): Promise<string> {
  const raw = String(firebaseStaffUid || '').trim();
  if (!raw) return raw;
  if (isUuid(raw)) return raw;

  const pool = getZapmassPool();
  if (pool) {
    try {
      const r = await pool.query<{ id: string }>(
        `SELECT id::text FROM zapmass.workspace_members WHERE firebase_auth_uid = $1 LIMIT 1`,
        [raw]
      );
      if (r.rows[0]?.id) return r.rows[0].id;
    } catch {
      /* ignore */
    }
  }
  return raw;
}
