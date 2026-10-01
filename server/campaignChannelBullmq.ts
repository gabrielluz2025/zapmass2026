/**
 * Filas BullMQ de campanha isoladas por `connectionId` (nível B).
 * Legado `campaign-messages` permanece só para drenagem/migração.
 */
import { createHash } from 'crypto';
import type { Job, Processor, Queue, Worker } from 'bullmq';
import { Queue as BullQueue, Worker as BullWorker } from 'bullmq';
import type IORedis from 'ioredis';

const REGISTRY_KEY = 'zapmass:camp-ch-registry';
export const LEGACY_CAMPAIGN_QUEUE_NAME = 'campaign-messages';
const MIGRATED_FLAG_KEY = 'zapmass:camp-ch-legacy-drained-v1';

export type CampaignMassQueueJobOptions = {
  removeOnComplete: boolean | number | { count: number; age?: number };
  removeOnFail: boolean | number | { count: number; age?: number };
};

export function usePerChannelCampaignQueues(): boolean {
  return process.env.CAMPAIGN_USE_GLOBAL_QUEUE !== '1';
}

export function hashConnectionIdForQueue(connectionId: string): string {
  return createHash('sha256').update(String(connectionId || '').trim()).digest('hex').slice(0, 24);
}

export function campaignMassQueueName(connectionId: string): string {
  return `campaign-ch-${hashConnectionIdForQueue(connectionId)}`;
}

export function bullPrefixForMassQueue(queueName: string): string {
  return `bull:${queueName}`;
}

const queueByConnectionId = new Map<string, Queue>();
const workerByConnectionId = new Map<string, Worker>();
let legacyDrainWorker: Worker | null = null;
let legacyMigrationDone = false;

export function getCachedCampaignMassQueues(): Queue[] {
  return [...queueByConnectionId.values()];
}

export function getOrCreateCampaignMassQueue(
  redisConn: IORedis,
  connectionId: string,
  defaultJobOptions: CampaignMassQueueJobOptions
): Queue | null {
  const id = String(connectionId || '').trim();
  if (!id) return null;
  let q = queueByConnectionId.get(id);
  if (!q) {
    const name = campaignMassQueueName(id);
    q = new BullQueue(name, {
      connection: redisConn,
      defaultJobOptions,
    });
    queueByConnectionId.set(id, q);
    void redisConn.sadd(REGISTRY_KEY, id).catch(() => undefined);
  }
  return q;
}

export async function listRegisteredCampaignConnectionIds(redis: IORedis | null): Promise<string[]> {
  const ids = new Set<string>(queueByConnectionId.keys());
  if (redis) {
    const reg = await redis.smembers(REGISTRY_KEY).catch(() => [] as string[]);
    for (const id of reg) {
      const t = String(id || '').trim();
      if (t) ids.add(t);
    }
  }
  return [...ids];
}

export async function resolveAllCampaignMassQueues(
  redisConn: IORedis | null,
  defaultJobOptions: CampaignMassQueueJobOptions
): Promise<Queue[]> {
  if (!redisConn) return getCachedCampaignMassQueues();
  const ids = await listRegisteredCampaignConnectionIds(redisConn);
  const out: Queue[] = [];
  for (const id of ids) {
    const q = getOrCreateCampaignMassQueue(redisConn, id, defaultJobOptions);
    if (q) out.push(q);
  }
  return out.length > 0 ? out : getCachedCampaignMassQueues();
}

/** Fecha workers/filas por chip — obrigatório após reset da conexão Redis do BullMQ. */
export async function resetCampaignChannelBullmqState(): Promise<void> {
  for (const w of workerByConnectionId.values()) {
    await w.close().catch(() => undefined);
  }
  workerByConnectionId.clear();
  if (legacyDrainWorker) {
    await legacyDrainWorker.close().catch(() => undefined);
    legacyDrainWorker = null;
  }
  for (const q of queueByConnectionId.values()) {
    await q.close().catch(() => undefined);
  }
  queueByConnectionId.clear();
}

