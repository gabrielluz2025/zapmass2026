/**
 * campaignJobsResilience.ts
 *
 * Camada de resiliência para fila de campanhas.
 * - Registra cada job em `zapmass.campaign_jobs` (PostgreSQL) como fonte de verdade.
 * - O BullMQ continua sendo o executor imediato, mas todo job tem um espelho no PG.
 * - Reaper: a cada 2 min verifica jobs presos em 'sending' por > 5 min e os reenfileira.
 * - DLQ: jobs que esgotam tentativas viram status='dead' — alertas via log + métrica.
 * - Recovery: ao iniciar, detecta jobs 'pending' > 10 min no PG sem correspondência ativa.
 */

import { isUuid } from './auth/firebaseUidMap.js';
import { getZapmassPool, isZapmassPostgresConfigured } from './db/postgres.js';

/** Espelha `isPhantomCampaignJobFailure` — falhas anti-spam/adiamento, não envio. */
export const CAMPAIGN_JOB_PHANTOM_ERROR_SQL = `(
  COALESCE(last_error, '') ~* 'duplica(ç|c)ão|PAUSED_BY_HIGH_DUPLICATION|conteúdo idêntico|circuit breaker de hash|DelayedError|moveToDelayed|jobs adiados, não marcados como falha'
)`;

function mapProgressJobStatusRow(row: {
  pending: string;
  sending: string;
  sent: string;
  failed: string;
  dead: string;
  phantom_settled: string;
}): Record<string, number> {
  const phantom = parseInt(row.phantom_settled, 10) || 0;
  return {
    pending: (parseInt(row.pending, 10) || 0) + phantom,
    sending: parseInt(row.sending, 10) || 0,
    sent: parseInt(row.sent, 10) || 0,
    failed: parseInt(row.failed, 10) || 0,
    dead: parseInt(row.dead, 10) || 0,
  };
}

