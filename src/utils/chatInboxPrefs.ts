/** Preferências locais da inbox (pin, arquivo, snooze, agendamento). */

export type InboxSmartTab =
  | 'all'
  | 'unread'
  | 'hot'
  | 'campaign'
  | 'team'
  | 'archived'
  | 'snoozed';

export type ScheduledOutbound = {
  id: string;
  conversationId: string;
  text: string;
  sendAt: number;
  connectionId?: string;
};

export type ChatInboxPrefsState = {
  pinnedIds: string[];
  archivedIds: string[];
  /** conversationId → acordar em (ms epoch) */
  snoozedUntil: Record<string, number>;
  scheduled: ScheduledOutbound[];
};

const STORAGE_KEY = 'zapmass.chatInboxPrefs.v1';

function emptyState(): ChatInboxPrefsState {
  return { pinnedIds: [], archivedIds: [], snoozedUntil: {}, scheduled: [] };
}

export function loadChatInboxPrefs(): ChatInboxPrefsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<ChatInboxPrefsState>;
    return {
      pinnedIds: Array.isArray(parsed.pinnedIds) ? parsed.pinnedIds.filter(Boolean) : [],
      archivedIds: Array.isArray(parsed.archivedIds) ? parsed.archivedIds.filter(Boolean) : [],
      snoozedUntil:
        parsed.snoozedUntil && typeof parsed.snoozedUntil === 'object' ? parsed.snoozedUntil : {},
      scheduled: Array.isArray(parsed.scheduled) ? parsed.scheduled : [],
    };
  } catch {
    return emptyState();
  }
}

export function saveChatInboxPrefs(state: ChatInboxPrefsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

export function isConversationPinned(state: ChatInboxPrefsState, id: string): boolean {
  return state.pinnedIds.includes(id);
}

export function isConversationArchived(state: ChatInboxPrefsState, id: string): boolean {
  return state.archivedIds.includes(id);
}

export function isConversationSnoozed(state: ChatInboxPrefsState, id: string, now = Date.now()): boolean {
  const until = state.snoozedUntil[id];
  return typeof until === 'number' && until > now;
}

export function togglePinnedPref(state: ChatInboxPrefsState, id: string): ChatInboxPrefsState {
  const set = new Set(state.pinnedIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return { ...state, pinnedIds: [...set] };
}

export function toggleArchivedPref(state: ChatInboxPrefsState, id: string): ChatInboxPrefsState {
  const set = new Set(state.archivedIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return { ...state, archivedIds: [...set] };
}

export function snoozeConversationPref(
  state: ChatInboxPrefsState,
  id: string,
  untilMs: number
): ChatInboxPrefsState {
  return { ...state, snoozedUntil: { ...state.snoozedUntil, [id]: untilMs } };
}

export function wakeConversationPref(state: ChatInboxPrefsState, id: string): ChatInboxPrefsState {
  const next = { ...state.snoozedUntil };
  delete next[id];
  return { ...state, snoozedUntil: next };
}

export function addScheduledMessagePref(
  state: ChatInboxPrefsState,
  item: ScheduledOutbound
): ChatInboxPrefsState {
  return { ...state, scheduled: [...state.scheduled, item] };
}

export function removeScheduledMessagePref(state: ChatInboxPrefsState, id: string): ChatInboxPrefsState {
  return { ...state, scheduled: state.scheduled.filter((s) => s.id !== id) };
}

/** Remove snoozes expirados e devolve ids que acordaram. */
export function pruneExpiredSnoozes(state: ChatInboxPrefsState, now = Date.now()): {
  state: ChatInboxPrefsState;
  wokeIds: string[];
} {
  const wokeIds: string[] = [];
  const next: Record<string, number> = {};
  for (const [id, until] of Object.entries(state.snoozedUntil)) {
    if (until > now) next[id] = until;
    else wokeIds.push(id);
  }
  if (wokeIds.length === 0) return { state, wokeIds };
  return { state: { ...state, snoozedUntil: next }, wokeIds };
}
