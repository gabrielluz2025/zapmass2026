/**
 * Limites práticos do WhatsApp (Web / consumer). Acima disso o envio costuma falhar
 * mesmo que o nosso socket aceite ficheiros maiores (VITE_CHAT_UPLOAD_LIMIT_MB).
 *
 * @see https://faq.whatsapp.com/ - vídeo até ~100 MB em conversas.
 */
export const WHATSAPP_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/** Vídeo acima do limite do WA deve ir como documento (`sendMediaAsDocument`). */
export function videoShouldSendAsDocument(file: Pick<File, 'size' | 'type'>): boolean {
    return Boolean(file.type?.startsWith('video/')) && file.size > WHATSAPP_VIDEO_MAX_BYTES;
}