export interface CampaignJobRecord {
  idempotencyKey: string;
  campaignId?: string | null;
  tenantId: string;
  connectionId: string;
  toNumber: string;
  stageIndex?: number;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

export interface JobUpdateResult {
  status: 'sent' | 'failed' | 'dead';
  error?: string;
}

// ─── Registro de jobs ────────────────────────────────────────────────────────

/**
 * Registra um novo job no PG.
 * Usa ON CONFLICT para ser idempotente: se o job já existe, não duplica.
 * Retorna false silenciosamente se PG não estiver configurado.
 */
export async function registerCampaignJob(record: CampaignJobRecord): Promise<boolean> {
  if (!isZapmassPostgresConfigured()) return false;
  const pool = getZapmassPool();
  if (!pool) return false;

  try {
    await pool.query(
      `INSERT INTO zapmass.campaign_jobs
        (idempotency_key, campaign_id, tenant_id, connection_id, to_number, stage_index, payload, max_attempts, status, next_retry_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        record.idempotencyKey,
        record.campaignId && isUuid(record.campaignId) ? record.campaignId : null,
        record.tenantId,
        record.connectionId,
        record.toNumber,
        record.stageIndex ?? 0,
        JSON.stringify(record.payload),
        record.maxAttempts ?? 3,
      ]
    );
    return true;
  } catch (err) {
    console.error('[CampaignJobs] Erro ao registrar job:', (err as Error)?.message);
    return false;
  }
}

/**
 * Marca job como 'sending' (inicio efetivo do envio).
 * Garante que o reaper não colete jobs que estão sendo enviados agora.
 */
export async function markJobSending(idempotencyKey: string, workerId: string): Promise<void> {
  if (!isZapmassPostgresConfigured()) return;
  const pool = getZapmassPool();
  if (!pool) return;

  try {
    await pool.query(
      `UPDATE zapmass.campaign_jobs
          SET status = 'sending', locked_at = NOW(), locked_by = $2, updated_at = NOW()
        WHERE idempotency_key = $1
          AND status IN ('pending', 'failed')`,
      [idempotencyKey, workerId]
    );
  } catch (err) {
    console.error('[CampaignJobs] Erro ao marcar sending:', (err as Error)?.message);
  }
}

/**
 * Atualiza o status final do job após tentativa de envio.
 * - 'sent': sucesso, registra sent_at.
 * - 'failed': incrementa attempts, calcula próximo retry.
 * - 'dead': esgotou tentativas, vai para DLQ.
 */
export async function finalizeCampaignJob(
  idempotencyKey: string,
  result: JobUpdateResult
): Promise<void> {
  if (!isZapmassPostgresConfigured()) return;
  const pool = getZapmassPool();
  if (!pool) return;

  try {
    if (result.status === 'sent') {
      await pool.query(
        `UPDATE zapmass.campaign_jobs
            SET status = 'sent', sent_at = NOW(), locked_at = NULL, locked_by = NULL, updated_at = NOW()
          WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
    } else if (result.status === 'failed') {
      // Backoff: 5s → 10s → 20s + jitter de até 30%
      await pool.query(
        `UPDATE zapmass.campaign_jobs
            SET status = CASE
                  WHEN attempts + 1 >= max_attempts THEN 'dead'
                  ELSE 'failed'
                END,
                attempts    = attempts + 1,
                last_error  = $2,
                locked_at   = NULL,
                locked_by   = NULL,
                next_retry_at = CASE
                  WHEN attempts + 1 >= max_attempts THEN NOW()
                  ELSE NOW() + (
                    POWER(2, LEAST(attempts, 3)) * 5 * (1 + RANDOM() * 0.3) || ' seconds'
                  )::INTERVAL
                END,
                updated_at = NOW()
          WHERE idempotency_key = $1`,
        [idempotencyKey, result.error ?? 'erro desconhecido']
      );
    } else if (result.status === 'dead') {
      await pool.query(
        `UPDATE zapmass.campaign_jobs
            SET status = 'dead', last_error = $2, locked_at = NULL, locked_by = NULL, updated_at = NOW()
          WHERE idempotency_key = $1`,
        [idempotencyKey, result.error ?? 'erro fatal']
      );
    }
  } catch (err) {
    console.error('[CampaignJobs] Erro ao finalizar job:', (err as Error)?.message);
  }
}

// ─── Reaper ──────────────────────────────────────────────────────────────────

let reaperTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Inicia o Reaper: coleta jobs presos em 'sending' por mais de 5 min
 * e os devolve para 'pending' para reprocessamento.
 */
export function startCampaignJobsReaper(options?: { intervalMs?: number; stuckThresholdMs?: number }): void {
  if (!isZapmassPostgresConfigured()) {
    console.log('[CampaignJobs] PG não configurado — reaper não iniciado.');
    return;
  }

  const interval = options?.intervalMs ?? 2 * 60 * 1000;     // 2 min
  const threshold = options?.stuckThresholdMs ?? 5 * 60 * 1000; // 5 min

  reaperTimer = setInterval(() => {
    void runReaper(threshold).catch((err) => {
      console.error('[CampaignJobs] Reaper erro:', (err as Error)?.message);
    });
  }, interval);

  console.log('[CampaignJobs] Reaper iniciado (interval=2min, threshold=5min).');
}

export function stopCampaignJobsReaper(): void {
  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
}

async function runReaper(thresholdMs: number): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;

  const thresholdInterval = `${Math.floor(thresholdMs / 1000)} seconds`;

  // Jobs presos em 'sending' por mais do que o threshold → devolver para pending
  const result = await pool.query(
    `UPDATE zapmass.campaign_jobs
        SET status = CASE
              WHEN attempts + 1 >= max_attempts THEN 'dead'
              ELSE 'failed'
            END,
            attempts = attempts + 1,
            last_error = 'Reaper: job preso em sending por mais de ' || $1,
            locked_at = NULL,
            locked_by = NULL,
            next_retry_at = NOW() + INTERVAL '10 seconds',
            updated_at = NOW()
      WHERE status = 'sending'
        AND locked_at < NOW() - ($1)::INTERVAL
      RETURNING id, idempotency_key, campaign_id, attempts, max_attempts`,
    [thresholdInterval]
  );

  if (result.rowCount && result.rowCount > 0) {
    console.warn(
      `[CampaignJobs] Reaper coletou ${result.rowCount} jobs presos:`,
      result.rows.map((r) => ({ key: r.idempotency_key, attempts: r.attempts }))
    );
  }

  // Verificar DLQ e logar alerta se necessário
  await checkDlqAlert(pool);
}

