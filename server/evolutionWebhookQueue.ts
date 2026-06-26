/**
 * Fila BullMQ para webhooks Evolution — desacopla HTTP do processamento pesado.
 * Campanhas usam fila separada (`campaign-messages`) para evitar starvation.
 */
import { createHash } from 'crypto';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { normalizeEvolutionWebhookMessages } from './evolutionWebhookMessages.js';
import {
  markEvolutionWebhookJobProcessed,
  recordEvolutionWebhookLagMs,
  setEvolutionWebhookQueueDepth,
} from './chatOpsMetrics.js';

export type EvolutionWebhookJobPayload = {
  event: unknown;
  receivedAt: number;
};

let redisConnection: IORedis | null = null;
let webhookQueue: Queue<EvolutionWebhookJobPayload> | null = null;
let webhookWorker: Worker<EvolutionWebhookJobPayload> | null = null;
let processWebhook: ((event: unknown) => Promise<void>) | null = null;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

/** Fila ativa quando há REDIS_URL e não desligada explicitamente. */
export function isEvolutionWebhookQueueEnabled(): boolean {
  const raw = process.env.EVOLUTION_WEBHOOK_QUEUE_ENABLED?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return Boolean(getRedisUrl());
}

function getRedisConnection(): IORedis | null {
  const url = getRedisUrl();
  if (!url) return null;
  if (!redisConnection) {
    redisConnection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
      reconnectOnError: () => true,
    });
    redisConnection.on('error', (err) => {
      console.warn('[evolution-webhook-queue] redis error:', err?.message || err);
    });
  }
  return redisConnection;
}

function getWebhookQueue(): Queue<EvolutionWebhookJobPayload> | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  if (!webhookQueue) {
    webhookQueue = new Queue<EvolutionWebhookJobPayload>('evolution-webhook', { connection: conn });
  }
  return webhookQueue;
}

/** BullMQ rejeita job IDs com `:` — delimitador seguro em todos os segmentos. */
const JOB_ID_SEP = '__';

function sanitizeBullJobId(raw: string): string {
  return raw.replace(/:/g, JOB_ID_SEP).slice(0, 220);
}

/** Idempotência / dedupe de rajadas (mesma mensagem ou mesmo update). */
export function buildEvolutionWebhookJobId(event: unknown): string {
  const ev = (event && typeof event === 'object' ? event : {}) as Record<string, unknown>;
  const instance = String(ev.instance ?? ev.instanceName ?? 'unknown');
  const eventName = String(ev.event || 'unknown').toUpperCase().replace(/\./g, '_');
  const data = ev.data ?? ev;

  if (eventName === 'MESSAGES_UPSERT') {
    const items = normalizeEvolutionWebhookMessages(data);
    const ids = items
      .map((m) => m?.key?.id)
      .filter((id): id is string => Boolean(id))
      .join('_');
    if (ids) return sanitizeBullJobId(`${'MU'}${JOB_ID_SEP}${instance}${JOB_ID_SEP}${ids}`);
  }

  if (eventName === 'MESSAGES_UPDATE') {
    const updates = Array.isArray(data) ? data : data ? [data] : [];
    const parts = updates
      .map((u: Record<string, unknown>) => {
        const key = (u?.key as Record<string, unknown>) || {};
        const messageId = key.id ?? u.keyId;
        const status = (u?.update as Record<string, unknown>)?.status ?? u.status;
        return messageId != null && status != null
          ? `${messageId}${JOB_ID_SEP}${status}`
          : '';
      })
      .filter(Boolean);
    if (parts.length) {
      return sanitizeBullJobId(`${'MUPD'}${JOB_ID_SEP}${instance}${JOB_ID_SEP}${parts.join('_')}`);
    }
  }

  if (eventName === 'CONNECTION_UPDATE') {
    const h = createHash('sha256')
      .update(`${instance}:${JSON.stringify(data)}`)
      .digest('hex')
      .slice(0, 14);
    return sanitizeBullJobId(`${'CONN'}${JOB_ID_SEP}${instance}${JOB_ID_SEP}${h}`);
  }

  if (eventName === 'QRCODE_UPDATED') {
    return sanitizeBullJobId(
      `${'QR'}${JOB_ID_SEP}${instance}${JOB_ID_SEP}${createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12)}`
    );
  }

  const h = createHash('sha256').update(JSON.stringify(ev)).digest('hex').slice(0, 16);
  return sanitizeBullJobId(`${'EV'}${JOB_ID_SEP}${eventName}${JOB_ID_SEP}${instance}${JOB_ID_SEP}${h}`);
}

function isDuplicateJobError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || '');
  return /job.*already exists|duplicate/i.test(msg);
}

export function initEvolutionWebhookQueue(processor: (event: unknown) => Promise<void>): void {
  processWebhook = processor;
  ensureEvolutionWebhookWorker();
}

