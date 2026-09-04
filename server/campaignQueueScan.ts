import type { Queue } from 'bullmq';

const PAGE = 250;

async function forEachQueueJob(
  queue: Queue,
  onJob: (data: { campaignId?: string; ownerUid?: string; replyFlowOpen?: { ownerUid?: string } }) => void
): Promise<void> {
  const states = ['active', 'waiting', 'delayed', 'paused'] as const;
  for (const state of states) {
    let start = 0;
    for (;;) {
      const batch = await queue.getJobs([state], start, start + PAGE - 1, true);
      if (batch.length === 0) break;
      for (const j of batch) {
        onJob((j.data || {}) as { campaignId?: string; ownerUid?: string; replyFlowOpen?: { ownerUid?: string } });
      }
      if (batch.length < PAGE) break;
      start += PAGE;
    }
  }
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
