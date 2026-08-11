import { describe, expect, it } from 'vitest';
import type { Conversation } from '../types';
import { ensureLatestPreviewInMessages, mergeChatMessageLists } from './chatMessageMerge';

describe('ensureLatestPreviewInMessages', () => {
  it('acrescenta o preview mais novo quando o array ficou para trás', () => {
    const conv: Conversation = {
      id: 'c1:1@s.whatsapp.net',
      contactName: 'Zap-mass',
      contactPhone: '',
      connectionId: 'c1',
      unreadCount: 0,
      lastMessage: 'teste',
      lastMessageTime: '13:58',
      lastMessageTimestamp: 1_000_000 + 60_000,
      messages: [
        {
          id: 'old',
          text: 'teste',
          timestamp: '13:57',
          sender: 'me',
          status: 'sent',
          type: 'text',
          timestampMs: 1_000_000
        }
      ],
      tags: []
    };
    const out = ensureLatestPreviewInMessages(conv);
    expect(out.messages).toHaveLength(2);
    expect(out.messages[1].text).toBe('teste');
    expect(out.messages[1].timestampMs).toBe(1_000_000 + 60_000);
    expect(out.messages[1].sender).toBe('me');
    expect(out.lastMessageTimestamp).toBe(1_000_000 + 60_000);
  });
});

describe('mergeChatMessageLists', () => {
  it('nao descarta mensagem nova so porque o historico e maior', () => {
    const prev = [
      { id: 'a', text: 'oi', timestamp: '1', sender: 'them' as const, status: 'delivered' as const, type: 'text' as const, timestampMs: 1 },
      { id: 'b', text: 'ok', timestamp: '2', sender: 'me' as const, status: 'sent' as const, type: 'text' as const, timestampMs: 2 }
    ];
    const inc = [
      { id: 'c', text: 'teste', timestamp: '3', sender: 'me' as const, status: 'sent' as const, type: 'text' as const, timestampMs: 3 }
    ];
    const out = mergeChatMessageLists(prev, inc);
    expect(out.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});
