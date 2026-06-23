import { describe, expect, it } from 'vitest';
import type { Conversation } from '../types';
import { mergeConversationDelta, mergeConversationsFromSocketUpdate } from './conversationInboxTrim';
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

  it('preserva historico local quando payload socket vem enxuto (sem messages) mas atualiza preview', () => {
    const id = `${legacyChip}:5511999999999@s.whatsapp.net`;
    const prev: Conversation[] = [
      {
        ...conv(legacyChip, tenantUid),
        id,
        messages: [
          {
            id: 'm1',
            text: 'antiga',
            timestamp: '10:00',
            timestampMs: 1_700_000_000_000,
            sender: 'them',
            status: 'delivered',
            type: 'text'
          }
        ],
        lastMessage: 'antiga',
        lastMessageTimestamp: 1_700_000_000_000
      }
    ];
    const incoming: Conversation[] = [
      {
        ...conv(legacyChip, tenantUid),
        id,
        messages: [],
        lastMessage: 'nova',
        lastMessageTimestamp: 1_700_000_100_000
      }
    ];
    const owns = (cid: string, ou?: string) => ownsConnectionForUid(tenantUid, cid, ou);
    const out = mergeConversationsFromSocketUpdate(prev, incoming, owns);
    expect(out[0].lastMessage).toBe('nova');
    expect(out[0].messages).toHaveLength(1);
    expect(out[0].messages[0].text).toBe('antiga');
  });

  it('preserva historico profundo apos sync enxuto do socket', () => {
    const id = `${legacyChip}:5511999999999@s.whatsapp.net`;
    const deepMsgs = Array.from({ length: 500 }, (_, i) => ({
      id: `m${i}`,
      text: `msg ${i}`,
      timestamp: '10:00',
      timestampMs: 1_700_000_000_000 + i,
      sender: 'them' as const,
      status: 'delivered' as const,
      type: 'text' as const
    }));
    const prev: Conversation[] = [
      {
        ...conv(legacyChip, tenantUid),
        id,
        messages: deepMsgs,
        lastMessage: 'msg 499',
        lastMessageTimestamp: deepMsgs[deepMsgs.length - 1].timestampMs
      }
    ];
    const incoming: Conversation[] = [
      {
        ...conv(legacyChip, tenantUid),
        id,
        messages: deepMsgs.slice(-25),
        lastMessage: 'msg 499',
        lastMessageTimestamp: deepMsgs[deepMsgs.length - 1].timestampMs
      }
    ];
    const owns = (cid: string, ou?: string) => ownsConnectionForUid(tenantUid, cid, ou);
    const out = mergeConversationsFromSocketUpdate(prev, incoming, owns);
    expect(out[0].messages.length).toBe(500);
  });
});

describe('mergeConversationDelta (bolha pending)', () => {
  it('remove mensagens pending-* quando chega ACK com id real', () => {
    const id = 'conn_x:5511999999999@s.whatsapp.net';
    const prev: Conversation[] = [
      {
        ...conv('conn_x', 'u1'),
        id,
        messages: [
          {
            id: 'pending-100',
            text: 'oi',
            timestamp: '12:00',
            timestampMs: 100,
            sender: 'me',
            status: 'pending',
            type: 'text'
          }
        ]
      }
    ];
    const delta: Conversation = {
      ...conv('conn_x', 'u1'),
      id,
      messages: [
        {
          id: 'ABCD1234',
          text: 'oi',
          timestamp: '12:00',
          timestampMs: 105,
          sender: 'me',
          status: 'sent',
          type: 'text'
        }
      ],
      lastMessage: 'oi',
      lastMessageTimestamp: 105
    };
    const out = mergeConversationDelta(prev, delta, () => true);
    expect(out[0].messages).toHaveLength(1);
    expect(out[0].messages[0].id).toBe('ABCD1234');
    expect(out[0].messages[0].status).toBe('sent');
  });
});
