import type { Contact, Conversation } from '../types';

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

/** Chave única por telefone (BR: adiciona 55 se faltar) — igual à lógica na aba Contatos. */
export function normPhoneKey(p: string): string {
  let d = (p || '').replace(/\D/g, '');
  if (!d) return '';
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`;
  return d;
}

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
    stats.replied * 25 + stats.read * 4 + stats.delivered * 1.5 + recencyBonus + readBonus
  );

  if (daysSinceReply <= 30 || stats.replied >= 2) return { temp: 'hot', score };
  if (daysSinceReply <= 90 || daysSinceRead <= 30 || stats.read >= 3) return { temp: 'warm', score };
  if (daysSinceSent <= 180) return { temp: 'cold', score };
  return { temp: 'cold', score };
}

const MAX_MESSAGES_SCAN_PER_CONV = 500;

/**
 * Mapa contactId -> temperatura a partir do histórico de conversas globais.
 */
export function computeContactTemperatures(
  contacts: Contact[],
  conversations: Conversation[]
): Record<string, TempStats> {
  const byPhone: Record<string, Omit<TempStats, 'temp' | 'score'>> = {};
  const stripDigits = (p: string) => (p || '').replace(/\D/g, '');
  const convPrimaryDigits = (conv: Conversation) => {
    const jid = conv.id || '';
    const [, suffix = ''] = jid.split('@');
    const [user = ''] = jid.split('@');
    if (suffix === 'lid') return stripDigits(conv.contactPhone || '');
    if (/^\d+$/.test(user)) return user;
    return stripDigits(conv.contactPhone || '') || user.replace(/\D/g, '');
  };

  const accum = (phone: string) => {
    if (!byPhone[phone]) {
      byPhone[phone] = {
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        lastSentTs: 0,
        lastReplyTs: 0,
        lastReadTs: 0
      };
    }
    return byPhone[phone];
  };

  for (const conv of conversations) {
    const phoneKey = normPhoneKey(convPrimaryDigits(conv));
    if (!phoneKey || phoneKey.length < 12) continue;
    const s = accum(phoneKey);
    const all = conv.messages || [];
    const msgs = all.length > MAX_MESSAGES_SCAN_PER_CONV ? all.slice(all.length - MAX_MESSAGES_SCAN_PER_CONV) : all;
    let maxOutTs = 0;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const ts = m.timestampMs || (m.timestamp ? Date.parse(m.timestamp) : 0) || 0;
      if (m.sender === 'me') {
        s.sent++;
        if (ts > s.lastSentTs) s.lastSentTs = ts;
        if (ts > maxOutTs) maxOutTs = ts;
        const st = (m as { status?: string }).status;
        if (st === 'delivered' || st === 'read') s.delivered++;
        if (st === 'read') {
          s.read++;
          if (ts > s.lastReadTs) s.lastReadTs = ts;
        }
      }
    }
    if (maxOutTs > 0) {
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m.sender !== 'them') continue;
        const ts = m.timestampMs || (m.timestamp ? Date.parse(m.timestamp) : 0) || 0;
        if (ts > maxOutTs) {
          s.replied++;
          if (ts > s.lastReplyTs) s.lastReplyTs = ts;
        }
      }
    }
  }

  const result: Record<string, TempStats> = {};
  for (const c of contacts) {
    const p = normPhoneKey(c.phone);
    const base =
      byPhone[p] ||
      ({
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        lastSentTs: 0,
        lastReplyTs: 0,
        lastReadTs: 0
      } as Omit<TempStats, 'temp' | 'score'>);
    const cls = classifyTemperature(base);
    result[c.id] = { ...base, temp: cls.temp, score: cls.score };
  }
  return result;
}
