/**
 * Inspeção e purge seguro de jobs BullMQ `campaign-messages` por campaignId.
 */

import type { Job, Queue } from 'bullmq';
import type IORedis from 'ioredis';
import {
  campaignJobScanPatterns,
} from './campaignChannelBullmq.js';
import {
  collectCampaignJobCountsFromQueue,
  countQueueJobsForCampaign,
  forEachCampaignQueueJob,
  type CampaignQueueScanState,
} from './campaignQueueScan.js';

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

  const patterns = campaignJobScanPatterns(cid);
  const jobsByPrefix = new Map<string, string[]>();

  for (const pattern of patterns) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', '500');
      cursor = nextCursor;
      for (const key of keys) {
        const sep = key.indexOf(':', 5);
        if (sep < 0) continue;
        const prefix = key.slice(0, sep);
        const jobId = key.slice(sep + 1);
        if (!jobId) continue;
        const list = jobsByPrefix.get(prefix) || [];
        list.push(jobId);
        jobsByPrefix.set(prefix, list);
      }
    } while (cursor !== '0');
  }

  if (jobsByPrefix.size === 0) return 0;

  let removed = 0;
  for (const [prefix, jobIds] of jobsByPrefix) {
    const unique = [...new Set(jobIds)];
    const activeIds = new Set<string>(await redisClient.lrange(`${prefix}:active`, 0, -1));
    const toDelete = unique.filter((id) => !activeIds.has(id));
    if (toDelete.length === 0) continue;

    const BATCH = 500;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const batch = toDelete.slice(i, i + BATCH);
      const pipeline = redisClient.pipeline();
      pipeline.zrem(`${prefix}:delayed`, ...batch);
      pipeline.zrem(`${prefix}:prioritized`, ...batch);
      for (const jobId of batch) {
        pipeline.lrem(`${prefix}:wait`, 0, jobId);
        pipeline.lrem(`${prefix}:paused`, 0, jobId);
        pipeline.del(`${prefix}:${jobId}`);
        pipeline.del(`${prefix}:${jobId}:logs`);
      }
      await pipeline.exec();
      removed += batch.length;
    }
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

export function emptyStateCounts(): CampaignQueueStateCounts {
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

/** Agrega resumo de várias filas (massa por chip + legado). */
export async function buildCampaignQueueSummaryFromQueues(
  queues: Queue[],
  opts?: { campaignId?: string; topLimit?: number }
): Promise<CampaignQueueSummary> {
  let scannedJobs = 0;
  const merged = new Map<
    string,
    { ownerUid?: string; byState: CampaignQueueStateCounts; total: number }
  >();
  for (const queue of queues) {
    const part = await buildCampaignQueueSummary(queue, opts);
    scannedJobs += part.scannedJobs;
    for (const row of part.campaigns) {
      const cur = merged.get(row.campaignId);
      if (!cur) {
        merged.set(row.campaignId, {
          ownerUid: row.ownerUid,
          byState: { ...row.byState },
          total: row.jobs,
        });
        continue;
      }
      cur.total += row.jobs;
      for (const k of Object.keys(row.byState) as CampaignQueueScanState[]) {
        cur.byState[k] += row.byState[k];
      }
      if (!cur.ownerUid && row.ownerUid) cur.ownerUid = row.ownerUid;
    }
  }
  const topLimit = Math.max(1, Math.min(100, opts?.topLimit ?? 25));
  const filterCid = String(opts?.campaignId || '').trim();
  const campaigns = [...merged.entries()]
    .map(([campaignId, row]) => ({
      campaignId,
      ownerUid: row.ownerUid,
      jobs: row.total,
      byState: row.byState,
    }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, filterCid ? merged.size : topLimit);
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
