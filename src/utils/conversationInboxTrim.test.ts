import { describe, expect, it } from 'vitest';
import type { Conversation } from '../types';
import { mergeConversationsFromSocketUpdate } from './conversationInboxTrim';
import { ownsConnectionForUid } from './connectionScope';

const conv = (connectionId: string, connectionOwnerUid?: string): Conversation => ({
  id: `${connectionId}:5511999999999@s.whatsapp.net`,
  contactName: 'Teste',
  contactPhone: '5511999999999',
  connectionId,
  connectionOwnerUid,
  unreadCount: 0,
  lastMessage: '',
  lastMessageTime: '',
  messages: [],
  tags: []
});

describe('mergeConversationsFromSocketUpdate (escopo conn_*)', () => {
  const tenantUid = 'tenantOwner1';
  const legacyChip = 'conn_1700000000000';

  it('aceita conversa legada quando connectionOwnerUid veio no payload (antes de connections-update)', () => {
    const incoming = [conv(legacyChip, tenantUid)];
    const owns = (cid: string, ou?: string) => ownsConnectionForUid(tenantUid, cid, ou);
    const out = mergeConversationsFromSocketUpdate([], incoming, owns);
    expect(out).toHaveLength(1);
  });

  it('confia no payload do servidor quando filtro local descarta legado (corrida antes de connections-update)', () => {
    const incoming = [conv(legacyChip)];
    const owns = (cid: string, ou?: string) => ownsConnectionForUid(tenantUid, cid, ou);
    const out = mergeConversationsFromSocketUpdate([], incoming, owns);
    expect(out).toHaveLength(1);
    expect(out[0].connectionId).toBe(legacyChip);
  });

  it('substitui estado anterior pelo payload do servidor quando filtro local falha (corrida socket)', () => {
    const prev = [conv(`${tenantUid}__chip1`)];
    const incoming = [conv(legacyChip, tenantUid)];
    const owns = (cid: string, ou?: string) => ownsConnectionForUid(tenantUid, cid, ou);
    const out = mergeConversationsFromSocketUpdate(prev, incoming, owns);
    expect(out).not.toBe(prev);
    expect(out).toHaveLength(1);
    expect(out[0].connectionId).toBe(legacyChip);
  });
});
