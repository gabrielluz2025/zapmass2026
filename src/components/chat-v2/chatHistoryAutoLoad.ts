/** Tempo máximo com spinner de auto-load ao abrir conversa com preview mas sem mensagens locais. */
export const HISTORY_AUTO_LOAD_MAX_MS = 55_000;

export const HISTORY_AUTO_LOAD_MAX_ATTEMPTS = 4;

export function conversationHasInboxActivity(conv: {
  lastMessage?: string;
  unreadCount?: number;
  lastMessageTimestamp?: number;
} | null | undefined): boolean {
  if (!conv) return false;
  return (
    Boolean((conv.lastMessage || '').trim()) ||
    (conv.unreadCount || 0) > 0 ||
    (conv.lastMessageTimestamp || 0) > 0
  );
}

/** Evita re-disparar auto-load quando inbox atualiza metadados (preview, unread) a cada socket tick. */
export function shouldStartHistoryAutoLoad(opts: {
  conversationId: string | null | undefined;
  socketConnected: boolean;
  msgCount: number;
  hasActivity: boolean;
  autoStatus: 'done' | 'giveup' | undefined;
}): boolean {
  if (!opts.conversationId || !opts.socketConnected) return false;
  if (opts.msgCount > 0) return false;
  if (!opts.hasActivity) return false;
  if (opts.autoStatus === 'done' || opts.autoStatus === 'giveup') return false;
  return true;
}

export function historyAutoLoadBackoffMs(attempt: number): number {
  return 1200 * Math.max(1, attempt);
}
