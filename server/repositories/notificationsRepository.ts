import { getZapmassPool } from '../db/postgres.js';

export type PersistedNotificationKind = 'info' | 'success' | 'warning' | 'error';
export type PersistedNotificationCategory =
  | 'campaign'
  | 'schedule'
  | 'billing'
  | 'system'
  | 'admin'
  | 'other';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function insertNotificationPg(
  tenantId: string,
  payload: {
    title: string;
    body: string;
    kind: PersistedNotificationKind;
    category: PersistedNotificationCategory;
    campaignId?: string;
  }
): Promise<void> {
  if (!isUuid(tenantId)) return;
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO zapmass.tenant_notifications
       (tenant_id, title, body, kind, category, read, campaign_id)
     VALUES ($1::uuid, $2, $3, $4, $5, false, $6)`,
    [
      tenantId,
      payload.title.slice(0, 200),
      payload.body.slice(0, 4000),
      payload.kind,
      payload.category,
      payload.campaignId ? String(payload.campaignId).slice(0, 128) : null
    ]
  );
}

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  kind: string;
  category: string;
  read: boolean;
  created_at: Date;
  campaign_id: string | null;
};

export async function listNotificationsPg(
  tenantId: string,
  limit: number
): Promise<NotificationRow[]> {
  if (!isUuid(tenantId)) return [];
  const pool = getZapmassPool();
  if (!pool) return [];
  const cap = Math.min(Math.max(limit, 1), 200);
  const r = await pool.query<NotificationRow>(
    `SELECT id::text, title, body, kind, category, read, created_at, campaign_id
     FROM zapmass.tenant_notifications
     WHERE tenant_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, cap]
  );
  return r.rows;
}

export async function markNotificationReadPg(tenantId: string, id: string): Promise<boolean> {
  if (!isUuid(tenantId)) return false;
  const pool = getZapmassPool();
  if (!pool) return false;
  const r = await pool.query(
    `UPDATE zapmass.tenant_notifications SET read = true
     WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, id]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function markAllNotificationsReadPg(tenantId: string): Promise<void> {
  if (!isUuid(tenantId)) return;
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `UPDATE zapmass.tenant_notifications SET read = true WHERE tenant_id = $1::uuid AND read = false`,
    [tenantId]
  );
}

export async function deleteNotificationPg(tenantId: string, id: string): Promise<boolean> {
  if (!isUuid(tenantId)) return false;
  const pool = getZapmassPool();
  if (!pool) return false;
  const r = await pool.query(
    `DELETE FROM zapmass.tenant_notifications WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, id]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listActiveTenantIdsPg(): Promise<string[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<{ id: string }>(
    `SELECT id::text FROM zapmass.users WHERE disabled_at IS NULL ORDER BY email`
  );
  return r.rows.map((row) => row.id);
}

export async function broadcastNotificationPg(payload: {
  title: string;
  body: string;
  kind: PersistedNotificationKind;
}): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const ids = await listActiveTenantIdsPg();
  if (ids.length === 0) return 0;
  let sent = 0;
  for (const tenantId of ids) {
    await insertNotificationPg(tenantId, {
      title: payload.title,
      body: payload.body,
      kind: payload.kind,
      category: 'system'
    });
    sent += 1;
  }
  return sent;
}
