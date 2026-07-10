import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';

export type WhatsAppNumberCheckRow = { exists?: boolean; jid?: string; number?: string };

/** Normaliza número para envio Evolution (E.164 BR). */
export function normalizeOutboundNumber(raw: string): string {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function isValidBrOutboundE164(digits: string): boolean {
  if (!digits.startsWith('55') || (digits.length !== 12 && digits.length !== 13)) return false;
  const ddd = digits.slice(2, 4);
  if (!/^[1-9]\d$/.test(ddd)) return false;
  if (digits.length === 13) return digits[4] === '9';
  return true;
}

/** Variantes BR válidas para envio (E.164 com/sem 9º dígito). Evita sufixos corrompidos tipo 547… */
export function buildOutboundPhoneVariants(raw: string): string[] {
  const normalized = normalizeOutboundNumber(raw);
  if (!normalized) return [];

  const canonical = normPhoneKey(normalized) || normalized;
  const variants = new Set<string>();

  const pushPair = (digits: string) => {
    if (!isValidBrOutboundE164(digits)) return;
    variants.add(digits);
    if (digits.length === 13) {
      const alt = `55${digits.slice(2, 4)}${digits.slice(5)}`;
      if (isValidBrOutboundE164(alt)) variants.add(alt);
    } else if (digits.length === 12) {
      const alt = `55${digits.slice(2, 4)}9${digits.slice(4)}`;
      if (isValidBrOutboundE164(alt)) variants.add(alt);
    }
  };

  pushPair(canonical);
  if (canonical !== normalized) pushPair(normalized);

  const ordered = [canonical];
  for (const v of variants) {
    if (!ordered.includes(v)) ordered.push(v);
  }
  return ordered.filter(isValidBrOutboundE164);
}

/** Extrai linhas do endpoint `/chat/whatsappNumbers` (Evolution v1/v2). */
export function parseWhatsAppNumberCheckRows(data: unknown): WhatsAppNumberCheckRow[] {
  if (Array.isArray(data)) return data as WhatsAppNumberCheckRow[];
  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  for (const key of ['data', 'response', 'numbers', 'result']) {
    const nested = root[key];
    if (Array.isArray(nested)) return nested as WhatsAppNumberCheckRow[];
  }
  const message = root.message;
  if (Array.isArray(message)) return message as WhatsAppNumberCheckRow[];
  return [];
}

export function digitsFromWhatsAppJid(jid: string | undefined): string {
  const raw = String(jid || '').split('@')[0].replace(/\D/g, '');
  return raw.length >= 10 ? raw : '';
}

export function pickWhatsAppCheckResult(
  rows: WhatsAppNumberCheckRow[],
  digits: string
): { exists: boolean; canonicalNumber?: string; lidOnly?: boolean; emptyResponse?: boolean } {
  if (!rows.length) return { exists: false, emptyResponse: true };

  const row =
    rows.find((r) => String(r.number || '').replace(/\D/g, '') === digits) ||
    rows.find((r) => digitsFromWhatsAppJid(r.jid) === digits) ||
    rows.find((r) => r.exists) ||
    rows[0];

  if (!row) return { exists: false, emptyResponse: true };

  const jid = String(row.jid || '');
  const fromJid = digitsFromWhatsAppJid(jid);
  const fromNumber = String(row.number || '').replace(/\D/g, '');

  if (row.exists === true) {
    const canonical = fromNumber || fromJid || digits;
    return { exists: true, canonicalNumber: canonical };
  }

  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) {
    const canonical = fromJid || fromNumber || digits;
    if (canonical) return { exists: true, canonicalNumber: canonical };
  }

  if (jid.endsWith('@lid')) {
    return { exists: false, lidOnly: true };
  }

  return { exists: false };
}
