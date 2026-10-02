/**
 * Normaliza base64 de anexo de campanha (remove prefixo data URL e espaços).
 * Evolution Go e `Buffer.from(..., 'base64')` falham ou geram lixo com `data:image/...;base64,`.
 */
export function normalizeCampaignMediaBase64(raw: string | undefined | null): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  const semi = s.indexOf(';base64,');
  if (s.startsWith('data:') && semi >= 0) {
    s = s.slice(semi + ';base64,'.length);
  }
  return s.replace(/\s+/g, '');
}

/** Tamanho binário aproximado a partir de base64 normalizado. */
export function approxBytesFromNormalizedBase64(base64: string): number {
  const cleaned = normalizeCampaignMediaBase64(base64);
  const len = cleaned.length;
  if (!len) return 0;
  let padding = 0;
  if (cleaned.endsWith('==')) padding = 2;
  else if (cleaned.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}
