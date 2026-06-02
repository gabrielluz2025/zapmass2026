import { getZapmassPool } from '../db/postgres.js';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function getAppProfileSegmentPg(tenantId: string): Promise<string | null> {
  if (!isUuid(tenantId)) return null;
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<{ use_segment: string | null }>(
    `SELECT use_segment FROM zapmass.tenant_app_profiles WHERE tenant_id = $1::uuid`,
    [tenantId]
  );
  return r.rows[0]?.use_segment ?? null;
}

export async function saveAppProfileSegmentPg(tenantId: string, useSegment: string): Promise<void> {
  if (!isUuid(tenantId)) return;
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO zapmass.tenant_app_profiles (tenant_id, use_segment, updated_at)
     VALUES ($1::uuid, $2, now())
     ON CONFLICT (tenant_id) DO UPDATE SET use_segment = $2, updated_at = now()`,
    [tenantId, useSegment.slice(0, 64)]
  );
}
