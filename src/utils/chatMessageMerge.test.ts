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
  it('deduplica mensagens com texto idêntico no mesmo remetente em janela curta', () => {
    const listA = [
      {
        id: 'camp_123',
        text: 'Seu cadastro foi confirmado!',
        timestamp: '11:29',
        sender: 'me' as const,
        status: 'sent' as const,
        type: 'text' as const,
        fromCampaign: true,
        campaignId: 'camp-1',
        timestampMs: 10000
      }
    ];
    const listB = [
      {
        id: 'wamid_xyz',
        text: 'Seu cadastro foi confirmado!',
        timestamp: '11:29',
        sender: 'me' as const,
        status: 'delivered' as const,
        type: 'text' as const,
        timestampMs: 11000
      }
    ];

    const merged = mergeChatMessageLists(listA, listB);
    expect(merged).toHaveLength(1);
    expect(merged[0].fromCampaign).toBe(true);
    expect(merged[0].campaignId).toBe('camp-1');
  });
});
