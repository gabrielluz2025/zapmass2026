import { createHash } from 'crypto';
import { getZapmassPool } from '../db/postgres.js';

/** Namespace fixo ZapMass — UUID v5 estável por UID Firebase. */
export const ZAPMASS_FIREBASE_NAMESPACE = 'f8e3b2a1-4c5d-6e7f-8a9b-0c1d2e3f4a5b';

function uuidBytesFromNamespace(namespaceUuid: string): Buffer {
  const hex = namespaceUuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error('invalid_namespace_uuid');
  return Buffer.from(hex, 'hex');
}

/** RFC 4122 UUID v5 (SHA-1) — mesmo `firebaseUid` → sempre o mesmo UUID Postgres. */
export function firebaseUidToTenantUuid(firebaseUid: string): string {
  const name = String(firebaseUid || '').trim();
  if (!name) throw new Error('empty_firebase_uid');
  const ns = uuidBytesFromNamespace(ZAPMASS_FIREBASE_NAMESPACE);
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || '').trim()
  );
}

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
