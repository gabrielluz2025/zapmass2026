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
import { healCampaignDocument } from '../../src/utils/campaignMetrics.js';
import { countCampaignJobsByStatus, countTenantCampaignJobsByStatus } from '../campaignJobsResilience.js';
import {
  countersFromCampaignDoc,
  countersFromJobStatusCounts,
  mergeCampaignCounterTriple,
} from '../campaignProgressGuard.js';

function campaignCountersChanged(before: Campaign, after: Campaign): boolean {
  return (
    before.status !== after.status ||
    (before.processedCount ?? 0) !== (after.processedCount ?? 0) ||
    (before.successCount ?? 0) !== (after.successCount ?? 0) ||
    (before.failedCount ?? 0) !== (after.failedCount ?? 0)
  );
}

function persistHealedCampaignCounters(tenantId: string, before: Campaign, after: Campaign): void {
  if (!campaignCountersChanged(before, after)) return;
  void mergeUpdateCampaign(tenantId, before.id, {
    status: after.status,
    processedCount: after.processedCount,
    successCount: after.successCount,
    failedCount: after.failedCount
  }).catch(() => {});
}

function applyJobCountersToCampaign(
  campaign: Campaign,
  jobCounts: Record<string, number> | undefined
): Campaign {
  if (!jobCounts) return campaign;
  const merged = mergeCampaignCounterTriple(
    countersFromCampaignDoc({
      successCount: campaign.successCount,
      failedCount: campaign.failedCount,
      processedCount: campaign.processedCount
    }),
    countersFromJobStatusCounts(jobCounts)
  );
  if (
    merged.successCount === (campaign.successCount ?? 0) &&
    merged.failedCount === (campaign.failedCount ?? 0) &&
    merged.processedCount === (campaign.processedCount ?? 0)
  ) {
    return campaign;
  }
  return {
    ...campaign,
    successCount: merged.successCount,
    failedCount: merged.failedCount,
    processedCount: merged.processedCount
  };
}

export async function listCampaigns(tenantId: string): Promise<Campaign[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<CampaignRow>(
    `SELECT id::text, tenant_id::text, name, status, next_run_at, schedule_lock_until, doc, created_at, updated_at
     FROM zapmass.campaigns WHERE tenant_id = $1::uuid ORDER BY created_at DESC`,
    [tenantId]
  );
  const jobMap = await countTenantCampaignJobsByStatus(tenantId);
  const out: Campaign[] = [];
  for (const row of r.rows) {
    const raw = rowToCampaign(row);
    const withJobs = applyJobCountersToCampaign(raw, jobMap.get(raw.id));
    const healed = healCampaignDocument(withJobs);
    out.push(healed);
    persistHealedCampaignCounters(tenantId, raw, healed);
  }
  return out;
}

export async function getCampaign(tenantId: string, campaignId: string): Promise<Campaign | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<CampaignRow>(
    `SELECT id::text, tenant_id::text, name, status, next_run_at, schedule_lock_until, doc, created_at, updated_at
     FROM zapmass.campaigns WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, campaignId]
  );
  if (!r.rows[0]) return null;
  const raw = rowToCampaign(r.rows[0]);
  const withJobs = applyJobCountersToCampaign(raw, await countCampaignJobsByStatus(campaignId));
  const healed = healCampaignDocument(withJobs);
  persistHealedCampaignCounters(tenantId, raw, healed);
  return healed;
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

/** Resolve tenant (owner uid) só pelo id da campanha — usado quando mapa em RAM foi perdido. */
export async function resolveCampaignTenantId(campaignId: string): Promise<string | null> {
  const pool = getZapmassPool();
  if (!pool || !isUuid(campaignId)) return null;
  const r = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id::text FROM zapmass.campaigns WHERE id = $1::uuid LIMIT 1`,
    [campaignId]
  );
  return r.rows[0]?.tenant_id ?? null;
}

export async function listActiveCampaignIdsForPool(
  tenantId: string,
  poolId: string
): Promise<string[]> {
  const db = getZapmassPool();
  const pid = String(poolId || '').trim();
  if (!db || !isUuid(tenantId) || !pid) return [];
  try {
    const r = await db.query<{ id: string }>(
      `SELECT id::text
       FROM zapmass.campaigns
       WHERE tenant_id = $1::uuid
         AND status NOT IN ('COMPLETED', 'FAILED')
         AND (
           COALESCE(doc->>'poolId', '') = $2
           OR COALESCE(doc->'scheduleStartSnapshot'->>'poolId', '') = $2
         )`,
      [tenantId, pid]
    );
    return r.rows.map((row) => row.id).filter(Boolean);
  } catch (e) {
    console.warn('[campaigns] listActiveCampaignIdsForPool falhou:', (e as Error)?.message || e);
    return [];
  }
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
  try {
    await pool.query(
      `INSERT INTO zapmass.campaign_logs (campaign_id, tenant_id, level, message, payload)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)`,
      [campaignId, tenantId, level.toUpperCase(), message.slice(0, 4000), JSON.stringify(payload)]
    );
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg?.code === '23503') {
      console.warn(`[CampaignLog] FK violation ignorada — campanha ${campaignId} não encontrada no banco.`);
      return;
    }
    throw err;
  }
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

/** Telefones com log persistido de envio confirmado — barreira extra se o job PG sumir. */
export async function listCampaignSentLogPhones(
  tenantId: string,
  campaignId: string
): Promise<string[]> {
  const pool = getZapmassPool();
  if (!pool || !isUuid(campaignId)) return [];
  try {
    const r = await pool.query<{ phone: string }>(
      `SELECT DISTINCT COALESCE(payload->>'to', payload->>'phoneDigits', '') AS phone
         FROM zapmass.campaign_logs
        WHERE tenant_id = $1::uuid
          AND campaign_id = $2::uuid
          AND message ILIKE 'Mensagem enviada%'`,
      [tenantId, campaignId]
    );
    return r.rows.map((row) => String(row.phone || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export type DueScheduledRow = {
  id: string;
  tenant_id: string;
  doc: Record<string, unknown>;
  name: string;
  status: string;
  next_run_at: Date;
};

export type RunningCampaignRow = {
  id: string;
  tenant_id: string;
};

/** Campanhas marcadas RUNNING/STARTED no Postgres (reconciliação pós-restart). */
export async function listRunningCampaigns(limit = 50): Promise<RunningCampaignRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<RunningCampaignRow>(
    `SELECT id::text, tenant_id::text
     FROM zapmass.campaigns
     WHERE status IN ('RUNNING', 'STARTED')
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

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
