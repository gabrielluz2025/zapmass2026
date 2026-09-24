/**
 * Inspeção e purge seguro de jobs BullMQ `campaign-messages` por campaignId.
 */

import type { Job, Queue } from 'bullmq';
import type IORedis from 'ioredis';
import {
  collectCampaignJobCountsFromQueue,
  countQueueJobsForCampaign,
  forEachCampaignQueueJob,
  type CampaignQueueScanState,
} from './campaignQueueScan.js';

const QUEUE_KEY_PREFIX = 'bull:campaign-messages';

/**
 * Purge rápido via Redis SCAN:
 * Em vez de iterar todos os jobs da fila (O(totalJobs)),
 * usa SCAN com padrão `{prefix}:{campaignId}__*` para encontrar
 * apenas os jobs da campanha e removê-los com pipeline.
 * Muito mais rápido para campanhas grandes (>1k jobs).
 */
export async function fastPurgeCampaignJobsByRedis(
  campaignId: string,
  redisClient: IORedis
): Promise<number> {
  const cid = String(campaignId || '').trim();
  if (!cid) return 0;

  const pattern = `${QUEUE_KEY_PREFIX}:${cid}__*`;
  const jobIds: string[] = [];

  // SCAN para encontrar todos os hashes de jobs desta campanha
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redisClient.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      '500'
    );
    cursor = nextCursor;
    for (const key of keys) {
      const jobId = key.slice(QUEUE_KEY_PREFIX.length + 1);
      if (jobId) jobIds.push(jobId);
    }
  } while (cursor !== '0');

  if (jobIds.length === 0) return 0;

  // Obter lista de jobs ativos para não remover em voo
  const activeIds = new Set<string>(
    await redisClient.lrange(`${QUEUE_KEY_PREFIX}:active`, 0, -1)
  );

  const toDelete = jobIds.filter((id) => !activeIds.has(id));
  if (toDelete.length === 0) return 0;

  const BATCH = 500;
  let removed = 0;

  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = toDelete.slice(i, i + BATCH);
    const pipeline = redisClient.pipeline();

    // Remove do sorted set de delayed e prioridade
    pipeline.zrem(`${QUEUE_KEY_PREFIX}:delayed`, ...batch);
    pipeline.zrem(`${QUEUE_KEY_PREFIX}:prioritized`, ...batch);

    // Remove das listas wait e paused (LREM = O(N) por chamada, mas com pipeline)
    for (const jobId of batch) {
      pipeline.lrem(`${QUEUE_KEY_PREFIX}:wait`, 0, jobId);
      pipeline.lrem(`${QUEUE_KEY_PREFIX}:paused`, 0, jobId);
      pipeline.del(`${QUEUE_KEY_PREFIX}:${jobId}`);
      pipeline.del(`${QUEUE_KEY_PREFIX}:${jobId}:logs`);
    }

    await pipeline.exec();
    removed += batch.length;
  }

  return removed;
}

export type CampaignQueueStateCounts = Record<CampaignQueueScanState, number>;

export type CampaignQueueSummaryRow = {
  campaignId: string;
  ownerUid?: string;
  jobs: number;
  byState: CampaignQueueStateCounts;
};

export type CampaignQueueSummary = {
  scannedJobs: number;
  campaigns: CampaignQueueSummaryRow[];
};

export type CampaignQueuePurgeResult = {
  campaignId: string;
  dryRun: boolean;
  matched: number;
  removed: number;
  wouldRemove: number;
  skippedActive: number;
  failedRemove: number;
  byState: CampaignQueueStateCounts;
};

function emptyStateCounts(): CampaignQueueStateCounts {
  return { active: 0, waiting: 0, delayed: 0, paused: 0 };
}

