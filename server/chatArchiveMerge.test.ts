import { describe, expect, it } from 'vitest';
import { archiveContactPhoneGuess, collectArchiveThreadIds } from './chatArchiveMerge.js';
import type { Conversation } from './types.js';

describe('collectArchiveThreadIds', () => {
  it('inclui lid_* e p_* quando conversa @lid tem telefone resolvido', () => {
    const conversationId = 'conn_1:120363012345678901@lid';
    const meta: Conversation = {
      id: conversationId,
      contactName: 'Contato',
      contactPhone: '+554299870542',
      connectionId: 'conn_1',
      unreadCount: 0,
      lastMessage: 'Oi',
      lastMessageTime: '',
      messages: [],
      tags: [],
    };
    const cp = archiveContactPhoneGuess(conversationId, meta);
    expect(cp).toBe('554299870542');
    const ids = collectArchiveThreadIds(conversationId, meta, cp);
    expect(ids.some((t) => t.startsWith('lid_'))).toBe(true);
    expect(ids).toContain('p_554299870542');
  });

  it('inclui thread do waJidAlt @s.whatsapp.net', () => {
    const conversationId = 'conn_1:120363012345678901@lid';
    const meta: Conversation = {
      id: conversationId,
      contactName: 'Contato',
      contactPhone: '',
      connectionId: 'conn_1',
      waJidAlt: '554299870542@s.whatsapp.net',
      unreadCount: 0,
      lastMessage: '',
      lastMessageTime: '',
      messages: [],
      tags: [],
    };
    const cp = archiveContactPhoneGuess(conversationId, meta);
    const ids = collectArchiveThreadIds(conversationId, meta, cp);
    expect(ids).toContain('p_554299870542');
    expect(ids.some((t) => t.startsWith('lid_'))).toBe(true);
  });

  it('inclui variantes p_* para telefone com/sem 9º dígito BR', () => {
    const conversationId = 'conn_1:554799127001@s.whatsapp.net';
    const meta: Conversation = {
      id: conversationId,
      contactName: 'Contato',
      contactPhone: '+554799127001',
      connectionId: 'conn_1',
      unreadCount: 0,
      lastMessage: '',
      lastMessageTime: '',
      messages: [],
      tags: [],
    };
    const cp = archiveContactPhoneGuess(conversationId, meta);
    const ids = collectArchiveThreadIds(conversationId, meta, cp);
    expect(ids).toContain('p_554799127001');
    expect(ids).toContain('p_5547999127001');
  });
});
