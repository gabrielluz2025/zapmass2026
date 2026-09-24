/**
 * Inspeção e purge seguro de jobs BullMQ `campaign-messages` por campaignId.
 */

import type { Queue } from 'bullmq';
import {
  collectCampaignJobCountsFromQueue,
  countQueueJobsForCampaign,
  forEachCampaignQueueJob,
  type CampaignQueueScanState,
} from './campaignQueueScan.js';

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

    try {
      await job.remove();
      removed += 1;
    } catch {
      failedRemove += 1;
    }
  });

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
