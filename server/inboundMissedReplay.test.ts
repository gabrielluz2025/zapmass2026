import { describe, expect, it, vi } from 'vitest';
import {
  collectInboundReplayCandidates,
  replayMissedInboundForConnection,
  resolveInboundReplayWindowStart,
} from './inboundMissedReplay.js';
import type { Conversation } from './types.js';

describe('collectInboundReplayCandidates', () => {
  it('coleta respostas inbound dentro da janela e ignora mensagens enviadas', () => {
    const windowStart = Date.now() - 3600_000;
    const convs: Conversation[] = [
      {
        id: 'conn1:5548999999999@s.whatsapp.net',
        contactName: 'João',
        contactPhone: '+5548999999999',
        connectionId: 'conn1',
        unreadCount: 1,
        lastMessage: 'quero',
        lastMessageTime: '',
        messages: [
          {
            id: 'm1',
            text: 'quero',
            timestamp: new Date(windowStart + 1000).toISOString(),
            timestampMs: windowStart + 1000,
            sender: 'them',
            status: 'delivered',
            type: 'text',
          },
          {
            id: 'm2',
            text: 'ok',
            timestamp: new Date(windowStart + 2000).toISOString(),
            timestampMs: windowStart + 2000,
            sender: 'me',
            status: 'sent',
            type: 'text',
          },
        ],
        tags: [],
      },
    ];

    const hits = collectInboundReplayCandidates('conn1', convs, windowStart);
    expect(hits).toHaveLength(1);
    expect(hits[0].bodyText).toBe('quero');
    expect(hits[0].phoneDigits).toContain('5548');
  });

  it('ignora mensagens anteriores à janela offline', () => {
    const windowStart = Date.now() - 1000;
    const convs: Conversation[] = [
      {
        id: 'conn1:5548999999999@s.whatsapp.net',
        contactName: 'Ana',
        contactPhone: '5548999887766',
        connectionId: 'conn1',
        unreadCount: 0,
        lastMessage: 'sair',
        lastMessageTime: '',
        messages: [
          {
            id: 'old',
            text: 'sair',
            timestamp: new Date(windowStart - 60_000).toISOString(),
            timestampMs: windowStart - 60_000,
            sender: 'them',
            status: 'delivered',
            type: 'text',
          },
        ],
        tags: [],
      },
    ];

    expect(collectInboundReplayCandidates('conn1', convs, windowStart)).toHaveLength(0);
  });
});

describe('resolveInboundReplayWindowStart', () => {
  it('manual ignora lastClosedAt recente e usa 72h', () => {
    const now = Date.now();
    const lastClosed = now - 60_000;
    const start = resolveInboundReplayWindowStart(now, lastClosed, true);
    expect(now - start).toBe(72 * 3600_000);
  });

  it('auto usa lastClosedAt quando existe', () => {
    const now = Date.now();
    const lastClosed = now - 10 * 60_000;
    const start = resolveInboundReplayWindowStart(now, lastClosed, false);
    expect(start).toBe(lastClosed);
  });
});

describe('replayMissedInboundForConnection', () => {
  it('no clique manual varre 72h mesmo com close recente', async () => {
    const now = Date.now();
    const convs: Conversation[] = [
      {
        id: 'conn1:5548999999999@s.whatsapp.net',
        contactName: 'João',
        contactPhone: '+5548999999999',
        connectionId: 'conn1',
        unreadCount: 1,
        lastMessage: 'quero',
        lastMessageTime: '',
        lastMessageTimestamp: now - 2 * 3600_000,
        messages: [
          {
            id: 'm-old-window',
            text: 'quero',
            timestamp: new Date(now - 2 * 3600_000).toISOString(),
            timestampMs: now - 2 * 3600_000,
            sender: 'them',
            status: 'delivered',
            type: 'text',
          },
        ],
        tags: [],
      },
    ];
    const processInbound = vi.fn().mockResolvedValue(undefined);
    const result = await replayMissedInboundForConnection(
      'conn1',
      'uid1',
      {
        getConversations: () => convs,
        loadChatHistory: async () => ({ ok: true }),
        getLastClosedAt: () => now - 30_000,
        processInbound,
        log: () => undefined,
      },
      { manual: true }
    );
    expect(result.scanned).toBe(1);
    expect(result.replayed).toBe(1);
    expect(result.windowHours).toBe(72);
    expect(processInbound).toHaveBeenCalledTimes(1);
  });
});

