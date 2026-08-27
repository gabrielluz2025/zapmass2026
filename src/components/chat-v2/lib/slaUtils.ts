import type { Conversation } from '../../../types';
import { unreadCount } from './conversationDisplay';

export type SlaLevel = 'ok' | 'warn' | 'critical' | 'none';

/** Tempo desde última mensagem inbound (ms). */
export function lastInboundMs(conv: Conversation): number | null {
  const msgs = conv.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.sender === 'them' && m.timestampMs) return m.timestampMs;
  }
  if (unreadCount(conv) > 0 && conv.lastMessageTimestamp) return conv.lastMessageTimestamp;
  return null;
}

export function slaLevelForConversation(conv: Conversation, now = Date.now()): SlaLevel {
  const inbound = lastInboundMs(conv);
  if (!inbound || unreadCount(conv) === 0) return 'none';
  const age = now - inbound;
  if (age < 5 * 60_000) return 'ok';
  if (age < 60 * 60_000) return 'warn';
  return 'critical';
}

export function slaLabel(level: SlaLevel): string {
  switch (level) {
    case 'ok':
      return 'Recente';
    case 'warn':
      return 'Aguardando';
    case 'critical':
      return 'Atrasado';
    default:
      return '';
  }
}