async function checkDlqAlert(pool: NonNullable<ReturnType<typeof getZapmassPool>>): Promise<void> {
  try {
    const dlq = await pool.query<{ tenant_id: string; campaign_id: string; cnt: string }>(
      `SELECT tenant_id, campaign_id, COUNT(*) as cnt
         FROM zapmass.campaign_jobs
        WHERE status = 'dead'
          AND created_at > NOW() - INTERVAL '1 hour'
        GROUP BY tenant_id, campaign_id
       HAVING COUNT(*) > 10`
    );

    for (const row of dlq.rows) {
      console.error(
        `[CampaignJobs] ALERTA DLQ: ${row.cnt} jobs mortos na última hora — campaign=${row.campaign_id}, tenant=${row.tenant_id}`
      );
    }
  } catch {
    // não crítico
  }
}

// ─── Métricas de saúde da fila ───────────────────────────────────────────────

export interface QueueHealthMetrics {
  pending: number;
  sending: number;
  failed: number;
  dead: number;
  sent_last_hour: number;
  backpressureActive: boolean;
}

const BACKPRESSURE_THRESHOLD = Number(process.env.BACKPRESSURE_THRESHOLD ?? 200_000);

export async function getQueueHealthMetrics(): Promise<QueueHealthMetrics | null> {
  if (!isZapmassPostgresConfigured()) return null;
  const pool = getZapmassPool();
  if (!pool) return null;

  try {
    const result = await pool.query<{ status: string; cnt: string }>(
      `SELECT status, COUNT(*) as cnt
         FROM zapmass.campaign_jobs
        GROUP BY status`
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.cnt, 10);
    }

    const sentResult = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM zapmass.campaign_jobs WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '1 hour'`
    );

    const pending = counts['pending'] ?? 0;
    return {
      pending,
      sending: counts['sending'] ?? 0,
      failed: counts['failed'] ?? 0,
      dead: counts['dead'] ?? 0,
      sent_last_hour: parseInt(sentResult.rows[0]?.cnt ?? '0', 10),
      backpressureActive: pending > BACKPRESSURE_THRESHOLD,
    };
  } catch {
    return null;
  }
}

/**
 * Verifica se o sistema está sob backpressure (fila PG com > 50k pending).
 * Retorna false quando PG não está configurado (não bloqueia).
 */
export async function isBackpressureActive(): Promise<boolean> {
  const metrics = await getQueueHealthMetrics();
  return metrics?.backpressureActive ?? false;
}

export async function getCampaignJobStatus(idempotencyKey: string): Promise<string | null> {
  const key = String(idempotencyKey || '').trim();
  if (!key || !isZapmassPostgresConfigured()) return null;
  const pool = getZapmassPool();
  if (!pool) return null;
  try {
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM zapmass.campaign_jobs WHERE idempotency_key = $1`,
      [key]
    );
    return r.rows[0]?.status ?? null;
  } catch {
    return null;
  }
}

export async function countCampaignJobsByStatus(campaignId: string): Promise<Record<string, number>> {
  const cid = String(campaignId || '').trim();
  if (!cid || !isZapmassPostgresConfigured()) return {};
  const pool = getZapmassPool();
  if (!pool) return {};
  try {
    const r = await pool.query<{
      pending: string;
      sending: string;
      sent: string;
      failed: string;
      dead: string;
      phantom_settled: string;
    }>(
      `SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
          COUNT(*) FILTER (WHERE status = 'sending')::text AS sending,
          COUNT(*) FILTER (WHERE status = 'sent')::text AS sent,
          COUNT(*) FILTER (WHERE status = 'failed' AND NOT ${CAMPAIGN_JOB_PHANTOM_ERROR_SQL})::text AS failed,
          COUNT(*) FILTER (WHERE status = 'dead' AND NOT ${CAMPAIGN_JOB_PHANTOM_ERROR_SQL})::text AS dead,
          COUNT(*) FILTER (WHERE status IN ('failed', 'dead') AND ${CAMPAIGN_JOB_PHANTOM_ERROR_SQL})::text AS phantom_settled
         FROM zapmass.campaign_jobs
        WHERE campaign_id = $1::uuid`,
      [cid]
    );
    const row = r.rows[0];
    if (!row) return {};
    return mapProgressJobStatusRow(row);
  } catch {
    return {};
  }
}

