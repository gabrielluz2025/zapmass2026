import fs from 'fs';
import path from 'path';
import { getUploadsDir } from '../mediaStorage.js';

/** Normaliza URL de avatar local e oculta links quebrados (ficheiro ausente no DATA_DIR). */
export function resolvePhotoUrl(photoUrl: string | null | undefined): string | null {
  const raw = photoUrl?.trim();
  if (!raw) return null;

  const match = /\/public\/uploads\/([^/?#]+)$/i.exec(raw);
  if (match) {
    const fileName = match[1];
    const localPath = path.join(getUploadsDir(), fileName);
    if (!fs.existsSync(localPath)) return null;
    const base = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
    return base ? `${base}/public/uploads/${fileName}` : `/public/uploads/${fileName}`;
  }

  return raw;
}