export async function forEachCampaignMassQueue(
  redisConn: IORedis | null,
  defaultJobOptions: CampaignMassQueueJobOptions,
  fn: (queue: Queue) => void | Promise<void>
): Promise<void> {
  const queues = await resolveAllCampaignMassQueues(redisConn, defaultJobOptions);
  for (const q of queues) {
    await fn(q);
  }
}

export type CampaignMassWorkerOpts = {
  lockDuration: number;
  onFailed: (job: Job | undefined, err: Error) => void;
};

export function ensureCampaignMassWorker(
  redisConn: IORedis,
  connectionId: string,
  processor: Processor,
  opts: CampaignMassWorkerOpts
): Worker {
  const id = String(connectionId || '').trim();
  let w = workerByConnectionId.get(id);
  if (w) return w;
  const perChannelConcurrency = Math.max(
    1,
    Math.min(4, parseInt(process.env.CAMPAIGN_CHANNEL_WORKER_CONCURRENCY || '1', 10))
  );
  const queueName = campaignMassQueueName(id);
  w = new BullWorker(queueName, processor, {
    connection: redisConn.duplicate(),
    concurrency: perChannelConcurrency,
    limiter: { max: 8, duration: 1000 },
    lockDuration: opts.lockDuration,
    lockRenewTime: Math.round(opts.lockDuration / 4),
    stalledInterval: 60_000,
    maxStalledCount: 3,
  });
  w.on('failed', (job, err) => opts.onFailed(job, err));
  workerByConnectionId.set(id, w);
  return w;
}

/** Worker de baixa concorrência só para esvaziar `campaign-messages` após migração por chip. */
export function ensureLegacyCampaignDrainWorker(
  redisConn: IORedis,
  processor: Processor,
  opts: CampaignMassWorkerOpts
): Worker | null {
  if (legacyDrainWorker) return legacyDrainWorker;
  legacyDrainWorker = new BullWorker(LEGACY_CAMPAIGN_QUEUE_NAME, processor, {
    connection: redisConn.duplicate(),
    concurrency: 1,
    lockDuration: opts.lockDuration,
    lockRenewTime: Math.round(opts.lockDuration / 4),
    stalledInterval: 60_000,
    maxStalledCount: 2,
  });
  legacyDrainWorker.on('failed', (job, err) => opts.onFailed(job, err));
  return legacyDrainWorker;
}

export async function aggregateCampaignMassQueueMetrics(
  redisConn: IORedis | null,
  defaultJobOptions: CampaignMassQueueJobOptions,
  legacyQueue: Queue | null
): Promise<{ enabled: boolean; waiting: number; active: number; delayed: number; failed: number; channelQueues: number }> {
  const empty = { enabled: false, waiting: 0, active: 0, delayed: 0, failed: 0, channelQueues: 0 };
  if (!redisConn) return empty;
  const queues = await resolveAllCampaignMassQueues(redisConn, defaultJobOptions);
  const all = legacyQueue ? [...queues, legacyQueue] : queues;
  if (all.length === 0) return empty;
  let waiting = 0;
  let active = 0;
  let delayed = 0;
  let failed = 0;
  for (const q of all) {
    try {
      const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
      waiting += c.waiting ?? 0;
      active += c.active ?? 0;
      delayed += c.delayed ?? 0;
      failed += c.failed ?? 0;
    } catch {
      /* fila removida */
    }
  }
  return {
    enabled: true,
    waiting,
    active,
    delayed,
    failed,
    channelQueues: queues.length,
  };
}

