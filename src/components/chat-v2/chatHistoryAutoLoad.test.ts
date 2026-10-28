import { describe, expect, it } from 'vitest';
import {
  conversationHasInboxActivity,
  historyAutoLoadBackoffMs,
  shouldStartHistoryAutoLoad,
} from './chatHistoryAutoLoad';

describe('chatHistoryAutoLoad', () => {
  it('detecta atividade pelo preview ou timestamp', () => {
    expect(conversationHasInboxActivity({ lastMessage: 'Oi' })).toBe(true);
    expect(conversationHasInboxActivity({ lastMessageTimestamp: 1 })).toBe(true);
    expect(conversationHasInboxActivity({ unreadCount: 2 })).toBe(true);
    expect(conversationHasInboxActivity({ lastMessage: '   ' })).toBe(false);
  });

  it('nao reinicia auto-load apos giveup ou quando ja ha mensagens', () => {
    expect(
      shouldStartHistoryAutoLoad({
        conversationId: 'c:1@lid',
        socketConnected: true,
        msgCount: 0,
        hasActivity: true,
        autoStatus: 'giveup',
      })
    ).toBe(false);
    expect(
      shouldStartHistoryAutoLoad({
        conversationId: 'c:1@lid',
        socketConnected: true,
        msgCount: 3,
        hasActivity: true,
        autoStatus: undefined,
      })
    ).toBe(false);
    expect(
      shouldStartHistoryAutoLoad({
        conversationId: 'c:1@lid',
        socketConnected: true,
        msgCount: 0,
        hasActivity: true,
        autoStatus: undefined,
      })
    ).toBe(true);
  });

  it('backoff cresce por tentativa', () => {
    expect(historyAutoLoadBackoffMs(1)).toBe(1200);
    expect(historyAutoLoadBackoffMs(3)).toBe(3600);
  });
});
