type AttachmentLike = {
  size: number;
  type?: string;
};

export type WhatsAppAttachmentKind = 'image' | 'video' | 'audio' | 'document';

/**
 * Limites práticos do WhatsApp para envio como mídia "nativa" (preview/player).
 * Acima disso o envio tende a falhar em campanhas grandes, mesmo com socket ok.
 */
export const WHATSAPP_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
export const WHATSAPP_AUDIO_MAX_BYTES = 16 * 1024 * 1024;
export const WHATSAPP_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const MB = 1024 * 1024;

const toMbLabel = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`;

export const classifyWhatsAppAttachmentKind = (mimeType?: string): WhatsAppAttachmentKind => {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
};

/**
 * Define se o arquivo deve ser forçado como documento para reduzir falhas.
 * - vídeo > 100 MB -> documento
 * - imagem > 16 MB -> documento
 * - áudio > 16 MB -> documento
 */
export function mediaShouldSendAsDocument(file: AttachmentLike): boolean {
  const kind = classifyWhatsAppAttachmentKind(file.type);
  if (kind === 'video') return file.size > WHATSAPP_VIDEO_MAX_BYTES;
  if (kind === 'image') return file.size > WHATSAPP_IMAGE_MAX_BYTES;
  if (kind === 'audio') return file.size > WHATSAPP_AUDIO_MAX_BYTES;
  return true;
}

/** Compat legado: mantém o comportamento antigo usado no chat. */
export function videoShouldSendAsDocument(file: AttachmentLike): boolean {
  return classifyWhatsAppAttachmentKind(file.type) === 'video' && file.size > WHATSAPP_VIDEO_MAX_BYTES;
}

export const explainWhatsAppMediaFallback = (file: AttachmentLike): string | null => {
  const kind = classifyWhatsAppAttachmentKind(file.type);
  if (kind === 'video' && file.size > WHATSAPP_VIDEO_MAX_BYTES) {
    return `Video acima de ${toMbLabel(WHATSAPP_VIDEO_MAX_BYTES)}: vamos enviar como documento para evitar falha no WhatsApp.`;
  }
  if (kind === 'image' && file.size > WHATSAPP_IMAGE_MAX_BYTES) {
    return `Imagem acima de ${toMbLabel(WHATSAPP_IMAGE_MAX_BYTES)}: vamos enviar como documento para reduzir falhas em lote.`;
  }
  if (kind === 'audio' && file.size > WHATSAPP_AUDIO_MAX_BYTES) {
    return `Audio acima de ${toMbLabel(WHATSAPP_AUDIO_MAX_BYTES)}: vamos enviar como documento para reduzir falhas em lote.`;
  }
  return null;
};
