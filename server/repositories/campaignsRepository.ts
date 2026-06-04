import { randomUUID } from 'crypto';
import { isUuid } from '../auth/firebaseUidMap.js';
import { getZapmassPool } from '../db/postgres.js';
import type { Campaign } from '../../src/types.js';
import {
  campaignDocPayload,
  campaignRowFieldsFromDoc,
  rowToCampaign,
  type CampaignRow
} from './campaignMapper.js';

export async function listCampaigns(tenantId: string): Promise<Campaign[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<CampaignRow>(
    `SELECT id::text, tenant_id::text, name, status, next_run_at, schedule_lock_until, doc, created_at, updated_at
     FROM zapmass.campaigns WHERE tenant_id = $1::uuid ORDER BY created_at DESC`,
    [tenantId]
  );
  return r.rows.map(rowToCampaign);
}

export async function getCampaign(tenantId: string, campaignId: string): Promise<Campaign | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<CampaignRow>(
    `SELECT id::text, tenant_id::text, name, status, next_run_at, schedule_lock_until, doc, created_at, updated_at
     FROM zapmass.campaigns WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, campaignId]
  );
  return r.rows[0] ? rowToCampaign(r.rows[0]) : null;
}

export async function getCampaignDoc(
  tenantId: string,
  campaignId: string
): Promise<Record<string, unknown> | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<{ doc: Record<string, unknown> }>(
    `SELECT doc FROM zapmass.campaigns WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, campaignId]
  );
  return r.rows[0]?.doc ?? null;
}

export async function createCampaign(
  tenantId: string,
  payload: Record<string, unknown>
): Promise<{ id: string; campaign: Campaign }> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const id = randomUUID();
  const doc = campaignDocPayload(payload, tenantId);
  const fields = campaignRowFieldsFromDoc(doc);
  const r = await pool.query<CampaignRow>(
    `INSERT INTO zapmass.campaigns (id, tenant_id, name, status, next_run_at, doc)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
     RETURNING id::text, tenant_id::text, name, status, next_run_at, schedule_lock_until, doc, created_at, updated_at`,
    [id, tenantId, fields.name, fields.status, fields.next_run_at, JSON.stringify(doc)]
  );
  return { id, campaign: rowToCampaign(r.rows[0]!) };
}

export async function mergeUpdateCampaign(
  tenantId: string,
  campaignId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const pool = getZapmassPool();
  if (!pool) return false;
  const existing = await getCampaignDoc(tenantId, campaignId);
  if (!existing) return false;
  const merged = { ...existing, ...patch };
  const fields = campaignRowFieldsFromDoc(merged);
  const r = await pool.query(
    `UPDATE zapmass.campaigns
     SET doc = $3::jsonb, name = $4, status = $5, next_run_at = $6, updated_at = now()
     WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [
      tenantId,
      campaignId,
      JSON.stringify(merged),
      fields.name,
      fields.status,
      fields.next_run_at
    ]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteCampaign(tenantId: string, campaignId: string): Promise<boolean> {
  const pool = getZapmassPool();
  if (!pool || !isUuid(campaignId)) return false;
  const r = await pool.query(
    `DELETE FROM zapmass.campaigns WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, campaignId]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteCampaigns(
  tenantId: string,
  campaignIds: string[]
): Promise<{ deleted: string[]; missing: string[] }> {
  const deleted: string[] = [];
  const missing: string[] = [];
  for (const id of campaignIds) {
    const ok = await deleteCampaign(tenantId, id);
    if (ok) deleted.push(id);
    else missing.push(id);
  }
  return { deleted, missing };
}

export async function deleteAllCampaigns(tenantId: string): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const r = await pool.query(`DELETE FROM zapmass.campaigns WHERE tenant_id = $1::uuid`, [tenantId]);
  return r.rowCount ?? 0;
}

export async function addCampaignLog(
  tenantId: string,
  campaignId: string,
  level: string,
  message: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO zapmass.campaign_logs (campaign_id, tenant_id, level, message, payload)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)`,
    [campaignId, tenantId, level.toUpperCase(), message.slice(0, 4000), JSON.stringify(payload)]
  );
}

export type CampaignLogRow = {
  id: string;
  level: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

export async function listCampaignLogs(
  tenantId: string,
  campaignId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<CampaignLogRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const r = await pool.query<CampaignLogRow>(
    `SELECT id::text, level, message, payload, created_at
     FROM zapmass.campaign_logs
     WHERE tenant_id = $1::uuid AND campaign_id = $2::uuid
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [tenantId, campaignId, limit, offset]
  );
  return r.rows;
}

export type DueScheduledRow = {
  id: string;
  tenant_id: string;
  doc: Record<string, unknown>;
  name: string;
  status: string;
  next_run_at: Date;
};

export async function listDueScheduledCampaigns(limit = 5): Promise<DueScheduledRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<DueScheduledRow>(
    `SELECT id::text, tenant_id::text, doc, name, status, next_run_at
     FROM zapmass.campaigns
     WHERE status = 'SCHEDULED' AND next_run_at IS NOT NULL AND next_run_at <= now()
       AND (schedule_lock_until IS NULL OR schedule_lock_until < now())
     ORDER BY next_run_at ASC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

/** Lock distribuído para o runner agendado (Postgres). */
export async function tryClaimScheduledCampaignLock(
  tenantId: string,
  campaignId: string,
  lockMs: number
): Promise<boolean> {
  const pool = getZapmassPool();
  if (!pool) return false;
  const until = new Date(Date.now() + lockMs);
  const r = await pool.query(
    `UPDATE zapmass.campaigns
     SET schedule_lock_until = $3, updated_at = now()
     WHERE tenant_id = $1::uuid AND id = $2::uuid AND status = 'SCHEDULED'
       AND next_run_at IS NOT NULL AND next_run_at <= now()
       AND (schedule_lock_until IS NULL OR schedule_lock_until < now())
     RETURNING id`,
    [tenantId, campaignId, until]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function releaseScheduledCampaignLock(
  tenantId: string,
  campaignId: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `UPDATE zapmass.campaigns SET schedule_lock_until = NULL WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, campaignId]
  );
}