/** Reenfileira jobs mortos por duplicação de texto / DelayedError (não são falha real). */
export async function requeuePhantomDeadCampaignJobs(campaignId: string): Promise<number> {
  const cid = String(campaignId || '').trim();
  if (!cid || !isZapmassPostgresConfigured()) return 0;
  const pool = getZapmassPool();
  if (!pool) return 0;
  try {
    const r = await pool.query<{ cnt: string }>(
      `WITH upd AS (
          UPDATE zapmass.campaign_jobs
             SET status = 'pending',
                 attempts = 0,
                 last_error = NULL,
                 locked_at = NULL,
                 locked_by = NULL,
                 next_retry_at = NOW(),
                 updated_at = NOW()
           WHERE campaign_id = $1::uuid
             AND status IN ('dead', 'failed')
             AND ${CAMPAIGN_JOB_PHANTOM_ERROR_SQL}
           RETURNING 1
        )
        SELECT COUNT(*)::text AS cnt FROM upd`,
      [cid]
    );
    return parseInt(r.rows[0]?.cnt || '0', 10) || 0;
  } catch (err) {
    console.error('[CampaignJobs] requeuePhantomDeadCampaignJobs:', (err as Error)?.message);
    return 0;
  }
}

export async function resetCampaignJobAfterPhantomFailure(idempotencyKey: string): Promise<void> {
  const key = String(idempotencyKey || '').trim();
  if (!key || !isZapmassPostgresConfigured()) return;
  const pool = getZapmassPool();
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE zapmass.campaign_jobs
          SET status = 'pending',
              attempts = 0,
              last_error = NULL,
              locked_at = NULL,
              locked_by = NULL,
              next_retry_at = NOW(),
              updated_at = NOW()
        WHERE idempotency_key = $1
          AND status IN ('dead', 'failed', 'sending')`,
      [key]
    );
  } catch (err) {
    console.error('[CampaignJobs] resetCampaignJobAfterPhantomFailure:', (err as Error)?.message);
  }
}

export async function countTenantCampaignJobsByStatus(
  tenantId: string
): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  const uid = String(tenantId || '').trim();
  if (!uid || !isZapmassPostgresConfigured()) return out;
  const pool = getZapmassPool();
  if (!pool) return out;
  try {
    const r = await pool.query<{
      campaign_id: string;
      pending: string;
      sending: string;
      sent: string;
      failed: string;
      dead: string;
      phantom_settled: string;
    }>(
      `SELECT
          campaign_id::text AS campaign_id,
          COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
          COUNT(*) FILTER (WHERE status = 'sending')::text AS sending,
          COUNT(*) FILTER (WHERE status = 'sent')::text AS sent,
          COUNT(*) FILTER (WHERE status = 'failed' AND NOT ${CAMPAIGN_JOB_PHANTOM_ERROR_SQL})::text AS failed,
          COUNT(*) FILTER (WHERE status = 'dead' AND NOT ${CAMPAIGN_JOB_PHANTOM_ERROR_SQL})::text AS dead,
          COUNT(*) FILTER (WHERE status IN ('failed', 'dead') AND ${CAMPAIGN_JOB_PHANTOM_ERROR_SQL})::text AS phantom_settled
         FROM zapmass.campaign_jobs
        WHERE tenant_id = $1::uuid AND campaign_id IS NOT NULL
        GROUP BY campaign_id`,
      [uid]
    );
    for (const row of r.rows) {
      const cid = String(row.campaign_id || '').trim();
      if (!cid) continue;
      out.set(cid, mapProgressJobStatusRow(row));
    }
  } catch {
    // não crítico — o card segue com o documento da campanha
  }
  return out;
}

export type CampaignChannelSendStat = {
  connectionId: string;
  sent: number;
  failed: number;
  dead: number;
  pending: number;
  sending: number;
};

export type ConnectionSentCounts = {
  sentToday: number;
  sentTotal: number;
};

export async function countSentJobsByConnection(): Promise<Map<string, ConnectionSentCounts>> {
  const out = new Map<string, ConnectionSentCounts>();
  if (!isZapmassPostgresConfigured()) return out;
  const pool = getZapmassPool();
  if (!pool) return out;
  try {
    const r = await pool.query<{ connection_id: string; sent_today: string; sent_total: string }>(
      `SELECT connection_id,
              COUNT(*) FILTER (WHERE status = 'sent')::text AS sent_total,
              COUNT(*) FILTER (
                WHERE status = 'sent'
                  AND (COALESCE(sent_at, updated_at) AT TIME ZONE 'America/Sao_Paulo')::date
                    = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date
              )::text AS sent_today
         FROM zapmass.campaign_jobs
        GROUP BY connection_id`
    );
    for (const row of r.rows) {
      const id = String(row.connection_id || '').trim();
      if (!id) continue;
      out.set(id, {
        sentToday: parseInt(row.sent_today, 10) || 0,
        sentTotal: parseInt(row.sent_total, 10) || 0,
      });
    }
  } catch (err) {
    console.error('[CampaignJobs] Erro ao contar envios por canal:', (err as Error)?.message);
  }
  return out;
}

export async function countTenantCampaignJobsByConnection(
  tenantId: string
): Promise<Map<string, CampaignChannelSendStat[]>> {
  const out = new Map<string, CampaignChannelSendStat[]>();
  const uid = String(tenantId || '').trim();
  if (!uid || !isUuid(uid) || !isZapmassPostgresConfigured()) return out;
  const pool = getZapmassPool();
  if (!pool) return out;
  try {
    const r = await pool.query<{
      campaign_id: string;
      connection_id: string;
      status: string;
      cnt: string;
    }>(
      `SELECT campaign_id::text AS campaign_id, connection_id, status, COUNT(*)::text AS cnt
         FROM zapmass.campaign_jobs
        WHERE tenant_id = $1::uuid AND campaign_id IS NOT NULL
        GROUP BY campaign_id, connection_id, status`,
      [uid]
    );
    const nested = new Map<string, Map<string, CampaignChannelSendStat>>();
    for (const row of r.rows) {
      const cid = String(row.campaign_id || '').trim();
      const connId = String(row.connection_id || '').trim();
      if (!cid || !connId) continue;
      let byConn = nested.get(cid);
      if (!byConn) {
        byConn = new Map();
        nested.set(cid, byConn);
      }
      let stat = byConn.get(connId);
      if (!stat) {
        stat = { connectionId: connId, sent: 0, failed: 0, dead: 0, pending: 0, sending: 0 };
        byConn.set(connId, stat);
      }
      const n = parseInt(row.cnt, 10) || 0;
      const status = String(row.status || '');
      if (status === 'sent') stat.sent += n;
      else if (status === 'failed') stat.failed += n;
      else if (status === 'dead') stat.dead += n;
      else if (status === 'pending') stat.pending += n;
      else if (status === 'sending') stat.sending += n;
    }
    for (const [cid, byConn] of nested) {
      out.set(cid, [...byConn.values()]);
    }
  } catch (err) {
    console.error('[CampaignJobs] Erro ao contar jobs por canal:', (err as Error)?.message);
  }
  return out;
}

export type SettledCampaignJob = {
  idempotencyKey: string;
  toNumber: string;
  stageIndex: number;
};

export function campaignJobsStillActive(counts: Record<string, number> | undefined): number {
  if (!counts) return 0;
  return (counts.pending || 0) + (counts.sending || 0) + (counts.failed || 0);
}

/**
 * Jobs com campaign_id NULL (campanha apagada no timeout/deploy: ON DELETE SET NULL).
 * Religa ao UUID ainda no payload, ou à única campanha viva do tenant.
 */
export async function reattachOrphanCampaignJobs(tenantId: string): Promise<number> {
  const uid = String(tenantId || '').trim();
  if (!uid || !isUuid(uid) || !isZapmassPostgresConfigured()) return 0;
  const pool = getZapmassPool();
  if (!pool) return 0;
  try {
    const orphan = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
         FROM zapmass.campaign_jobs
        WHERE tenant_id = $1::uuid AND campaign_id IS NULL`,
      [uid]
    );
    const orphanCount = parseInt(orphan.rows[0]?.cnt || '0', 10) || 0;
    if (orphanCount <= 0) return 0;

    const fromPayload = await pool.query(
      `UPDATE zapmass.campaign_jobs j
          SET campaign_id = (j.payload->>'campaignId')::uuid,
              updated_at = NOW()
        WHERE j.tenant_id = $1::uuid
          AND j.campaign_id IS NULL
          AND (j.payload->>'campaignId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND EXISTS (
            SELECT 1 FROM zapmass.campaigns c
             WHERE c.id = (j.payload->>'campaignId')::uuid
               AND c.tenant_id = j.tenant_id
          )`,
      [uid]
    );
    const attached = fromPayload.rowCount ?? 0;

    // Não recolocar órfãos na "única campanha viva": isso marcava a campanha nova
    // como já enviada (idempotency de outra campanha) e o disparo saía com 0 jobs.

    if (attached > 0) {
      console.warn('[CampaignJobs] Relinked orphan jobs to campaign', { tenantId: uid, attached });
    }
    return attached;
  } catch (err) {
    console.error('[CampaignJobs] Erro ao religar jobs órfãos:', (err as Error)?.message);
    return 0;
  }
}