/** Varre a fila (paginada) e agrupa por campanha + estado. */
export async function buildCampaignQueueSummary(
  queue: Queue | null | undefined,
  opts?: { campaignId?: string; topLimit?: number }
): Promise<CampaignQueueSummary> {
  const filterCid = String(opts?.campaignId || '').trim();
  const topLimit = Math.max(1, Math.min(100, opts?.topLimit ?? 25));

  const byCampaign = new Map<
    string,
    { ownerUid?: string; byState: CampaignQueueStateCounts; total: number }
  >();
  let scannedJobs = 0;

  if (!queue) {
    return { scannedJobs: 0, campaigns: [] };
  }

  await forEachCampaignQueueJob(queue, async (job, state) => {
    scannedJobs += 1;
    const data = job.data || {};
    const cid = String(data.campaignId || '').trim();
    if (!cid) return;
    if (filterCid && cid !== filterCid) return;

    let row = byCampaign.get(cid);
    if (!row) {
      row = { byState: emptyStateCounts(), total: 0 };
      byCampaign.set(cid, row);
    }
    row.byState[state] += 1;
    row.total += 1;
    const uid = String(data.ownerUid || data.replyFlowOpen?.ownerUid || '').trim();
    if (uid && !row.ownerUid) row.ownerUid = uid;
  });

  const campaigns: CampaignQueueSummaryRow[] = [...byCampaign.entries()]
    .map(([campaignId, row]) => ({
      campaignId,
      ownerUid: row.ownerUid,
      jobs: row.total,
      byState: row.byState,
    }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, filterCid ? byCampaign.size : topLimit);

  return { scannedJobs, campaigns };
}

/** Contagem BullMQ para uma campanha (todos os estados). */
export async function countCampaignQueueJobsDetailed(
  queue: Queue | null | undefined,
  campaignId: string
): Promise<{ total: number; byState: CampaignQueueStateCounts }> {
  const cid = String(campaignId || '').trim();
  const byState = emptyStateCounts();
  if (!queue || !cid) return { total: 0, byState };

  await forEachCampaignQueueJob(queue, async (job, state) => {
    if (String(job.data?.campaignId || '').trim() !== cid) return;
    byState[state] += 1;
  });
  const total = byState.active + byState.waiting + byState.delayed + byState.paused;
  return { total, byState };
}

/** Remove jobs waiting/delayed/paused da campanha. Active em voo não é removido (evita corrida). */
export async function purgeCampaignQueueJobs(
  queue: Queue,
  campaignId: string,
  opts: { dryRun: boolean }
): Promise<CampaignQueuePurgeResult> {
  const cid = String(campaignId || '').trim();
  const byState = emptyStateCounts();
  let matched = 0;
  let removed = 0;
  let wouldRemove = 0;
  let skippedActive = 0;
  let failedRemove = 0;
  const toRemove: Job[] = [];

  await forEachCampaignQueueJob(queue, async (job, state) => {
    if (String(job.data?.campaignId || '').trim() !== cid) return;
    matched += 1;
    byState[state] += 1;

    if (state === 'active') {
      skippedActive += 1;
      return;
    }

    if (opts.dryRun) {
      wouldRemove += 1;
      return;
    }

    toRemove.push(job);
  });

  for (const job of toRemove) {
    try {
      await job.remove();
      removed += 1;
    } catch {
      failedRemove += 1;
    }
  }

  return {
    campaignId: cid,
    dryRun: opts.dryRun,
    matched,
    removed,
    wouldRemove,
    skippedActive,
    failedRemove,
    byState,
  };
}

/** Atalho: top campanhas na fila + owners (scan completo de IDs). */
export async function listTopCampaignsInQueue(
  queue: Queue | null | undefined,
  limit = 20
): Promise<{ counts: Map<string, number>; ownerByCampaign: Map<string, string> }> {
  return collectCampaignJobCountsFromQueue(queue).then(({ counts, ownerByCampaign }) => {
    if (counts.size <= limit) return { counts, ownerByCampaign };
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const topCounts = new Map(sorted);
    const topOwners = new Map<string, string>();
    for (const [cid] of sorted) {
      const ou = ownerByCampaign.get(cid);
      if (ou) topOwners.set(cid, ou);
    }
    return { counts: topCounts, ownerByCampaign: topOwners };
  });
}

export async function countQueueJobsForCampaignId(
  queue: Queue | null | undefined,
  campaignId: string
): Promise<number> {
  return countQueueJobsForCampaign(queue, campaignId);
}
