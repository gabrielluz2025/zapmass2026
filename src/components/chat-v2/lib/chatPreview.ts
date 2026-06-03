import type { ChatMessage, Conversation } from '../../../types';

export function getLastMsgPreview(conv: Conversation): string {
  const last = conv.messages?.[conv.messages.length - 1];
  if (last) {
    if (last.type === 'image') return last.text?.trim() || 'Foto';
    if (last.type === 'video') return last.text?.trim() || 'Vídeo';
    if (last.type === 'audio') return 'Áudio';
    if (last.type === 'sticker') return 'Figurinha';
    if (last.type === 'document') return last.text?.trim() || 'Documento';
    const text = (last.text || conv.lastMessage || '').trim();
    if (text && text !== '[Mídia]') return text;
  }
  const preview = (conv.lastMessage || '').trim();
  if (preview && preview !== '[Mídia]') return preview;
  return '';
}

export function formatMessageBubbleText(msg: ChatMessage): string {
  const text = (msg.text || '').trim();
  if (text && text !== '[Mídia]') return text;
  switch (msg.type) {
    case 'image':
      return 'Foto';
    case 'video':
      return 'Vídeo';
    case 'audio':
      return 'Áudio';
    case 'sticker':
      return 'Figurinha';
    case 'document':
      return 'Documento';
    default:
      return text || 'Mídia';
  }
}

export function getConversationPipelineAgg(conv: Conversation | undefined) {
  if (!conv) return null;
  const msgs = conv.messages || [];
  const outbound = msgs.filter((m) => m.sender === 'me');
  const inbound = msgs.filter((m) => m.sender === 'them');
  return {
    sent: outbound.length,
    delivered: outbound.filter((m) => m.status === 'delivered' || m.status === 'read').length,
    read: outbound.filter((m) => m.status === 'read').length,
    replies: inbound.length
  };
}
