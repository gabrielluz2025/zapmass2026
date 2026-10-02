import { campaignMediaStorageKey } from '../src/utils/campaignMediaKeys.js';
import {
  getCampaignDoc,
  mergeUpdateCampaign,
  resolveCampaignTenantId,
} from './repositories/campaignsRepository.js';

export type CampaignMediaMetaEntry = {
  fileName: string;
  mimeType: string;
  sendMediaAsDocument?: boolean;
  updatedAt: string;
};

export type CampaignMediaMetaDoc = {
  opening?: CampaignMediaMetaEntry;
  followUp?: CampaignMediaMetaEntry;
};

export function mediaMetaEntryFromPayload(payload: {
  fileName?: string;
  mimeType?: string;
  sendMediaAsDocument?: boolean;
}): CampaignMediaMetaEntry | null {
  const mimeType = String(payload.mimeType || '').trim();
  const fileName = String(payload.fileName || 'anexo').trim().slice(0, 220);
  if (!mimeType) return null;
  return {
    fileName,
    mimeType,
    ...(payload.sendMediaAsDocument ? { sendMediaAsDocument: true } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function campaignIdFromMediaStorageKey(storageKey: string): string {
  const key = String(storageKey || '').trim();
  if (!key) return '';
  const stepMarker = ':reply-step:';
  const idx = key.indexOf(stepMarker);
  if (idx > 0) return key.slice(0, idx);
  return key.split(':')[0] || key;
}

export function mediaMetaSlotForStorageKey(storageKey: string): 'opening' | 'followUp' | null {
  const key = String(storageKey || '').trim();
  if (!key) return null;
  const cid = campaignIdFromMediaStorageKey(key);
  if (!cid) return null;
  if (key === cid) return 'opening';
  if (key === campaignMediaStorageKey(cid, 1)) return 'followUp';
  if (key.includes(':reply-step:')) return 'followUp';
  return null;
}

/** Atualiza flags no JSONB da campanha (sem ler disco). */
export async function refreshCampaignMediaDocFlags(
  campaignId: string,
  status: { opening: boolean; followUp: boolean }
): Promise<void> {
  const cid = String(campaignId || '').trim();
  if (!cid) return;
  const tenantId = await resolveCampaignTenantId(cid);
  if (!tenantId) return;
  const doc = await getCampaignDoc(tenantId, cid);
  if (!doc) return;

  const prevMeta =
    doc.mediaMeta && typeof doc.mediaMeta === 'object'
      ? ({ ...(doc.mediaMeta as CampaignMediaMetaDoc) } as CampaignMediaMetaDoc)
      : ({} as CampaignMediaMetaDoc);

  if (!status.opening) delete prevMeta.opening;
  if (!status.followUp) delete prevMeta.followUp;

  await mergeUpdateCampaign(tenantId, cid, {
    mediaMeta: Object.keys(prevMeta).length ? prevMeta : null,
    hasOpeningMedia: status.opening,
    hasFollowUpMedia: status.followUp,
  });
}

export async function patchCampaignMediaMetaSlot(
  campaignId: string,
  slot: 'opening' | 'followUp',
  entry: CampaignMediaMetaEntry | null,
  status: { opening: boolean; followUp: boolean }
): Promise<void> {
  const cid = String(campaignId || '').trim();
  if (!cid) return;
  const tenantId = await resolveCampaignTenantId(cid);
  if (!tenantId) return;
  const doc = await getCampaignDoc(tenantId, cid);
  if (!doc) return;

  const prevMeta =
    doc.mediaMeta && typeof doc.mediaMeta === 'object'
      ? ({ ...(doc.mediaMeta as CampaignMediaMetaDoc) } as CampaignMediaMetaDoc)
      : ({} as CampaignMediaMetaDoc);

  if (entry) prevMeta[slot] = entry;
  else delete prevMeta[slot];

  await mergeUpdateCampaign(tenantId, cid, {
    mediaMeta: Object.keys(prevMeta).length ? prevMeta : null,
    hasOpeningMedia: status.opening,
    hasFollowUpMedia: status.followUp,
  });
}
