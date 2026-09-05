import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../../types';
import { buildDisplayIndex, inboxListTitle } from './conversationDisplay';

describe('conversationDisplay LID', () => {
  const lidConv: Conversation = {
    id: 'conn_1:208023100387464@lid',
    connectionId: 'conn_1',
    contactName: '+208023100387464',
    contactPhone: '+208023100387464',
    unreadCount: 5,
    lastMessage: 'oi',
    lastMessageTime: '13:50',
    lastMessageTimestamp: 1,
    messages: [],
    tags: []
  };

  it('nao trata digitos @lid como telefone na lista', () => {
    const disp = buildDisplayIndex([lidConv], []).get(lidConv.id);
    expect(inboxListTitle(disp, lidConv)).not.toBe('+208023100387464');
    expect(inboxListTitle(disp, lidConv)).toContain('…');
  });
});
