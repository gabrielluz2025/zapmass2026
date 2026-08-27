/** Rascunho de texto por conversa (persistido no browser). */

const STORAGE_KEY = 'zapmass.chatDrafts.v1';
const MAX_DRAFTS = 400;

function loadAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(map: Record<string, string>): void {
  try {
    const keys = Object.keys(map);
    if (keys.length > MAX_DRAFTS) {
      const trimmed: Record<string, string> = {};
      for (const k of keys.slice(-MAX_DRAFTS)) trimmed[k] = map[k]!;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function loadConversationDraft(conversationId: string): string {
  if (!conversationId) return '';
  return loadAll()[conversationId] ?? '';
}

export function saveConversationDraft(conversationId: string, text: string): void {
  if (!conversationId) return;
  const map = loadAll();
  const t = text.trim();
  if (!t) {
    delete map[conversationId];
  } else {
    map[conversationId] = text;
  }
  saveAll(map);
}

export function clearConversationDraft(conversationId: string): void {
  saveConversationDraft(conversationId, '');
}
