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

  it('descarta legado sem connectionOwnerUid nem meta no cliente (escopo estrito)', () => {
    const incoming = [conv(legacyChip)];
    const owns = (cid: string, ou?: string) => ownsConnectionForUid(tenantUid, cid, ou);
    const out = mergeConversationsFromSocketUpdate([], incoming, owns);
    expect(out).toHaveLength(0);
  });

  it('não esvazia estado anterior se o filtro do cliente descartar tudo (corrida socket)', () => {
    const prev = [conv(`${tenantUid}__chip1`)];
    const incoming = [conv(legacyChip)];
    const owns = (cid: string, ou?: string) => ownsConnectionForUid(tenantUid, cid, ou);
    const out = mergeConversationsFromSocketUpdate(prev, incoming, owns);
    expect(out).toBe(prev);
    expect(out).toHaveLength(1);
  });
});
