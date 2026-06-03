import type { Contact, Conversation } from '../../../types';
import { normPhoneKey } from '../../../utils/brPhoneNormalize';
import {
  buildPhoneDigitLookupKeys,
  normalizePhoneDigits
} from '../../../utils/contactPhoneLookup';
import { formatChatListTime } from '../../../utils/formatChatListTime';

const GENERIC = new Set(['contato', 'contact', 'unknown', 'desconhecido']);

export type ConversationDisplay = {
  primary: string;
  whatsappSubtitle?: string;
  phoneSecondary?: string;
};

function normalizeDigits(raw: string): string {
  return normalizePhoneDigits(raw);
}

function extractWaUserDigitsFromConvId(convId: string): string {
  const tail = convId.includes(':') ? convId.slice(convId.lastIndexOf(':') + 1) : convId;
  const m = /^(\d+)@(?:c\.us|s\.whatsapp\.net|lid)$/i.exec(tail.trim());
  return m ? normalizeDigits(m[1]) : '';
}

export function isLidConvId(convId: string): boolean {
  const tail = convId.includes(':') ? convId.slice(convId.lastIndexOf(':') + 1) : convId;
  return tail.trim().toLowerCase().endsWith('@lid');
}

function plausiblyPhoneDigits(d: string): boolean {
  const x = normalizeDigits(d);
  if (x.length < 8 || x.length > 15) return false;
  if (x.startsWith('55') && x.length < 12) return false;
  return true;
}

function bestPhoneDigitsForAgenda(conv: Conversation): string {
  const phoneD = normalizeDigits(conv.contactPhone || '');
  const fromId = extractWaUserDigitsFromConvId(conv.id);
  if (plausiblyPhoneDigits(phoneD)) return phoneD;
  if (plausiblyPhoneDigits(fromId)) return fromId;
  return phoneD || fromId;
}

export function phoneRawForContactLookup(conv: Conversation): string {
  const d = bestPhoneDigitsForAgenda(conv);
  return d.length >= 8 ? `+${d}` : '';
}

function digitsForContactMatch(conv: Conversation): string {
  return bestPhoneDigitsForAgenda(conv);
}

function looksLikeDigitsOnlyContactLabel(raw: string): boolean {
  const t = raw.trim().replace(/\u00a0/g, ' ');
  if (!t) return true;
  return /^[+()\d\s.\-]+$/.test(t) && /\d{7,}/.test(t.replace(/\D/g, ''));
}

export function formatPhoneDisplay(digits: string): string {
  const d = normalizeDigits(digits);
  if (!d) return '';
  if (d.startsWith('55') && (d.length === 13 || d.length === 12)) {
    const nat = d.slice(2);
    if (nat.length === 11) return `+55 (${nat.slice(0, 2)}) ${nat.slice(2, 7)}-${nat.slice(7)}`;
    if (nat.length === 10) return `+55 (${nat.slice(0, 2)}) ${nat.slice(2, 6)}-${nat.slice(6)}`;
  }
  return `+${d}`;
}

export function buildSystemNameIndex(contacts: Contact[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const ct of contacts) {
    const name = (ct.name || '').trim();
    const rawPhone = ct.phone || '';
    const digits = normalizeDigits(rawPhone);
    if (!name || !digits) continue;
    const nk = normPhoneKey(rawPhone);
    if (nk && !map.has(nk)) map.set(nk, name);
    for (const key of buildPhoneDigitLookupKeys(digits)) {
      if (!map.has(key)) map.set(key, name);
    }
  }
  return map;
}

