import type { Conversation } from '../../types';

export type ConversationOrigin = 'phone' | 'system' | 'empty';

/** Classifica origem: só campanha (Disparo) vs conversa real no celular. */
export function classifyConversation(conv: Conversation): ConversationOrigin {
  const msgs = conv.messages || [];
  const hasPreview = Boolean((conv.lastMessage || '').trim());
  const hasTs =
    typeof conv.lastMessageTimestamp === 'number' &&
    Number.isFinite(conv.lastMessageTimestamp) &&
    conv.lastMessageTimestamp > 0;
  if (msgs.length === 0) {
    if (hasPreview || hasTs) return 'phone';
    return 'empty';
  }
  const hasIncoming = msgs.some((m) => m.sender === 'them');
  if (hasIncoming) return 'phone';
  const allFromCampaign = msgs.every((m) => m.sender === 'me' && m.fromCampaign === true);
  if (allFromCampaign) return 'system';
  return 'phone';
}

export function buildOriginIndex(conversations: Conversation[]): Map<string, ConversationOrigin> {
  const map = new Map<string, ConversationOrigin>();
  for (const c of conversations) map.set(c.id, classifyConversation(c));
  return map;
}

export function countSystemConversations(originById: Map<string, ConversationOrigin>): number {
  let n = 0;
  for (const o of originById.values()) if (o === 'system') n++;
  return n;
}
