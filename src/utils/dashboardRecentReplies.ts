import type { Contact, Conversation, SystemLog } from '../types';
import { normPhoneKey } from './brPhoneNormalize';
import { isCampaignReplyLogMessage } from './campaignReportFromLogs';

export type DashboardRecentReply = {
  id: string;
  name: string;
  phone: string;
  preview: string;
  tsMs: number;
  ts: string;
};

function parseTsMs(raw?: string | number): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function latestInboundFromConversation(conv: Conversation): { preview: string; tsMs: number } | null {
  const msgs = Array.isArray(conv.messages) ? conv.messages : [];
  let best: { preview: string; tsMs: number } | null = null;
  for (const m of msgs) {
    if (m.sender !== 'them') continue;
    const tsMs = parseTsMs(m.timestampMs ?? m.timestamp);
    if (!tsMs) continue;
    const preview = String(m.text || '').trim();
    if (!best || tsMs > best.tsMs) {
      best = { preview: preview || '(mensagem)', tsMs };
    }
  }
  if (best) return best;
  const lastTs = parseTsMs(conv.lastMessageTimestamp ?? conv.lastMessageTime);
  const lastText = String(conv.lastMessage || '').trim();
  if (lastTs > 0 && lastText) {
    return { preview: lastText, tsMs: lastTs };
  }
  return null;
}

function buildContactNameByPhone(contacts: Contact[]): Map<string, { id: string; name: string; phone: string }> {
  const map = new Map<string, { id: string; name: string; phone: string }>();
  for (const c of contacts) {
    const key = normPhoneKey(c.phone);
    if (key.length < 10) continue;
    map.set(key, { id: c.id, name: c.name || c.phone || 'Contato', phone: c.phone || key });
  }
  return map;
}

function upsertReply(
  bucket: Map<string, DashboardRecentReply>,
  phoneRaw: string,
  name: string,
  preview: string,
  tsMs: number
): void {
  if (!tsMs) return;
  const key = normPhoneKey(phoneRaw);
  if (key.length < 8) return;
  const clip = preview.slice(0, 160);
  const existing = bucket.get(key);
  if (existing && existing.tsMs >= tsMs) return;
  bucket.set(key, {
    id: `reply-${key}-${tsMs}`,
    name: name.trim() || phoneRaw,
    phone: phoneRaw,
    preview: clip,
    tsMs,
    ts: new Date(tsMs).toISOString()
  });
}

/** Lista unificada de respostas recentes (chat + logs de campanha) para o painel. */
export function buildDashboardRecentReplies(
  conversations: Conversation[],
  contacts: Contact[],
  systemLogs: SystemLog[],
  limit = 8
): DashboardRecentReply[] {
  const byPhone = new Map<string, DashboardRecentReply>();
  const contactByPhone = buildContactNameByPhone(contacts);

  for (const conv of conversations) {
    const inbound = latestInboundFromConversation(conv);
    if (!inbound) continue;
    const key = normPhoneKey(conv.contactPhone);
    const fromContact = contactByPhone.get(key);
    upsertReply(
      byPhone,
      conv.contactPhone,
      fromContact?.name || conv.contactName || conv.contactPhone,
      inbound.preview,
      inbound.tsMs
    );
  }

  for (const log of systemLogs) {
    const ev = String(log.event || '').toLowerCase();
    if (!ev.includes('campaign')) continue;
    const p = (log.payload || {}) as {
      message?: string;
      to?: string;
      phoneDigits?: string;
      replyPreview?: string;
    };
    const msg = String(p.message || '').trim();
    const isReply = isCampaignReplyLogMessage(msg) || Boolean(p.replyPreview);
    if (!isReply) continue;
    const phone = String(p.to || p.phoneDigits || '').trim();
    if (!phone) continue;
    const tsMs = parseTsMs(log.timestamp);
    const key = normPhoneKey(phone);
    const fromContact = contactByPhone.get(key);
    upsertReply(
      byPhone,
      phone,
      fromContact?.name || phone,
      String(p.replyPreview || msg || 'Respondeu na campanha'),
      tsMs
    );
  }

  return Array.from(byPhone.values())
    .filter((r) => r.tsMs >= Date.now() - 14 * 86400000)
    .sort((a, b) => b.tsMs - a.tsMs)
    .slice(0, limit);
}
