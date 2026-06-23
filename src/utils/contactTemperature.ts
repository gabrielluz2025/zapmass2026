import type { Contact, Conversation } from '../types';
import { normPhoneKey } from './brPhoneNormalize';

export type ContactTemperature = 'hot' | 'warm' | 'cold' | 'new';

export interface TempStats {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  lastSentTs: number;
  lastReplyTs: number;
  lastReadTs: number;
  temp: ContactTemperature;
  score: number;
}

export const CONTACT_TEMP_LABEL: Record<ContactTemperature, string> = {
  hot: 'Quente',
  warm: 'Morno',
  cold: 'Frio',
  new: 'Sem hist.'
};

export function classifyTemperature(stats: Omit<TempStats, 'temp' | 'score'>): {
  temp: ContactTemperature;
  score: number;
} {
  const now = Date.now();
  const DAY = 86400000;
  const daysSinceReply = stats.lastReplyTs ? (now - stats.lastReplyTs) / DAY : Infinity;
  const daysSinceRead = stats.lastReadTs ? (now - stats.lastReadTs) / DAY : Infinity;
  const daysSinceSent = stats.lastSentTs ? (now - stats.lastSentTs) / DAY : Infinity;

  if (stats.sent === 0) return { temp: 'new', score: 0 };

  const recencyBonus = daysSinceReply < 30 ? 30 : daysSinceReply < 90 ? 15 : 0;
  const readBonus = daysSinceRead < 30 ? 10 : daysSinceRead < 90 ? 5 : 0;
  const score = Math.round(
    Math.min(stats.replied, 10) * 25 +
      stats.read * 4 +
      stats.delivered * 1.5 +
      recencyBonus +
      readBonus
  );

  if (daysSinceReply <= 30 || (stats.replied >= 2 && daysSinceReply <= 180)) {
    return { temp: 'hot', score };
  }
  if (
    daysSinceReply <= 90 ||
    daysSinceRead <= 90 ||
    stats.read >= 1 ||
    (stats.delivered >= 2 && daysSinceSent <= 120)
  ) {
    return { temp: 'warm', score };
  }
  if (daysSinceSent <= 180) return { temp: 'cold', score };
  return { temp: 'cold', score };
}

/** Últimas N mensagens por conversa (500 era pesado com muitas threads). */
const MAX_MESSAGES_SCAN_PER_CONV = 150;

/** Mesmo resultado que `classifyTemperature` sobre base vazia — útil enquanto o mapa por id ainda não carregou. */
export const CONTACT_TEMP_DEFAULT: TempStats = {
  sent: 0,
  delivered: 0,
  read: 0,
  replied: 0,
  lastSentTs: 0,
  lastReplyTs: 0,
  lastReadTs: 0,
  temp: 'new',
  score: 0
};

export type PhoneStatsBase = Omit<TempStats, 'temp' | 'score'>;

const stripDigits = (p: string) => (p || '').replace(/\D/g, '');

const convPrimaryDigits = (conv: Conversation) => {
  const jid = conv.id || '';
  const [, suffix = ''] = jid.split('@');
  const [user = ''] = jid.split('@');
  if (suffix === 'lid') return stripDigits(conv.contactPhone || '');
  if (/^\d+$/.test(user)) return user;
  return stripDigits(conv.contactPhone || '') || user.replace(/\D/g, '');
};

const emptyPhoneStats = (): PhoneStatsBase => ({
  sent: 0,
  delivered: 0,
  read: 0,
  replied: 0,
  lastSentTs: 0,
  lastReplyTs: 0,
  lastReadTs: 0
});

/**
 * Índice telefone → métricas de mensagens (varre conversas uma vez).
 * Cache por referência do array `conversations`.
 */
let __phoneIndexConvs: Conversation[] | null = null;
let __phoneIndexResult: Record<string, PhoneStatsBase> | null = null;

