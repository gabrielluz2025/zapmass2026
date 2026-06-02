import { persistCampaignLog, persistCampaignProgress } from './campaignStore.js';

/** @deprecated Use persistCampaignLog — mantido para imports existentes. */
export async function persistCampaignLogToFirestore(
  ownerUid: string | undefined,
  campaignId: string | undefined,
  level: string,
  message: string,
  payload?: Record<string, unknown>
): Promise<void> {
  return persistCampaignLog(ownerUid, campaignId, level, message, payload);
}

/** @deprecated Use persistCampaignProgress — mantido para imports existentes. */
export async function persistCampaignProgressToFirestore(
  ownerUid: string | undefined,
  campaignId: string | undefined,
  successCount: number,
  failCount: number,
  processedCount: number,
  status?: string
): Promise<void> {
  return persistCampaignProgress(ownerUid, campaignId, successCount, failCount, processedCount, status);
}
