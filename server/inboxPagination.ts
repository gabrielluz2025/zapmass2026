import type { Conversation } from './types.js';

export type InboxPagePayload = {
  conversations: Conversation[];
  nextCursor: number | null;
  hasMore: boolean;
  total: number;
  reset?: boolean;
};

export const INBOX_PAGE_SIZE_DEFAULT = (() => {
  const raw = Number(process.env.CHAT_INBOX_PAGE_SIZE ?? 60);
  if (!Number.isFinite(raw)) return 60;
  return Math.max(20, Math.min(150, Math.floor(raw)));
})();

export function isInboxPaginationEnabled(): boolean {
  const raw = process.env.CHAT_INBOX_PAGINATION?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return true;
};

export function sortConversationsByActivity(list: Conversation[]): Conversation[] {
  return [...list].sort(
    (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
  );
}

/** Cursor = `lastMessageTimestamp` da última linha da página anterior. */
export function sliceInboxPage(
  sorted: Conversation[],
  opts?: { cursor?: number | null; limit?: number }
): InboxPagePayload {
  const limit =
    opts?.limit != null
      ? Math.max(1, Math.min(150, Math.floor(opts.limit)))
      : INBOX_PAGE_SIZE_DEFAULT;
  const cursor =
    opts?.cursor != null && Number.isFinite(Number(opts.cursor)) ? Number(opts.cursor) : null;

  const filtered =
    cursor != null
      ? sorted.filter((c) => (c.lastMessageTimestamp || 0) < cursor)
      : sorted;

  const page = filtered.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    filtered.length > limit && last?.lastMessageTimestamp != null
      ? last.lastMessageTimestamp
      : null;

  return {
    conversations: page,
    nextCursor,
    hasMore: filtered.length > limit,
    total: sorted.length,
  };
}