/** Move jobs waiting/delayed da fila global para a fila do chip (uma vez por deploy cluster). */
export async function migrateLegacyGlobalCampaignQueueOnce(
  redis: IORedis,
  legacyQueue: Queue,
  defaultJobOptions: CampaignMassQueueJobOptions
): Promise<number> {
  if (legacyMigrationDone) return 0;
  const done = await redis.get(MIGRATED_FLAG_KEY).catch(() => null);
  if (done === '1') {
    legacyMigrationDone = true;
    return 0;
  }
  let moved = 0;
  for (const state of ['waiting', 'delayed', 'paused'] as const) {
    let start = 0;
    for (;;) {
      const batch = await legacyQueue.getJobs([state], start, start + 99, true);
      if (batch.length === 0) break;
      for (const job of batch) {
        const data = job.data as { connectionId?: string };
        const connId = String(data?.connectionId || '').trim();
        if (!connId) continue;
        const target = getOrCreateCampaignMassQueue(redis, connId, defaultJobOptions);
        if (!target) continue;
        try {
          await target.add(job.name || 'send', job.data, {
            ...job.opts,
            jobId: job.id ? String(job.id) : undefined,
          });
          await job.remove();
          moved += 1;
        } catch {
          /* jobId duplicado = já migrado */
        }
      }
      if (batch.length < 100) break;
      start += 100;
    }
  }
  await redis.set(MIGRATED_FLAG_KEY, '1', 'EX', 7 * 24 * 3600).catch(() => undefined);
  legacyMigrationDone = true;
  return moved;
}

export type CampaignMassQueueDepth = {
  waiting: number;
  active: number;
  delayed: number;
  paused: number;
};

export function campaignMassQueueDepthTotal(d: CampaignMassQueueDepth): number {
  return (d.waiting || 0) + (d.active || 0) + (d.delayed || 0) + (d.paused || 0);
}

/** Profundidade real da fila BullMQ de massa do chip (waiting+active+delayed+paused). */
export async function getCampaignMassQueueDepth(
  redisConn: IORedis | null,
  connectionId: string,
  defaultJobOptions: CampaignMassQueueJobOptions
): Promise<CampaignMassQueueDepth> {
  const empty: CampaignMassQueueDepth = { waiting: 0, active: 0, delayed: 0, paused: 0 };
  const id = String(connectionId || '').trim();
  if (!id || !redisConn) return empty;
  const q = getOrCreateCampaignMassQueue(redisConn, id, defaultJobOptions);
  if (!q) return empty;
  try {
    const c = await q.getJobCounts('waiting', 'active', 'delayed', 'paused');
    return {
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      paused: c.paused ?? 0,
    };
  } catch {
    return empty;
  }
}

export async function sumRedisMassQueueDepth(redis: IORedis): Promise<{ waitLen: number; delayedLen: number }> {
  let waitLen = 0;
  let delayedLen = 0;
  if (!usePerChannelCampaignQueues()) {
    const w = await redis.llen(`bull:${LEGACY_CAMPAIGN_QUEUE_NAME}:wait`).catch(() => 0);
    const d = await redis.zcard(`bull:${LEGACY_CAMPAIGN_QUEUE_NAME}:delayed`).catch(() => 0);
    return { waitLen: Number(w) || 0, delayedLen: Number(d) || 0 };
  }
  const ids = await listRegisteredCampaignConnectionIds(redis);
  for (const id of ids) {
    const name = campaignMassQueueName(id);
    const prefix = bullPrefixForMassQueue(name);
    waitLen += Number(await redis.llen(`${prefix}:wait`).catch(() => 0)) || 0;
    delayedLen += Number(await redis.zcard(`${prefix}:delayed`).catch(() => 0)) || 0;
  }
  const lw = Number(await redis.llen(`bull:${LEGACY_CAMPAIGN_QUEUE_NAME}:wait`).catch(() => 0)) || 0;
  const ld = Number(await redis.zcard(`bull:${LEGACY_CAMPAIGN_QUEUE_NAME}:delayed`).catch(() => 0)) || 0;
  return { waitLen: waitLen + lw, delayedLen: delayedLen + ld };
}

/** SCAN purge patterns for a campaign jobId prefix across global + per-channel queues. */
export function campaignJobScanPatterns(campaignId: string): string[] {
  const cid = String(campaignId || '').trim();
  if (!cid) return [];
  const suffix = `${cid}__*`;
  return [`bull:${LEGACY_CAMPAIGN_QUEUE_NAME}:${suffix}`, `bull:campaign-ch-*:${suffix}`];
}
