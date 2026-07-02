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

import { getZapmassPool, isZapmassPostgresConfigured } from './db/postgres.js';

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
        record.campaignId ?? null,
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

const BACKPRESSURE_THRESHOLD = 50_000;

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
