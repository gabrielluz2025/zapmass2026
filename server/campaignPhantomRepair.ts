import { fetchCampaignDoc } from './campaignStore.js';
import { persistCampaignProgressToFirestore } from './campaignPersistence.js';
import { requeuePhantomDeadCampaignJobs } from './campaignJobsResilience.js';
import { countersFromCampaignDoc } from './campaignProgressGuard.js';
import { CampaignStatus, type Campaign } from '../src/types.js';
import { isPhantomZeroOutcomeCampaign } from '../src/utils/campaignMetrics.js';

function docToCampaignForHeal(campaignId: string, doc: Record<string, unknown>): Campaign {
  const statusRaw = String(doc.status || 'DRAFT');
  const status =
    statusRaw === CampaignStatus.COMPLETED ||
    statusRaw === CampaignStatus.FAILED ||
    statusRaw === CampaignStatus.RUNNING
      ? (statusRaw as Campaign['status'])
      : CampaignStatus.DRAFT;
  return {
    id: campaignId,
    name: String(doc.name || campaignId),
    message: String(doc.message || ''),
    totalContacts: Number(doc.totalContacts) || 0,
    processedCount: Number(doc.processedCount) || 0,
    successCount: Number(doc.successCount) || 0,
    failedCount: Number(doc.failedCount) || 0,
    skippedCount: Number(doc.skippedCount) || 0,
    status,
    selectedConnectionIds: [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Campanhas já gravadas como Concluída com 100% e zero entregas/falhas/skips —
 * reclassifica para FAILED e tenta reenfileirar jobs fantasma no PG.
 */
export async function maybeRepairPhantomZeroOutcomeCampaign(
  ownerUid: string | undefined,
  campaignId: string
): Promise<boolean> {
  const uid = String(ownerUid || '').trim();
  const cid = String(campaignId || '').trim();
  if (!uid || !cid) return false;

  const doc = await fetchCampaignDoc(uid, cid).catch(() => null);
  if (!doc) return false;

  const campaign = docToCampaignForHeal(cid, doc);
  if (!isPhantomZeroOutcomeCampaign(campaign)) return false;

  const counters = countersFromCampaignDoc(doc);
  const requeued = await requeuePhantomDeadCampaignJobs(cid).catch(() => 0);

  console.warn('[CampaignRepair] Concluída sem envios — reclassificando para FAILED', {
    campaignId: cid,
    processedCount: counters.processedCount,
    requeuedJobs: requeued,
  });

  await persistCampaignProgressToFirestore(
    uid,
    cid,
    counters.successCount,
    counters.failedCount,
    counters.processedCount,
    CampaignStatus.FAILED,
    counters.skippedCount ?? 0
  );

  return true;
}