/** Jobs já encerrados: não reenviar nem recontar. */
export async function listCampaignJobToNumbers(campaignId: string): Promise<string[]> {
  const cid = String(campaignId || '').trim();
  if (!cid || !isUuid(cid) || !isZapmassPostgresConfigured()) return [];
  const pool = getZapmassPool();
  if (!pool) return [];
  try {
    const r = await pool.query<{ to_number: string }>(
      `SELECT DISTINCT to_number
         FROM zapmass.campaign_jobs
        WHERE campaign_id = $1::uuid`,
      [cid]
    );
    return r.rows.map((row) => String(row.to_number || '')).filter(Boolean);
  } catch {
    return [];
  }
}
export async function listSettledCampaignJobs(campaignId: string): Promise<SettledCampaignJob[]> {
  const cid = String(campaignId || '').trim();
  if (!cid || !isZapmassPostgresConfigured()) return [];
  const pool = getZapmassPool();
  if (!pool) return [];
  try {
    const r = await pool.query<{ idempotency_key: string; to_number: string; stage_index: number }>(
      `SELECT idempotency_key, to_number, COALESCE(stage_index, 0) AS stage_index
         FROM zapmass.campaign_jobs
        WHERE campaign_id = $1::uuid
          AND status IN ('sent', 'dead')`,
      [cid]
    );
    return r.rows.map((row) => ({
      idempotencyKey: String(row.idempotency_key || ''),
      toNumber: String(row.to_number || ''),
      stageIndex: Number(row.stage_index) || 0,
    }));
  } catch {
    return [];
  }
}