function resolveSystemName(
  conv: Conversation,
  systemContactNameByDigits: Map<string, string>
): string | undefined {
  const candidates = [
    phoneRawForContactLookup(conv),
    conv.contactPhone || '',
    digitsForContactMatch(conv),
    extractWaUserDigitsFromConvId(conv.id)
  ];
  for (const raw of candidates) {
    const trimmed = (raw || '').trim();
    if (!trimmed) continue;
    const nkHit = normPhoneKey(trimmed);
    if (nkHit) {
      const a = systemContactNameByDigits.get(nkHit);
      if (a) return a;
    }
    const digits = normalizeDigits(raw);
    if (!digits) continue;
    for (const key of buildPhoneDigitLookupKeys(digits)) {
      const hit = systemContactNameByDigits.get(key);
      if (hit) return hit;
    }
  }
  const waDigits = normalizeDigits((conv.contactName || '').trim());
  if (waDigits.length >= 10) {
    for (const key of buildPhoneDigitLookupKeys(waDigits)) {
      const hit = systemContactNameByDigits.get(key);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function buildDisplayIndex(
  conversations: Conversation[],
  contacts: Contact[]
): Map<string, ConversationDisplay> {
  const systemContactNameByDigits = buildSystemNameIndex(contacts);
  const map = new Map<string, ConversationDisplay>();
  const same = (a: string, b: string) =>
    a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ');

  for (const conv of conversations) {
    const convIsLid = isLidConvId(conv.id);
    const waNameRaw = (conv.contactName || '').trim();
    const waNameIsLidDigits =
      (convIsLid && /^\d{10,}$/.test(normalizeDigits(waNameRaw))) ||
      (/^\d{14,}$/.test(normalizeDigits(waNameRaw)) && looksLikeDigitsOnlyContactLabel(waNameRaw));
    const waName = GENERIC.has(waNameRaw.toLowerCase()) || waNameIsLidDigits ? '' : waNameRaw;
    const systemName = resolveSystemName(conv, systemContactNameByDigits);
    const friendlyStored =
      waName && !looksLikeDigitsOnlyContactLabel(waName) ? waName : '';
    const rawDigits = normalizeDigits(phoneRawForContactLookup(conv) || digitsForContactMatch(conv));
    const lidPhoneDigits = (() => {
      if (!convIsLid) return '';
      const d = normalizeDigits(conv.contactPhone || '');
      return d.length >= 10 && d.length <= 13 ? d : '';
    })();
    const digits = convIsLid ? lidPhoneDigits : rawDigits;
    const phoneLabel = digits ? formatPhoneDisplay(digits) : '';
    const rawNumberOnly = !systemName && !friendlyStored && looksLikeDigitsOnlyContactLabel(waName);
    const lastResort = waNameIsLidDigits ? '' : waNameRaw;
    const primary =
      systemName ||
      friendlyStored ||
      (rawNumberOnly ? phoneLabel : waName) ||
      phoneLabel ||
      lastResort ||
      'Contato';

    let whatsappSubtitle: string | undefined;
    if (systemName && waName && !looksLikeDigitsOnlyContactLabel(waName) && !same(systemName, waName)) {
      whatsappSubtitle = waName;
    }

    let phoneSecondary: string | undefined;
    const phoneFmt = formatPhoneDisplay(digits);
    if (phoneFmt && primary !== phoneFmt && !looksLikeDigitsOnlyContactLabel(primary)) {
      phoneSecondary = phoneFmt;
    }

    map.set(conv.id, { primary, whatsappSubtitle, phoneSecondary });
  }
  return map;
}

export function formatListTime(conv: Conversation): string {
  const ts = conv.lastMessageTimestamp;
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
    return formatChatListTime(ts);
  }
  const raw = String(conv.lastMessageTime || '').trim();
  if (raw && raw !== 'Invalid Date') return raw;
  return '';
}

export function avatarUrl(name: string, pic?: string): string {
  return (
    pic ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=00a884&color=fff&size=200`
  );
}

/** Na lista/cabeçalho: evita vários "Contato" iguais — mostra telefone quando possível. */
export function inboxListTitle(disp: ConversationDisplay | undefined, conv: Conversation): string {
  const p = (disp?.primary || conv.contactName || '').trim();
  if (p && p.toLowerCase() !== 'contato') return p;
  if (disp?.phoneSecondary) return disp.phoneSecondary;
  if (disp?.whatsappSubtitle) return disp.whatsappSubtitle;
  const phone = (conv.contactPhone || '').trim();
  if (phone && phone.length >= 8) return phone;
  return 'Contato';
}

export function unreadCount(conv: Conversation): number {
  const n = conv.unreadCount;
  if (typeof n === 'number' && n > 0) return n;
  return 0;
}

export function isGroupConversation(conv: Conversation): boolean {
  return conv.id.includes('@g.us') || conv.id.toLowerCase().includes('group');
}
