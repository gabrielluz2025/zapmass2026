import {
  buildPhoneDigitLookupKeys,
  looksLikeLongLidDigits,
  normalizePhoneDigits
} from '../src/utils/contactPhoneLookup.js';
import { normalizeChatRemoteJid } from './evolutionChatJid.js';

/** Nome legível de um registro findContacts / findChats (agenda do celular → `notify`). */
export function filterEvolutionContactLabel(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  if (lower === 'contato' || lower === 'contact' || lower === 'unknown' || lower === 'desconhecido') {
    return undefined;
  }
  if (looksLikeLongLidDigits(t)) return undefined;
  return t;
}

/** Prioridade: nome salvo no telefone (`notify`) → `name` → pushName → verifiedName. */
export function evolutionContactDisplayName(row: Record<string, unknown> | null | undefined): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const nested =
    row.contact && typeof row.contact === 'object'
      ? (row.contact as Record<string, unknown>)
      : null;
  const candidates = [
    row.notify,
    row.contactName,
    row.name,
    nested?.name,
    nested?.notify,
    row.pushName,
    row.verifiedName,
    row.shortName,
    row.formattedName
  ];
  for (const c of candidates) {
    const hit = filterEvolutionContactLabel(c);
    if (hit) return hit;
  }
  return undefined;
}

export type PhonebookNameIndex = {
  byJid: Map<string, string>;
  byPhone: Map<string, string>;
};

export function createPhonebookNameIndex(): PhonebookNameIndex {
  return { byJid: new Map(), byPhone: new Map() };
}

/** Regista nome da agenda em todos os JIDs e variantes de telefone do registro Evolution. */
export function indexPhonebookRow(index: PhonebookNameIndex, row: Record<string, unknown>): void {
  const name = evolutionContactDisplayName(row);
  if (!name) return;

  const jidCandidates: unknown[] = [
    row.remoteJid,
    row.jid,
    row.remoteJidAlt,
    row.jidAlt,
    row.altJid,
    row.id,
    row.lid
  ];
  for (const raw of jidCandidates) {
    const jid = normalizeChatRemoteJid(raw);
    if (jid) index.byJid.set(jid, name);
  }

  const phoneFields = [
    row.phoneNumber,
    row.number,
    row.pn,
    row.remoteJidAlt,
    row.jidAlt,
    row.contact && typeof row.contact === 'object'
      ? (row.contact as Record<string, unknown>).phoneNumber
      : undefined,
    row.contact && typeof row.contact === 'object'
      ? (row.contact as Record<string, unknown>).number
      : undefined
  ];
  for (const raw of phoneFields) {
    const digits = normalizePhoneDigits(String(raw ?? '').split('@')[0]);
    if (digits.length < 10 || digits.length > 13) continue;
    for (const key of buildPhoneDigitLookupKeys(digits)) {
      if (!index.byPhone.has(key)) index.byPhone.set(key, name);
    }
  }
}

export function resolvePhonebookName(
  index: PhonebookNameIndex,
  opts: { remoteJid: string; contactPhone?: string; waJidAlt?: string }
): string | undefined {
  const { remoteJid, contactPhone, waJidAlt } = opts;
  const fromJid = index.byJid.get(remoteJid);
  if (fromJid) return fromJid;

  if (waJidAlt) {
    const altJid = normalizeChatRemoteJid(waJidAlt);
    if (altJid) {
      const hit = index.byJid.get(altJid);
      if (hit) return hit;
    }
  }

  const tryDigits = (digits: string): string | undefined => {
    if (digits.length < 10 || digits.length > 13) return undefined;
    for (const key of buildPhoneDigitLookupKeys(digits)) {
      const hit = index.byPhone.get(key);
      if (hit) return hit;
    }
    return undefined;
  };

  const fromPhone = tryDigits(normalizePhoneDigits(contactPhone || ''));
  if (fromPhone) return fromPhone;

  if (!remoteJid.endsWith('@lid')) {
    const fromJidDigits = tryDigits(normalizePhoneDigits(remoteJid.split('@')[0]));
    if (fromJidDigits) return fromJidDigits;
  }

  return undefined;
}
