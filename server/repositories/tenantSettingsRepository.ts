import { getZapmassPool } from '../db/postgres.js';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function loadDispatchSettingsPg(tenantId: string): Promise<Record<string, unknown> | null> {
  if (!isUuid(tenantId)) return null;
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<{ doc: Record<string, unknown> }>(
    `SELECT doc FROM zapmass.tenant_dispatch_settings WHERE tenant_id = $1::uuid`,
    [tenantId]
  );
  return r.rows[0]?.doc ?? null;
}

export async function saveDispatchSettingsPg(
  tenantId: string,
  doc: Record<string, unknown>
): Promise<void> {
  if (!isUuid(tenantId)) return;
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO zapmass.tenant_dispatch_settings (tenant_id, doc, updated_at)
     VALUES ($1::uuid, $2::jsonb, now())
     ON CONFLICT (tenant_id) DO UPDATE SET doc = $2::jsonb, updated_at = now()`,
    [tenantId, JSON.stringify(doc)]
  );
}
