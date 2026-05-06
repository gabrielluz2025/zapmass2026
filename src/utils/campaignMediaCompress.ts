import {
  WHATSAPP_AUDIO_MAX_BYTES,
  WHATSAPP_IMAGE_MAX_BYTES,
  WHATSAPP_VIDEO_MAX_BYTES,
  mediaShouldSendAsDocument
} from './whatsappMediaLimits';

const MAX_EDGE_PX = 1920;
/** Margem abaixo do limite nativo de foto no WhatsApp (~16 MB). */
const TARGET_IMAGE_BYTES = 12 * 1024 * 1024;
const JPEG_QUALITY_START = 0.88;
const JPEG_QUALITY_MIN = 0.42;

function stripExtension(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0) return name;
  return name.slice(0, i);
}

/**
 * Redimensiona e reencode para JPEG quando faz sentido, para caber no limite
 * prático de foto no WhatsApp e reduzir falhas em campanhas grandes.
 * GIF/SVG/HEIC podem falhar no createImageBitmap — devolve o arquivo original.
 */
export async function compressImageForCampaign(file: File): Promise<{
  file: File;
  didCompress: boolean;
  reason?: string;
}> {
  if (!file.type.startsWith('image/')) {
    return { file, didCompress: false };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file, didCompress: false };
  }

  try {
    let w = bitmap.width;
    let h = bitmap.height;
    const maxDim = Math.max(w, h);
    if (maxDim > MAX_EDGE_PX) {
      const scale = MAX_EDGE_PX / maxDim;
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { file, didCompress: false };

    if (file.type === 'image/png' || file.type === 'image/webp') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);

    let quality = JPEG_QUALITY_START;
    let bestBlob: Blob | null = null;
    for (let i = 0; i < 16; i++) {
      // eslint-disable-next-line no-await-in-loop
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
      });
      if (!blob) break;
      bestBlob = blob;
      if (blob.size <= TARGET_IMAGE_BYTES) break;
      quality -= 0.045;
      if (quality < JPEG_QUALITY_MIN) break;
    }

    if (!bestBlob) return { file, didCompress: false };

    const base = stripExtension(file.name || 'imagem') || 'imagem';
    const out = new File([bestBlob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });

    const savesSpace = out.size < file.size * 0.92;
    const wasOversized = file.size > WHATSAPP_IMAGE_MAX_BYTES;
    const nowFitsNative = out.size <= WHATSAPP_IMAGE_MAX_BYTES;

    if (!savesSpace && !wasOversized) {
      return { file, didCompress: false };
    }

    if (wasOversized && !nowFitsNative && out.size >= file.size) {
      return { file, didCompress: false };
    }

    return {
      file: out,
      didCompress: true,
      reason: wasOversized
        ? 'Imagem reduzida para caber no limite de foto do WhatsApp.'
        : 'Imagem otimizada para disparo em lote (JPEG).'
    };
  } finally {
    bitmap.close();
  }
}

export type PreparedCampaignAttachment = {
  file: File;
  sendMediaAsDocument: boolean;
  didCompressImage: boolean;
  hints: string[];
};

/**
 * Prepara o arquivo antes de ler base64: comprime imagens no navegador.
 * Vídeo/áudio não são transcodificados (sem FFmpeg no app); limites grandes
 * seguem como envio em modo documento conforme `mediaShouldSendAsDocument`.
 */
export async function prepareCampaignAttachmentForSend(file: File): Promise<PreparedCampaignAttachment> {
  const hints: string[] = [];
  let out = file;
  let didCompressImage = false;

  if (file.type.startsWith('image/')) {
    const img = await compressImageForCampaign(file);
    if (img.didCompress && img.reason) hints.push(img.reason);
    if (img.didCompress) {
      out = img.file;
      didCompressImage = true;
    }
  } else if (file.type.startsWith('video/')) {
    if (file.size > WHATSAPP_VIDEO_MAX_BYTES) {
      hints.push('Vídeo acima de ~100 MB: envio como documento (recomendado pelo WhatsApp).');
    } else if (file.size > 45 * 1024 * 1024) {
      hints.push(
        'Vídeo grande: o WhatsApp pode demorar. Se falhar, envie versão mais curta ou comprima no PC antes.'
      );
    }
  } else if (file.type.startsWith('audio/')) {
    if (file.size > WHATSAPP_AUDIO_MAX_BYTES) {
      hints.push('Áudio grande será enviado como arquivo (documento), como o WhatsApp recomenda.');
    }
  }

  const sendMediaAsDocument = mediaShouldSendAsDocument(out);

  return {
    file: out,
    sendMediaAsDocument,
    didCompressImage,
    hints
  };
}
