import { describe, expect, it } from 'vitest';
import { collapseConversationsByPhone } from './collapseConversationsByPhone';
import type { Conversation } from '../types';

describe('collapseConversationsByPhone', () => {
  it('une @lid e @s.whatsapp.net do mesmo numero no mesmo chip', () => {
    const conn = 'conn_abc';
    const list: Conversation[] = [
      {
        id: `${conn}:251174049550446@lid`,
        connectionId: conn,
        contactName: 'Gabriel',
        contactPhone: '+554799127801',
        waJidAlt: '554799127801@s.whatsapp.net',
        unreadCount: 0,
        lastMessage: '5',
        lastMessageTime: '16:39',
        lastMessageTimestamp: 1000,
        messages: [{ id: 'm1', text: '5', timestamp: '16:39', sender: 'them', timestampMs: 1000, status: 'sent' as const, type: 'text' as const }],
        tags: []
      },
      {
        id: `${conn}:554799127801@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'Gabriel',
        contactPhone: '+554799127801',
        unreadCount: 1,
        lastMessage: 'pdf',
        lastMessageTime: '23:44',
        lastMessageTimestamp: 2000,
        messages: [{ id: 'm2', text: 'pdf', timestamp: '23:44', sender: 'me', timestampMs: 2000, status: 'delivered' as const, type: 'text' as const }],
        tags: []
      }
    ];
    const out = collapseConversationsByPhone(list);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(`${conn}:554799127801@s.whatsapp.net`);
    expect(out[0].messages).toHaveLength(2);
    expect(out[0].unreadCount).toBe(1);
    expect(out[0].lastMessage).toBe('pdf');
  });

  it('nao une contatos diferentes no mesmo chip', () => {
    const conn = 'conn_x';
    const out = collapseConversationsByPhone([
      {
        id: `${conn}:5511999999999@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'A',
        contactPhone: '+5511999999999',
        unreadCount: 0,
        lastMessage: 'a',
        lastMessageTime: '',
        lastMessageTimestamp: 1,
        messages: [],
        tags: []
      },
      {
        id: `${conn}:5521888888888@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'B',
        contactPhone: '+5521888888888',
        unreadCount: 0,
        lastMessage: 'b',
        lastMessageTime: '',
        lastMessageTimestamp: 2,
        messages: [],
        tags: []
      }
    ]);
    expect(out).toHaveLength(2);
  });
});
