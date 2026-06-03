import { describe, expect, it } from 'vitest';
import { sliceInboxPage, sortConversationsByActivity } from './inboxPagination.js';
import type { Conversation } from './types.js';

function conv(id: string, ts: number): Conversation {
  return {
    id,
    contactName: id,
    contactPhone: '',
    connectionId: 'c1',
    unreadCount: 0,
    lastMessage: '',
    lastMessageTime: '',
    lastMessageTimestamp: ts,
    messages: [],
    tags: [],
  };
}

describe('sliceInboxPage', () => {
  it('retorna primeira página ordenada', () => {
    const sorted = sortConversationsByActivity([conv('a', 300), conv('b', 200), conv('c', 100)]);
    const page = sliceInboxPage(sorted, { limit: 2 });
    expect(page.conversations.map((c) => c.id)).toEqual(['a', 'b']);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(200);
    expect(page.total).toBe(3);
  });

  it('cursor avança para próxima página', () => {
    const sorted = sortConversationsByActivity([conv('a', 300), conv('b', 200), conv('c', 100)]);
    const p2 = sliceInboxPage(sorted, { limit: 2, cursor: 200 });
    expect(p2.conversations.map((c) => c.id)).toEqual(['c']);
    expect(p2.hasMore).toBe(false);
  });
});
