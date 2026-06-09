import { createHash } from 'crypto';

/** Namespace fixo ZapMass — UUID v5 estável por UID Firebase. */
const ZAPMASS_FIREBASE_NAMESPACE = 'f8e3b2a1-4c5d-6e7f-8a9b-0c1d2e3f4a5b';

function uuidBytesFromNamespace(namespaceUuid: string): Buffer {
  const hex = namespaceUuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error('invalid_namespace_uuid');
  return Buffer.from(hex, 'hex');
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || '').trim()
  );
}

/** RFC 4122 UUID v5 (SHA-1) — mesmo firebaseUid → sempre o mesmo UUID Postgres derivado. */
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

export function expandTenantScopeUids(uid: string): string[] {
  const u = String(uid || '').trim();
  if (!u || u === 'anonymous') return [u];
  const out = new Set<string>([u]);
  if (!isUuid(u)) {
    try {
      out.add(firebaseUidToTenantUuid(u));
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

export function tenantScopeUidsMatch(a: string, b: string): boolean {
  const A = new Set(expandTenantScopeUids(a));
  const B = new Set(expandTenantScopeUids(b));
  for (const x of A) {
    if (B.has(x)) return true;
  }
  return false;
}
