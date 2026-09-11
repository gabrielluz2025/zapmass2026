/**
 * Fila BullMQ para checagem periódica de proxy (egress IP / ASN / drift).
 */
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { getEffectiveRedisUrl } from './redisConfig.js';
import { attachRedisStressGuard, attachWorkerStressGuard } from './redisBullmqResilience.js';
import { bullmqRemoveOnComplete, bullmqRemoveOnFail } from './bullmqRetention.js';
import type { ConnectionProxyConfig } from './proxyHealthMonitor.js';
import { clearProxyHealthState, runProxyHealthCheck } from './proxyHealthMonitor.js';

export type ProxyHealthJobPayload = {
  connectionId: string;
  ownerUid?: string;
  proxy: ConnectionProxyConfig;
  connectedSinceMs?: number | null;
};

const QUEUE_NAME = 'proxy-health';
const REPEAT_EVERY_MS = Number(process.env.PROXY_HEALTH_CHECK_INTERVAL_MS ?? 4 * 60 * 60 * 1000);

let redisConnection: IORedis | null = null;
let proxyHealthQueue: Queue<ProxyHealthJobPayload> | null = null;
let proxyHealthWorker: Worker<ProxyHealthJobPayload> | null = null;

function getRedisConnection(): IORedis | null {
  const url = getEffectiveRedisUrl();
  if (!url) return null;
  if (redisConnection && (redisConnection.status === 'end' || redisConnection.status === 'close')) {
    redisConnection = null;
  }
  if (!redisConnection) {
    redisConnection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    attachRedisStressGuard(redisConnection, {
      name: QUEUE_NAME,
      reset: () => {
        proxyHealthWorker?.close().catch(() => undefined);
        proxyHealthWorker = null;
        proxyHealthQueue = null;
        redisConnection?.disconnect();
        redisConnection = null;
      },
      ensureWorker: ensureProxyHealthWorker,
    });
  }
  return redisConnection;
}

export function getProxyHealthBullmqQueue(): Queue<ProxyHealthJobPayload> | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  if (!proxyHealthQueue) {
    proxyHealthQueue = new Queue<ProxyHealthJobPayload>(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: bullmqRemoveOnComplete(),
        removeOnFail: bullmqRemoveOnFail(),
      },
    });
  }
  return proxyHealthQueue;
}

async function processProxyHealthJob(job: Job<ProxyHealthJobPayload>): Promise<void> {
  const payload = job.data;
  if (!payload?.connectionId || !payload.proxy?.host) return;
  await runProxyHealthCheck({
    connectionId: payload.connectionId,
    proxy: payload.proxy,
    ownerUid: payload.ownerUid,
    connectedSinceMs: payload.connectedSinceMs,
  });
}

export function ensureProxyHealthWorker(): void {
  const conn = getRedisConnection();
  if (!conn || proxyHealthWorker) return;
  proxyHealthWorker = new Worker<ProxyHealthJobPayload>(QUEUE_NAME, processProxyHealthJob, {
    connection: conn.duplicate(),
    concurrency: 2,
  });
  attachWorkerStressGuard(proxyHealthWorker, {
    name: QUEUE_NAME,
    reset: () => undefined,
    ensureWorker: ensureProxyHealthWorker,
  });
  proxyHealthWorker.on('failed', (job, err) => {
    console.warn('[proxy-health] job failed', {
      connectionId: job?.data?.connectionId,
      error: err?.message,
    });
  });
}

export async function syncProxyHealthRepeatableJob(params: {
  connectionId: string;
  ownerUid?: string;
  proxy: ConnectionProxyConfig | null | undefined;
  connectedSinceMs?: number | null;
}): Promise<void> {
  const queue = getProxyHealthBullmqQueue();
  const connectionId = String(params.connectionId || '').trim();
  if (!queue || !connectionId) return;

  const repeatJobId = `proxy-health-${connectionId}`;

  if (!params.proxy?.host || !params.proxy.port) {
    const repeatable = await queue.getRepeatableJobs();
    for (const job of repeatable) {
      if (job.id === repeatJobId || job.key.includes(repeatJobId)) {
        await queue.removeRepeatableByKey(job.key).catch(() => undefined);
      }
    }
    await clearProxyHealthState(connectionId);
    return;
  }

  await queue.add(
    'check',
    {
      connectionId,
      ownerUid: params.ownerUid,
      proxy: params.proxy,
      connectedSinceMs: params.connectedSinceMs,
    },
    {
      repeat: { every: REPEAT_EVERY_MS, jobId: repeatJobId },
    }
  );

  await queue.add(
    'check',
    {
      connectionId,
      ownerUid: params.ownerUid,
      proxy: params.proxy,
      connectedSinceMs: params.connectedSinceMs,
    },
    {
      jobId: `${repeatJobId}-boot-${Date.now()}`,
      delay: 15_000,
    }
  );
}

export async function bootstrapProxyHealthJobs(
  listConnections: () => Array<{
    id: string;
    ownerUid?: string;
    proxy?: ConnectionProxyConfig | null;
    connectedSinceMs?: number | null;
  }>
): Promise<void> {
  ensureProxyHealthWorker();
  for (const conn of listConnections()) {
    if (!conn.proxy?.host || !conn.proxy.port) continue;
    await syncProxyHealthRepeatableJob({
      connectionId: conn.id,
      ownerUid: conn.ownerUid,
      proxy: conn.proxy,
      connectedSinceMs: conn.connectedSinceMs,
    });
  }
}

export function initProxyHealthQueue(
  listConnections: () => Array<{
    id: string;
    ownerUid?: string;
    proxy?: ConnectionProxyConfig | null;
    connectedSinceMs?: number | null;
  }>
): void {
  if (!getEffectiveRedisUrl()) return;
  void bootstrapProxyHealthJobs(listConnections).catch((err) => {
    console.warn('[proxy-health] bootstrap failed:', (err as Error)?.message);
  });
}
