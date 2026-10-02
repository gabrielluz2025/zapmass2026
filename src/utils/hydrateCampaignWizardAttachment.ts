import type { CampaignMediaAttachmentPayload } from '../services/campaignsApi';
import { fetchCampaignMediaAttachments } from '../services/campaignsApi';
import type { CampaignAttachmentState } from '../components/campaigns/CampaignAttachmentBlock';

function base64ToBlob(base64: string, mimeType: string): Blob {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

export async function hydrateOpeningAttachmentFromServer(
  campaignId: string
): Promise<CampaignAttachmentState | null> {
  const { mediaAttachment } = await fetchCampaignMediaAttachments(campaignId);
  return attachmentStateFromApiPayload(mediaAttachment);
}

export async function hydrateFollowUpAttachmentFromServer(
  campaignId: string
): Promise<CampaignAttachmentState | null> {
  const { followUpMediaAttachment } = await fetchCampaignMediaAttachments(campaignId);
  return attachmentStateFromApiPayload(followUpMediaAttachment);
}

function attachmentStateFromApiPayload(
  payload?: CampaignMediaAttachmentPayload
): CampaignAttachmentState | null {
  if (!payload?.dataBase64 || !payload.mimeType) return null;
  try {
    const blob = base64ToBlob(payload.dataBase64, payload.mimeType);
    const file = new File([blob], payload.fileName || 'anexo', { type: payload.mimeType });
    const previewUrl =
      payload.mimeType.startsWith('image/') || payload.mimeType.startsWith('video/')
        ? URL.createObjectURL(blob)
        : null;
    return {
      file,
      previewUrl,
      sendAsDocument: payload.sendMediaAsDocument === true,
      persistedOnServer: true,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
    };
  } catch {
    return null;
  }
}
