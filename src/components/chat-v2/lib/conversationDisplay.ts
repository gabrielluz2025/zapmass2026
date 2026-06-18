import type { Contact, Conversation, WhatsAppConnection } from '../../../types';
import { normPhoneKey } from '../../../utils/brPhoneNormalize';
import {
  buildPhoneDigitLookupKeys,
  looksLikeDigitsOnlyPhoneLabel,
  looksLikeLongLidDigits,
  normalizePhoneDigits,
  phoneCandidatesFromConversation,
} from '../../../utils/contactPhoneLookup';
import { formatChatListTime } from '../../../utils/formatChatListTime';

const GENERIC = new Set(['contato', 'contact', 'unknown', 'desconhecido']);

export type ConversationDisplay = {
  primary: string;
  whatsappSubtitle?: string;
  phoneSecondary?: string;
  /** Nome principal veio da base de contatos (cruzamento por telefone). */
  fromDatabase?: boolean;
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
  for (const raw of phoneCandidatesFromConversation(conv)) {
    const trimmed = (raw || '').trim();
    if (!trimmed) continue;
    const nkHit = normPhoneKey(trimmed);
    if (nkHit) {
      const a = systemContactNameByDigits.get(nkHit);
      if (a) return a;
    }
    const digits = normalizeDigits(raw);
    if (!digits || looksLikeLongLidDigits(digits)) continue;
    for (const key of buildPhoneDigitLookupKeys(digits)) {
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
    const systemName = resolveSystemName(conv, systemContactNameByDigits);
    const waSavedOnPhone = (conv.waContactName || '').trim();
    let waNameRaw = waSavedOnPhone;
    if (!waNameRaw) {
      const cn = (conv.contactName || '').trim();
      if (cn && systemName && !same(cn, systemName)) waNameRaw = cn;
      else if (cn && !systemName) waNameRaw = cn;
    }
    const waNameIsLidDigits =
      (convIsLid && /^\d{10,}$/.test(normalizeDigits(waNameRaw))) ||
      (/^\d{14,}$/.test(normalizeDigits(waNameRaw)) && looksLikeDigitsOnlyContactLabel(waNameRaw));
    const waName = GENERIC.has(waNameRaw.toLowerCase()) || waNameIsLidDigits ? '' : waNameRaw;
    const friendlyStored =
      waName && !looksLikeDigitsOnlyContactLabel(waName) ? waName : '';
    const rawDigits = normalizeDigits(phoneRawForContactLookup(conv) || digitsForContactMatch(conv));
    const lidPhoneDigits = (() => {
      if (!convIsLid) return '';
      const d = normalizeDigits(conv.contactPhone || '');
      return d.length >= 10 && d.length <= 13 && !looksLikeLongLidDigits(d) ? d : '';
    })();
    const digits =
      convIsLid && lidPhoneDigits
        ? lidPhoneDigits
        : looksLikeLongLidDigits(rawDigits)
          ? normalizeDigits(conv.waJidAlt?.split('@')[0] || '')
          : rawDigits;
    const phoneLabel =
      digits && !looksLikeLongLidDigits(digits) ? formatPhoneDisplay(digits) : '';
    const rawNumberOnly = !systemName && !friendlyStored && looksLikeDigitsOnlyContactLabel(waName);
    const lastResort = waNameIsLidDigits ? '' : waNameRaw;
    const crmPrimary = (systemName || (conv.waContactName ? (conv.contactName || '').trim() : '')).trim();
    const primary =
      crmPrimary ||
      friendlyStored ||
      (rawNumberOnly ? phoneLabel : waName) ||
      phoneLabel ||
      lastResort ||
      'Contato';

    const fromDatabase = Boolean(
      (systemName && same(primary, systemName)) ||
        (conv.waContactName && crmPrimary && same(primary, crmPrimary))
    );

    let whatsappSubtitle: string | undefined;
    const waSubtitleCandidate = waSavedOnPhone || waName;
    if (
      crmPrimary &&
      waSubtitleCandidate &&
      !looksLikeDigitsOnlyContactLabel(waSubtitleCandidate) &&
      !same(crmPrimary, waSubtitleCandidate)
    ) {
      whatsappSubtitle = waSubtitleCandidate;
    }

    let phoneSecondary: string | undefined;
    const phoneFmt = formatPhoneDisplay(digits);
    if (phoneFmt && primary !== phoneFmt && !looksLikeDigitsOnlyContactLabel(primary)) {
      phoneSecondary = phoneFmt;
    }

    map.set(conv.id, { primary, whatsappSubtitle, phoneSecondary, fromDatabase });
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

/** Na lista/cabeçalho: evita vários "Contato" iguais — mostra telefone ou sufixo do JID. */
export function inboxListTitle(disp: ConversationDisplay | undefined, conv: Conversation): string {
  const p = (disp?.primary || conv.contactName || '').trim();
  if (p && p.toLowerCase() !== 'contato' && !looksLikeLongLidDigits(p)) {
    if (!looksLikeDigitsOnlyPhoneLabel(p) || normalizeDigits(p).length <= 13) return p;
  }
  if (disp?.phoneSecondary) return disp.phoneSecondary;
  if (disp?.whatsappSubtitle) return disp.whatsappSubtitle;
  const lookupDigits = normalizeDigits(phoneRawForContactLookup(conv));
  if (lookupDigits.length >= 8) return formatPhoneDisplay(lookupDigits);
  const phone = normalizeDigits(conv.contactPhone || '');
  if (phone.length >= 8) return formatPhoneDisplay(phone);
  const tail = conv.id.includes(':') ? conv.id.slice(conv.id.lastIndexOf(':') + 1) : conv.id;
  const jidDigits = /^(\d{8,})@/i.exec(tail.trim());
  if (jidDigits) return `+${jidDigits[1].slice(0, 4)}…${jidDigits[1].slice(-4)}`;
  return 'Sem nome';
}

export function unreadCount(conv: Conversation): number {
  const n = conv.unreadCount;
  if (typeof n === 'number' && n > 0) return n;
  return 0;
}

export function isGroupConversation(conv: Conversation): boolean {
  return conv.id.includes('@g.us') || conv.id.toLowerCase().includes('group');
}

/** Cor estável por chip — facilita distinguir canais na lista de conversas. */
export function connectionBadgeHue(connectionId: string): number {
  let h = 0;
  for (let i = 0; i < connectionId.length; i++) h = (h * 31 + connectionId.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function countDistinctConnectionIds(conversations: Pick<Conversation, 'connectionId'>[]): number {
  const ids = new Set<string>();
  for (const c of conversations) {
    const id = (c.connectionId || '').trim();
    if (id) ids.add(id);
  }
  return ids.size;
}

export function connectionDisplayLabel(
  connections: Pick<WhatsAppConnection, 'id' | 'name' | 'phoneNumber'>[],
  connectionId: string
): string | null {
  if (!connectionId) return null;
  const conn = connections.find((c) => c.id === connectionId);
  if (!conn) return null;
  const name = (conn.name || '').trim();
  if (name) return name;
  const digits = (conn.phoneNumber || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    const d = digits.startsWith('55') ? digits : `55${digits}`;
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} …${d.slice(-4)}`;
  }
  return 'Canal';
}
