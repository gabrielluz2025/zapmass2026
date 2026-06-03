import { describe, expect, it } from 'vitest';
import { scrubInvalidConversationPhone } from './contactPhoneEnrich.js';
import type { Conversation } from './types.js';

describe('scrubInvalidConversationPhone', () => {
  it('remove dígitos LID gravados como contactPhone', () => {
    const conv: Conversation = {
      id: 'conn:251174049550446@lid',
      contactName: 'Gabriel',
      contactPhone: '+251174049550446',
      connectionId: 'conn',
      unreadCount: 0,
      lastMessage: 'oi',
      lastMessageTime: '',
      messages: [],
      tags: []
    };
    const out = scrubInvalidConversationPhone(conv, '251174049550446@lid');
    expect(out.contactPhone).toBe('');
  });

  it('preserva telefone BR válido em @c.us', () => {
    const conv: Conversation = {
      id: 'conn:5511999887766@s.whatsapp.net',
      contactName: 'Ana',
      contactPhone: '+5511999887766',
      connectionId: 'conn',
      unreadCount: 0,
      lastMessage: '',
      lastMessageTime: '',
      messages: [],
      tags: []
    };
    const out = scrubInvalidConversationPhone(conv, '5511999887766@s.whatsapp.net');
    expect(out.contactPhone).toBe('+5511999887766');
  });
});
