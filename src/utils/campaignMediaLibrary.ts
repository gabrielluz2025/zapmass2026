import { compressImageForCampaign } from './campaignMediaCompress';

export type SavedCampaignMedia = {
  id: string;
  name: string;
  mimeType: string;
  dataBase64: string;
  createdAt: string;
};

export type CampaignMediaPayload = {
  dataBase64: string;
  mimeType: string;
  fileName: string;
  sendMediaAsDocument?: boolean;
};

const STORAGE_KEY = 'zapmass_saved_campaign_media_v1';
const MAX_ITEMS = 24;
/** Limite aproximado por item após base64 (~350 KB binário). */
const MAX_BYTES_PER_ITEM = 350 * 1024;

const uid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

function readAll(): SavedCampaignMedia[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list: SavedCampaignMedia[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => {
      const raw = reader.error?.message || '';
      if (/could not be read/i.test(raw)) {
        reject(
          new Error(
            'Não foi possível ler o arquivo. Selecione-o novamente ou escolha uma imagem da biblioteca.'
          )
        );
        return;
      }
      reject(reader.error || new Error('Falha ao ler arquivo anexado.'));
    };
    reader.readAsDataURL(file);
  });
}

export function listSavedCampaignMedia(): SavedCampaignMedia[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function removeSavedCampaignMedia(id: string): void {
  writeAll(readAll().filter((x) => x.id !== id));
}

export function savedMediaToDataUrl(item: SavedCampaignMedia): string {
  return `data:${item.mimeType};base64,${item.dataBase64}`;
}

export function savedMediaToFile(item: SavedCampaignMedia): File {
  const bin = atob(item.dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], item.name, { type: item.mimeType });
}

/** Salva imagem comprimida na biblioteca local (somente imagens). */
export async function saveCampaignMediaToLibrary(
  file: File,
  displayName?: string
): Promise<{ ok: true; item: SavedCampaignMedia } | { ok: false; error: string }> {
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'A biblioteca salva apenas imagens para reutilizar em aniversários.' };
  }

  const compressed = await compressImageForCampaign(file);
  const out = compressed.file;
  if (out.size > MAX_BYTES_PER_ITEM) {
    return {
      ok: false,
      error: 'Imagem grande demais para salvar localmente. Use uma versão menor ou comprima antes.'
    };
  }

  const dataBase64 = await fileToBase64(out);
  const item: SavedCampaignMedia = {
    id: uid(),
    name: (displayName || out.name || 'imagem').trim() || 'imagem',
    mimeType: out.type || 'image/jpeg',
    dataBase64,
    createdAt: new Date().toISOString()
  };

  const next = [item, ...readAll()].slice(0, MAX_ITEMS);
  writeAll(next);
  return { ok: true, item };
}

/** Comprime (se imagem) e converte para payload de envio — chamar logo ao selecionar o arquivo. */
export async function prepareCampaignAttachmentPayload(file: File): Promise<CampaignMediaPayload> {
  const { prepareCampaignAttachmentForSend } = await import('./campaignMediaCompress');
  const prep = await prepareCampaignAttachmentForSend(file);
  const dataBase64 = await fileToBase64(prep.file);
  return {
    dataBase64,
    mimeType: prep.file.type || 'application/octet-stream',
    fileName: prep.file.name,
    ...(prep.sendMediaAsDocument ? { sendMediaAsDocument: true } : {})
  };
}

export async function fileToMediaPayload(file: File): Promise<CampaignMediaPayload> {
  return prepareCampaignAttachmentPayload(file);
}
