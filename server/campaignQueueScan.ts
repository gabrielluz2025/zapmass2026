import type { Job, Queue } from 'bullmq';

const PAGE = 250;

const QUEUE_STATES = ['active', 'waiting', 'delayed', 'paused'] as const;
export type CampaignQueueScanState = (typeof QUEUE_STATES)[number];

export async function forEachCampaignQueueJob<T extends { campaignId?: string }>(
  queue: Queue<T>,
  fn: (job: Job<T>, state: CampaignQueueScanState) => void | Promise<void>
): Promise<void> {
  for (const state of QUEUE_STATES) {
    let start = 0;
    for (;;) {
      const batch = await queue.getJobs([state], start, start + PAGE - 1, true);
      if (batch.length === 0) break;
      for (const job of batch) {
        await fn(job, state);
      }
      if (batch.length < PAGE) break;
      start += PAGE;
    }
  }
}

async function forEachQueueJob(
  queue: Queue,
  onJob: (data: { campaignId?: string; ownerUid?: string; replyFlowOpen?: { ownerUid?: string } }) => void
): Promise<void> {
  await forEachCampaignQueueJob(queue, (job) => {
    onJob((job.data || {}) as { campaignId?: string; ownerUid?: string; replyFlowOpen?: { ownerUid?: string } });
  });
}

/** Conta jobs da campanha em todos os estados da fila (não só os 200 primeiros). */
export async function countQueueJobsForCampaign(
  queue: Queue | null | undefined,
  campaignId: string
): Promise<number> {
  const cid = String(campaignId || '').trim();
  if (!queue || !cid) return 0;
  let count = 0;
  await forEachQueueJob(queue, (data) => {
    if (String(data.campaignId || '').trim() === cid) count += 1;
  });
  return count;
}

export async function collectCampaignJobCountsFromQueue(queue: Queue | null | undefined): Promise<{
  counts: Map<string, number>;
  ownerByCampaign: Map<string, string>;
}> {
  const counts = new Map<string, number>();
  const ownerByCampaign = new Map<string, string>();
  if (!queue) return { counts, ownerByCampaign };
  await forEachQueueJob(queue, (data) => {
    const cid = String(data.campaignId || '').trim();
    if (!cid) return;
    counts.set(cid, (counts.get(cid) || 0) + 1);
    const uid = String(data.ownerUid || data.replyFlowOpen?.ownerUid || '').trim();
    if (uid && !ownerByCampaign.has(cid)) ownerByCampaign.set(cid, uid);
  });
  return { counts, ownerByCampaign };
}
