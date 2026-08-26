import { describe, expect, it } from 'vitest';
import { collectInboundReplayCandidates } from './inboundMissedReplay.js';
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
