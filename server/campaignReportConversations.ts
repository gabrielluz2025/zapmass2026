import { recipientKeyForCampaignReport } from '../src/utils/campaignReportDedupe.js';
import {
  CAMPAIGN_SENT_LOG_MESSAGE,
  campaignLogPayloadMatchesCampaign,
  type CampaignLogPayloadLike,
  logPayloadPhoneKey
} from '../src/utils/campaignReportFromLogs.js';
import { normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import {
  isWaChatArchiveEnabled,
  loadChatArchiveMessages,
  threadIdFromConversationId
} from './chatArchiveStore.js';
import type { ChatMessage, Conversation } from './types.js';

type ScopedLog = { timestamp: string; payload?: unknown };

function sentContactsFromLogs(
  scopedLogs: ScopedLog[],
  campaignId: string
): Array<{ rk: string; connectionId: string; phone: string }> {
  const cid = String(campaignId || '').trim();
  const out = new Map<string, { connectionId: string; phone: string }>();
  for (const log of scopedLogs) {
    if (!log.payload || typeof log.payload !== 'object') continue;
    const p = log.payload as CampaignLogPayloadLike;
    if (!campaignLogPayloadMatchesCampaign(p, cid)) continue;
    if (String(p.message || '') !== CAMPAIGN_SENT_LOG_MESSAGE) continue;
    const rk = logPayloadPhoneKey(p);
    if (!rk) continue;
    out.set(rk, {
      connectionId: String(p.connectionId || ''),
      phone: rk
    });
  }
  return Array.from(out.entries()).map(([rk, v]) => ({ rk, ...v }));
}

function conversationMatchesPhone(conv: Conversation, rk: string, connectionId: string): boolean {
  if (connectionId && conv.connectionId !== connectionId) return false;
  const cp = recipientKeyForCampaignReport(conv.contactPhone || '');
  if (cp && cp === rk) return true;
  const jidPart = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : '';
  const jidKey = recipientKeyForCampaignReport(jidPart.split('@')[0] || '');
  return jidKey === rk;
}

function mergeMessages(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of a) byId.set(m.id, m);
  for (const m of b) {
    const existing = byId.get(m.id);
    if (!existing) {
      byId.set(m.id, m);
      continue;
    }
    if (m.fromCampaign) existing.fromCampaign = true;
    if (m.campaignId) existing.campaignId = m.campaignId;
    if (m.status === 'read' || m.status === 'delivered') existing.status = m.status;
    if (m.text && !existing.text) existing.text = m.text;
    if ((m.timestampMs || 0) > (existing.timestampMs || 0)) {
      existing.timestampMs = m.timestampMs;
      existing.timestamp = m.timestamp;
    }
  }
  return Array.from(byId.values()).sort((x, y) => (x.timestampMs || 0) - (y.timestampMs || 0));
}

function buildConversationId(connectionId: string, phoneDigits: string): string {
  const digits = normalizePhoneDigits(phoneDigits);
  return `${connectionId}:${digits || phoneDigits}@s.whatsapp.net`;
}

/**
 * Conversas para montar relatório: memória Evolution + arquivo Postgres/Firestore
 * dos contatos que receberam envio nesta campanha.
 */
export async function buildCampaignReportConversationContext(
  tenantId: string,
  campaignId: string,
  scopedLogs: ScopedLog[],
  allowedConnectionIds: string[]
): Promise<Conversation[]> {
  const { getConversations } = await import('./evolutionService.js');
  const live = getConversations();
  const allowed = new Set((allowedConnectionIds || []).filter(Boolean));
  const byId = new Map<string, Conversation>();
  for (const c of live) byId.set(c.id, c);

  if (!isWaChatArchiveEnabled() || !tenantId) {
    return live;
  }

  const sentContacts = sentContactsFromLogs(scopedLogs, campaignId);
  for (const { rk, connectionId, phone } of sentContacts) {
    if (!connectionId) continue;
    if (allowed.size > 0 && !allowed.has(connectionId)) continue;

    const convId = buildConversationId(connectionId, phone);
    const contactPhone = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`;
    const threadId = threadIdFromConversationId(convId, contactPhone);
    if (!threadId) continue;

    let conv =
      byId.get(convId) ||
      live.find((c) => conversationMatchesPhone(c, rk, connectionId)) ||
      null;

    const archived = await loadChatArchiveMessages(tenantId, threadId, 500);
    if (archived.length === 0 && !conv) continue;

    const base: Conversation =
      conv ||
      ({
        id: convId,
        contactName: contactPhone.replace(/\D/g, '') || rk,
        contactPhone,
        connectionId,
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: '',
        messages: [],
        tags: ['Campanha']
      } as Conversation);

    const mergedMsgs = mergeMessages(base.messages || [], archived);
    const last = mergedMsgs[mergedMsgs.length - 1];
    const next: Conversation = {
      ...base,
      id: conv?.id || convId,
      contactPhone: base.contactPhone || contactPhone,
      messages: mergedMsgs,
      lastMessage: last?.text || base.lastMessage,
      lastMessageTime: last?.timestamp || base.lastMessageTime,
      lastMessageTimestamp: last?.timestampMs || base.lastMessageTimestamp
    };
    byId.set(next.id, next);
  }

  return Array.from(byId.values());
}
