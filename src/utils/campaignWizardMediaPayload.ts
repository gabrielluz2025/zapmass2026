import type { CampaignMediaAttachmentPayload } from '../services/campaignsApi';
import { fetchCampaignMediaAttachments } from '../services/campaignsApi';
import { prepareCampaignAttachmentForSend } from './campaignMediaCompress';
import type { CampaignAttachmentState } from '../components/campaigns/CampaignAttachmentBlock';

async function readFileAsBase64(
  file: File
): Promise<{ dataBase64: string; mimeType: string; fileName: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo anexado.'));
    reader.readAsDataURL(file);
  });
  const commaIdx = dataUrl.indexOf(',');
  const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
  if (!dataBase64) throw new Error('Não foi possível processar o arquivo anexado.');
  return {
    dataBase64,
    mimeType: file.type || 'application/octet-stream',
    fileName: file.name || 'anexo',
  };
}

/** Monta payload REST/socket a partir do estado do anexo no wizard. */
export async function buildCampaignAttachmentPayload(
  att: CampaignAttachmentState | null | undefined,
  opts?: {
    onPrepareHint?: (hint: string) => void;
    /** Campanha já salva na VPS — busca base64 quando só há `persistedOnServer` no estado. */
    campaignId?: string;
  }
): Promise<CampaignMediaAttachmentPayload | undefined> {
  if (!att) return undefined;

  if (att.mediaPayload?.dataBase64) {
    return {
      dataBase64: att.mediaPayload.dataBase64,
      mimeType: att.mediaPayload.mimeType,
      fileName: att.mediaPayload.fileName,
      ...(att.sendAsDocument || att.mediaPayload.sendMediaAsDocument
        ? { sendMediaAsDocument: true }
        : {}),
    };
  }

  if (!att.file) {
    if (att.persistedOnServer && opts?.campaignId) {
      try {
        const { mediaAttachment } = await fetchCampaignMediaAttachments(opts.campaignId);
        if (mediaAttachment?.dataBase64 && mediaAttachment.mimeType) {
          return {
            dataBase64: mediaAttachment.dataBase64,
            mimeType: mediaAttachment.mimeType,
            fileName: mediaAttachment.fileName || att.fileName || 'anexo',
            ...(mediaAttachment.sendMediaAsDocument || att.sendAsDocument
              ? { sendMediaAsDocument: true }
              : {}),
          };
        }
      } catch {
        /* rede */
      }
    }
    if (att.persistedOnServer) return undefined;
    return undefined;
  }

  const prep = await prepareCampaignAttachmentForSend(att.file);
  for (const h of prep.hints) opts?.onPrepareHint?.(h);
  const read = await readFileAsBase64(prep.file);
  return {
    ...read,
    ...(prep.sendMediaAsDocument || att.sendAsDocument ? { sendMediaAsDocument: true } : {}),
  };
}