export function buildPhoneMessageStatsIndex(conversations: Conversation[]): Record<string, PhoneStatsBase> {
  if (__phoneIndexResult && __phoneIndexConvs === conversations) {
    return __phoneIndexResult;
  }

  const byPhone: Record<string, PhoneStatsBase> = {};

  const accum = (phone: string) => {
    if (!byPhone[phone]) byPhone[phone] = emptyPhoneStats();
    return byPhone[phone];
  };

  for (const conv of conversations) {
    const phoneKey = normPhoneKey(convPrimaryDigits(conv));
    if (!phoneKey || phoneKey.length < 11) continue;
    const s = accum(phoneKey);
    const all = conv.messages || [];
    const msgs =
      all.length > MAX_MESSAGES_SCAN_PER_CONV
        ? all.slice(all.length - MAX_MESSAGES_SCAN_PER_CONV)
        : all;

    let lastMeTs = 0;
    let waitingReply = false;

    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const ts = m.timestampMs || (m.timestamp ? Date.parse(m.timestamp) : 0) || 0;
      if (!ts) continue;

      if (m.sender === 'me') {
        s.sent++;
        if (ts > s.lastSentTs) s.lastSentTs = ts;
        lastMeTs = ts;
        waitingReply = true;

        const st = (m as { status?: string }).status;
        if (st === 'delivered' || st === 'read') s.delivered++;
        if (st === 'read') {
          s.read++;
          if (ts > s.lastReadTs) s.lastReadTs = ts;
        }
      } else if (m.sender === 'them') {
        if (ts > s.lastReplyTs) s.lastReplyTs = ts;
        if (lastMeTs > 0 && ts > lastMeTs) {
          if (waitingReply) {
            s.replied++;
            waitingReply = false;
          }
        }
      }
    }
  }

  __phoneIndexConvs = conversations;
  __phoneIndexResult = byPhone;
  return byPhone;
}

/** Invalida caches (útil em testes ou após mutação in-place de conversas). */
export function invalidateContactTemperatureCache(): void {
  __phoneIndexConvs = null;
  __phoneIndexResult = null;
  __tempCacheContacts = null;
  __tempCacheConvs = null;
  __tempCacheResult = null;
}

export function mapContactToTempStats(
  contact: Contact,
  phoneIndex: Record<string, PhoneStatsBase>
): TempStats {
  const p = normPhoneKey(contact.phone);
  let base = phoneIndex[p] ? { ...phoneIndex[p] } : emptyPhoneStats();

  if (base.sent === 0 && (contact.campaignMessagesReceived || 0) > 0) {
    const previewTs = contact.campaignTablePreview?.updatedAt
      ? Date.parse(contact.campaignTablePreview.updatedAt) || 0
      : 0;
    const sent = contact.campaignMessagesReceived || 0;
    base = {
      sent,
      delivered: sent,
      read: 0,
      replied: 0,
      lastSentTs: previewTs,
      lastReplyTs: 0,
      lastReadTs: 0
    };
  }

  const cls = classifyTemperature(base);
  return { ...base, temp: cls.temp, score: cls.score };
}

/**
 * Mapeia um lote de contatos usando índice já construído (para processamento incremental).
 */
export function mapContactsToTempStats(
  contacts: Contact[],
  phoneIndex: Record<string, PhoneStatsBase>,
  start = 0,
  end = contacts.length
): Record<string, TempStats> {
  const result: Record<string, TempStats> = {};
  const hi = Math.min(end, contacts.length);
  for (let i = start; i < hi; i++) {
    const c = contacts[i];
    result[c.id] = mapContactToTempStats(c, phoneIndex);
  }
  return result;
}

/**
 * Cache por referência (contacts + conversations). Vários painéis (mapa, dashboard)
 * pedem o mesmo cálculo: sem isto, cada um varre 10k contatos × conversas a cada render.
 */
let __tempCacheContacts: Contact[] | null = null;
let __tempCacheConvs: Conversation[] | null = null;
let __tempCacheResult: Record<string, TempStats> | null = null;

/**
 * Mapa contactId -> temperatura a partir do histórico de conversas globais.
 */
export function computeContactTemperatures(
  contacts: Contact[],
  conversations: Conversation[]
): Record<string, TempStats> {
  if (
    __tempCacheResult &&
    __tempCacheContacts === contacts &&
    __tempCacheConvs === conversations
  ) {
    return __tempCacheResult;
  }
  const phoneIndex = buildPhoneMessageStatsIndex(conversations);
  const out = mapContactsToTempStats(contacts, phoneIndex);
  __tempCacheContacts = contacts;
  __tempCacheConvs = conversations;
  __tempCacheResult = out;
  return out;
}