export function ensureEvolutionWebhookWorker(): void {
  if (!isEvolutionWebhookQueueEnabled() || !processWebhook) return;
  const conn = getRedisConnection();
  if (!conn || webhookWorker) return;

  const concurrency = Math.max(
    1,
    Math.min(32, parseInt(process.env.EVOLUTION_WEBHOOK_WORKER_CONCURRENCY || '8', 10))
  );

  webhookWorker = new Worker<EvolutionWebhookJobPayload>(
    'evolution-webhook',
    async (job: Job<EvolutionWebhookJobPayload>) => {
      const lagMs = Date.now() - (job.data.receivedAt || Date.now());
      recordEvolutionWebhookLagMs(lagMs);
      if (lagMs > 5000) {
        console.warn('[evolution-webhook-queue] job com fila alta', {
          lagMs,
          event: String((job.data.event as Record<string, unknown>)?.event || ''),
        });
      }
      try {
        await processWebhook!(job.data.event);
        markEvolutionWebhookJobProcessed(true);
      } catch (err) {
        markEvolutionWebhookJobProcessed(false);
        throw err;
      }
    },
    {
      connection: conn.duplicate(),
      concurrency,
      limiter: {
        max: Math.max(10, parseInt(process.env.EVOLUTION_WEBHOOK_LIMITER_MAX || '40', 10)),
        duration: 1000,
      },
    }
  );

  webhookWorker.on('failed', (job, err) => {
    console.error('[evolution-webhook-queue] job falhou', {
      event: String((job?.data?.event as Record<string, unknown>)?.event || ''),
      error: err?.message,
      attempts: job?.attemptsMade,
    });
  });

  console.info(
    `[evolution-webhook-queue] worker iniciado (concurrency=${concurrency}, queue=evolution-webhook)`
  );
}

const ENQUEUE_TIMEOUT_MS = 8_000;

/**
 * Enfileira webhook. Retorna `queued: false` se Redis indisponível ou fila desligada.
 */
export async function enqueueEvolutionWebhook(
  event: unknown
): Promise<{ queued: boolean; reason?: string }> {
  if (!isEvolutionWebhookQueueEnabled()) {
    return { queued: false, reason: 'disabled' };
  }
  ensureEvolutionWebhookWorker();
  const queue = getWebhookQueue();
  if (!queue) return { queued: false, reason: 'no_redis' };

  const jobId = buildEvolutionWebhookJobId(event);
  const addPromise = queue.add(
    'process',
    { event, receivedAt: Date.now() },
    {
      jobId,
      attempts: Math.max(1, parseInt(process.env.EVOLUTION_WEBHOOK_JOB_ATTEMPTS || '3', 10)),
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 5000,
      removeOnFail: 2000,
    }
  );

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      addPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Timeout ao enfileirar webhook (Redis lento).')),
          ENQUEUE_TIMEOUT_MS
        );
      }),
    ]);
    return { queued: true };
  } catch (err) {
    if (isDuplicateJobError(err)) return { queued: true, reason: 'duplicate' };
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Enfileira ou processa na thread HTTP (fallback quando sem Redis).
 */
export type EvolutionWebhookQueueMetrics = {
  enabled: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
};

/** Profundidade da fila (BullMQ) — para /api/health/deep e Prometheus. */
export async function getEvolutionWebhookQueueMetrics(): Promise<EvolutionWebhookQueueMetrics> {
  const empty = { enabled: false, waiting: 0, active: 0, delayed: 0, failed: 0 };
  if (!isEvolutionWebhookQueueEnabled()) return empty;
  const queue = getWebhookQueue();
  if (!queue) return empty;
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    const snap = {
      enabled: true,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
    };
    setEvolutionWebhookQueueDepth(snap);
    return snap;
  } catch {
    return empty;
  }
}

export async function dispatchEvolutionWebhook(event: unknown): Promise<{
  queued: boolean;
  processedSync?: boolean;
  reason?: string;
}> {
  try {
    const ev = (event && typeof event === 'object' ? event : {}) as Record<string, unknown>;
    const eventName = String(ev.event || 'unknown').toUpperCase();
    if (eventName === 'SEND_MESSAGE' || eventName === 'PRESENCE_UPDATE') {
      return { queued: false, reason: 'ignored_event' };
    }

    const enq = await enqueueEvolutionWebhook(event);
    if (enq.queued) return { queued: true, reason: enq.reason };

    const allowSync =
      process.env.EVOLUTION_WEBHOOK_SYNC_FALLBACK?.trim().toLowerCase() !== 'false';
    if (allowSync && processWebhook) {
      await processWebhook(event);
      return { queued: false, processedSync: true, reason: enq.reason || 'fallback_sync' };
    }
    return { queued: false, reason: enq.reason || 'not_queued' };
  } catch (err) {
    console.error('[evolution-webhook-queue] enqueue falhou — fallback sync', (err as Error)?.message);
    if (processWebhook) {
      await processWebhook(event);
      return { queued: false, processedSync: true, reason: 'enqueue_error_fallback' };
    }
    throw err;
  }
}
