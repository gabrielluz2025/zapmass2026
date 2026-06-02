import { getZapmassPool } from '../db/postgres.js';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function getSubscriptionDocPg(tenantId: string): Promise<Record<string, unknown> | null> {
  if (!isUuid(tenantId)) return null;
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<{ doc: Record<string, unknown> }>(
    `SELECT doc FROM zapmass.user_subscriptions WHERE tenant_id = $1::uuid`,
    [tenantId]
  );
  return r.rows[0]?.doc ?? null;
}

export async function mergeSubscriptionDocPg(
  tenantId: string,
  partial: Record<string, unknown>
): Promise<boolean> {
  if (!isUuid(tenantId)) return false;
  const pool = getZapmassPool();
  if (!pool) return false;
  const cur = (await getSubscriptionDocPg(tenantId)) || {};
  const next = { ...cur, ...partial, updatedAt: new Date().toISOString() };
  await pool.query(
    `INSERT INTO zapmass.user_subscriptions (tenant_id, doc, updated_at)
     VALUES ($1::uuid, $2::jsonb, now())
     ON CONFLICT (tenant_id) DO UPDATE SET doc = $2::jsonb, updated_at = now()`,
    [tenantId, JSON.stringify(next)]
  );
  return true;
}

export async function listSubscriptionsPg(limit: number): Promise<
  Array<{ tenantId: string; doc: Record<string, unknown>; updatedAt: string | null }>
> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const cap = Math.min(Math.max(limit, 1), 1000);
  const r = await pool.query<{
    tenant_id: string;
    doc: Record<string, unknown>;
    updated_at: Date | null;
  }>(
    `SELECT tenant_id::text, doc, updated_at
     FROM zapmass.user_subscriptions
     ORDER BY updated_at DESC NULLS LAST
     LIMIT $1`,
    [cap]
  );
  return r.rows.map((row) => ({
    tenantId: row.tenant_id,
    doc: row.doc,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null
  }));
}

/** Claim atómico para notificar admins sobre novo cliente (uma vez por tenant). */
export async function tryClaimAdminNewClientNotifyPg(tenantId: string): Promise<boolean> {
  if (!isUuid(tenantId)) return false;
  const pool = getZapmassPool();
  if (!pool) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ doc: Record<string, unknown> }>(
      `SELECT doc FROM zapmass.user_subscriptions WHERE tenant_id = $1::uuid FOR UPDATE`,
      [tenantId]
    );
    const doc = cur.rows[0]?.doc || {};
    if (doc.adminNewClientNotifiedAt) {
      await client.query('ROLLBACK');
      return false;
    }
    const next = {
      ...doc,
      adminNewClientNotifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await client.query(
      `INSERT INTO zapmass.user_subscriptions (tenant_id, doc, updated_at)
       VALUES ($1::uuid, $2::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE SET doc = $2::jsonb, updated_at = now()`,
      [tenantId, JSON.stringify(next)]
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
