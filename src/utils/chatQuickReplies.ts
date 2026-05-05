export type ChatQuickReply = { text: string; emoji: string };

export const CHAT_QUICK_REPLIES_MAX_ITEMS = 12;
export const CHAT_QUICK_REPLY_TEXT_MAX = 300;

const STORAGE_KEY = 'zapmass.chatQuickReplies';

export const DEFAULT_CHAT_QUICK_REPLIES: ChatQuickReply[] = [
  { text: 'Ola! Tudo bem?', emoji: '👋' },
  { text: 'Obrigado pelo contato!', emoji: '🙏' },
  { text: 'Vou verificar e ja retorno.', emoji: '🔍' },
  { text: 'Perfeito! Vamos la!', emoji: '🚀' },
  { text: 'Pode me enviar mais detalhes?', emoji: '📝' }
];

export function cloneDefaultChatQuickReplies(): ChatQuickReply[] {
  return DEFAULT_CHAT_QUICK_REPLIES.map((r) => ({ ...r }));
}

function normalizeStoredRow(raw: unknown): ChatQuickReply | null {
  if (!raw || typeof raw !== 'object') return null;
  const text = String((raw as ChatQuickReply).text ?? '')
    .trim()
    .slice(0, CHAT_QUICK_REPLY_TEXT_MAX);
  let emoji = String((raw as ChatQuickReply).emoji ?? '').trim().slice(0, 16);
  if (!emoji) emoji = '💬';
  if (!text) return null;
  return { text, emoji };
}

/** Carrega mensagens rápidas salvas ou os valores padrão. */
export function loadChatQuickReplies(): ChatQuickReply[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaultChatQuickReplies();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return cloneDefaultChatQuickReplies();
    const out: ChatQuickReply[] = [];
    for (const row of parsed) {
      const n = normalizeStoredRow(row);
      if (n) out.push(n);
      if (out.length >= CHAT_QUICK_REPLIES_MAX_ITEMS) break;
    }
    return out.length > 0 ? out : cloneDefaultChatQuickReplies();
  } catch {
    return cloneDefaultChatQuickReplies();
  }
}

/** Persiste no `localStorage` (navegador / mesmo perfil). */
export function saveChatQuickReplies(items: ChatQuickReply[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, CHAT_QUICK_REPLIES_MAX_ITEMS)));
  } catch {
    /* quota / privado */
  }
}
