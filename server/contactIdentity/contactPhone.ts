import { normPhoneKey } from '../../src/utils/brPhoneNormalize.js';

/** E.164 BR canônico para chaves de identidade (tenant + phone). */
export function canonicalContactPhoneDigits(raw: string): string {
  const key = normPhoneKey(String(raw || '').replace(/\D/g, ''));
  return key || String(raw || '').replace(/\D/g, '').slice(0, 32);
}

export function contactPhoneLookupVariants(digits: string): string[] {
  const d = canonicalContactPhoneDigits(digits);
  if (d.length < 8) return d ? [d] : [];
  const out = new Set<string>([d]);
  if (d.length === 13 && d.startsWith('55') && d.charAt(4) === '9') {
    out.add(d.slice(0, 4) + d.slice(5));
  } else if (d.length === 12 && d.startsWith('55')) {
    out.add(d.slice(0, 4) + '9' + d.slice(4));
  }
  const last11 = d.slice(-11);
  if (last11.length >= 8) out.add(last11);
  return [...out];
}
