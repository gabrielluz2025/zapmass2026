export type PhotoCropParams = {
  zoom: number;
  panX: number;
  panY: number;
};

/** Tamanho do quadro de edição na tela (px). */
export const PHOTO_CROP_VIEW_SIZE = 280;
const OUTPUT_SIZE = 512;

function scaledPan(pan: number, viewSize: number): number {
  return pan * (OUTPUT_SIZE / viewSize);
}

/** Recorte quadrado (estilo avatar) com zoom e posição. */
export function cropSquarePhoto(
  img: HTMLImageElement,
  params: PhotoCropParams,
  mime: 'image/jpeg' | 'image/webp' = 'image/jpeg',
  viewSize = PHOTO_CROP_VIEW_SIZE
): string {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível.');

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (iw < 1 || ih < 1) throw new Error('Imagem inválida.');

  const zoom = Math.min(3, Math.max(1, params.zoom));
  const coverScale = (OUTPUT_SIZE / Math.min(iw, ih)) * zoom;
  const dw = iw * coverScale;
  const dh = ih * coverScale;
  const panX = scaledPan(params.panX, viewSize);
  const panY = scaledPan(params.panY, viewSize);
  const x = (OUTPUT_SIZE - dw) / 2 + panX;
  const y = (OUTPUT_SIZE - dh) / 2 + panY;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.drawImage(img, x, y, dw, dh);

  const quality = mime === 'image/webp' ? 0.86 : 0.88;
  return canvas.toDataURL(mime, quality);
}

export function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
}