let _lastCampaignJobsCleanupAt = 0;
const CAMPAIGN_JOBS_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const CAMPAIGN_JOBS_CLEANUP_RETENTION_DAYS = 7;

/**
 * Remove linhas antigas (> 7 dias) com status sent/failed/dead da tabela campaign_jobs.
 * Evita crescimento ilimitado da tabela que dispara backpressure prematuro.
 * Executa no máximo uma vez a cada 6 horas.
 */
export async function maybeCleanupOldCampaignJobs(): Promise<void> {
  const now = Date.now();
  if (now - _lastCampaignJobsCleanupAt < CAMPAIGN_JOBS_CLEANUP_INTERVAL_MS) return;
  _lastCampaignJobsCleanupAt = now;
  if (!isZapmassPostgresConfigured()) return;
  const pool = getZapmassPool();
  if (!pool) return;
  try {
    const r = await pool.query(
      `DELETE FROM zapmass.campaign_jobs
        WHERE status IN ('sent', 'failed', 'dead')
          AND COALESCE(sent_at, updated_at, created_at) < NOW() - INTERVAL '${CAMPAIGN_JOBS_CLEANUP_RETENTION_DAYS} days'`
    );
    const deleted = r.rowCount ?? 0;
    if (deleted > 0) {
      console.info(`[CampaignJobsCleanup] ${deleted} linhas antigas removidas (>${CAMPAIGN_JOBS_CLEANUP_RETENTION_DAYS}d).`);
    }
  } catch (e) {
    console.warn('[CampaignJobsCleanup] Falha:', (e as Error)?.message);
  }
}
