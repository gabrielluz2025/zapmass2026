import { describe, expect, it } from 'vitest';
import { collectArchiveThreadIds, archiveContactPhoneGuess } from './chatArchiveMerge.js';
import type { Conversation } from './types.js';

/** Garante que chaves de thread usadas no load-chat-history batem com persistência @lid + telefone. */
describe('chat archive roundtrip keys', () => {
  it('mesmas chaves para gravar e reler conversa @lid com telefone', () => {
    const conversationId = 'conn_x:120363012345678901@lid';
    const meta: Conversation = {
      id: conversationId,
      contactName: 'Cliente',
      contactPhone: '+554299870542',
      connectionId: 'conn_x',
      unreadCount: 0,
      lastMessage: 'Preview campanha',
      lastMessageTime: '',
      lastMessageTimestamp: 1_761_500_000_000,
      messages: [],
      tags: [],
    };
    const cp = archiveContactPhoneGuess(conversationId, meta);
    const keys = collectArchiveThreadIds(conversationId, meta, cp);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys).toContain('p_554299870542');
    expect(keys.some((k) => k.startsWith('lid_'))).toBe(true);
  });
});
