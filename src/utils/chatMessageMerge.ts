import type { ChatMessage, Conversation } from '../types';

export function mergeChatMessageLists(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of a) {
    if (m?.id) byId.set(m.id, m);
  }
  for (const m of b) {
    if (!m?.id) continue;
    const ex = byId.get(m.id);
    if (!ex) {
      byId.set(m.id, m);
      continue;
    }
    byId.set(m.id, {
      ...ex,
      ...m,
      mediaUrl: m.mediaUrl || ex.mediaUrl,
      fromCampaign: m.fromCampaign || ex.fromCampaign,
      campaignId: m.campaignId || ex.campaignId,
      waRemoteJidAlt: m.waRemoteJidAlt || ex.waRemoteJidAlt,
      waSenderPn: m.waSenderPn || ex.waSenderPn
    });
  }
  return Array.from(byId.values()).sort((x, y) => (x.timestampMs || 0) - (y.timestampMs || 0));
}

function newestMsg(msgs: ChatMessage[]): ChatMessage | undefined {
  if (!msgs.length) return undefined;
  return msgs.reduce((best, m) => ((m.timestampMs || 0) >= (best.timestampMs || 0) ? m : best));
}

/** Preview da lista = última mensagem real da thread. */
export function applyLatestMessagePreview(conv: Conversation): Conversation {
  const last = newestMsg(conv.messages || []);
  if (!last) return conv;
  const ts = Math.max(conv.lastMessageTimestamp || 0, last.timestampMs || 0);
  const text = (last.text || '').trim();
  return {
    ...conv,
    lastMessage: text || conv.lastMessage,
    lastMessageTime: last.timestamp || conv.lastMessageTime,
    lastMessageTimestamp: ts
  };
}

/**
 * Se o WhatsApp atualizou o preview (lastMessage) mas o array ainda não tem esse recado,
 * inclui na thread para a conversa aberta não ficar atrasada em relação à lista.
 */
export function ensureLatestPreviewInMessages(conv: Conversation): Conversation {
  const previewText = (conv.lastMessage || '').trim();
  const previewTs = conv.lastMessageTimestamp || 0;
  const msgs = Array.isArray(conv.messages) ? [...conv.messages] : [];
  const last = newestMsg(msgs);
  const lastTs = last?.timestampMs || 0;

  if (previewText && previewTs > lastTs + 800) {
    const dup = msgs.some(
      (m) =>
        (m.text || '').trim() === previewText && Math.abs((m.timestampMs || 0) - previewTs) < 800
    );
    if (!dup) {
      const sameText = last && (last.text || '').trim() === previewText ? last.sender : undefined;
      msgs.push({
        id: `preview:${previewTs}:${previewText.slice(0, 48)}`,
        text: previewText,
        timestamp: conv.lastMessageTime || '',
        sender: sameText || 'them',
        status: sameText === 'me' ? 'sent' : 'delivered',
        type: 'text',
        timestampMs: previewTs
      });
    }
  }

  return applyLatestMessagePreview({ ...conv, messages: msgs });
}
