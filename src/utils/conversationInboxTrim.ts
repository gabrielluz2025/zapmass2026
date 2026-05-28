import type { ChatMessage, Conversation } from '../types';

/** Últimas N mensagens no estado em memória após cada `conversations-update` (liste + Contacts/temperatura). */
const SYNC_MSG_TAIL = (() => {
  const raw = Number(import.meta.env.VITE_CHAT_SYNC_MSG_TAIL ?? 80);
  if (!Number.isFinite(raw)) return 80;
  return Math.max(32, Math.min(220, Math.floor(raw)));
})();

function newestActivityMs(conv: Conversation): number {
  const msgs = conv.messages || [];
  const last = msgs[msgs.length - 1] as ChatMessage | undefined;
  const fromMsg =
    last != null ? last.timestampMs ?? (last.timestamp ? Date.parse(last.timestamp) : NaN) : NaN;
  const fromMsgN = typeof fromMsg === 'number' && Number.isFinite(fromMsg) ? fromMsg : 0;
  return Math.max(conv.lastMessageTimestamp ?? 0, fromMsgN);
}

export function trimConversationMessagesTail(conv: Conversation, maxTail: number = SYNC_MSG_TAIL): Conversation {
  const msgs = Array.isArray(conv.messages) ? conv.messages : [];
  if (msgs.length <= maxTail) return conv;
  return { ...conv, messages: msgs.slice(-maxTail) };
}

/** Hash leve da lista incoming para evitar refazer o merge do mesmo payload (servidor pode reemitir igual). */
function hashIncoming(list: Conversation[]): string {
  let s = `${list.length}|`;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    s += `${c.id}:${c.lastMessageTimestamp || 0}:${c.unreadCount || 0}:${c.messages?.length || 0};`;
  }
  return s;
}

let lastIncomingHash = '';
let lastResult: Conversation[] | null = null;

/**
 * Combina atualização socket com estado anterior:
 * - Aplica tail em cada conversa nova (peso menor na RAM / clone).
 * - Se o cliente já tinha mais mensagens para o mesmo id e parece igual ou mais recente
 *   que o sync, mantém o buffer maior (histórico aberto antes do próximo broadcast).
 * - Cache de hash: se o mesmo payload chegar 2x (sync + reemit), devolve a referência anterior
 *   para evitar re-render desnecessário em todos os assinantes do contexto.
 */
export function mergeConversationsFromSocketUpdate(
  prev: Conversation[],
  incoming: Conversation[],
  ownsConnectionId: (connectionId: string, connectionOwnerUid?: string) => boolean,
  maxTail: number = SYNC_MSG_TAIL
): Conversation[] {
  const h = hashIncoming(incoming);
  if (h === lastIncomingHash && lastResult && prev === lastResult) return prev;
  const filtered = incoming.filter((c) =>
    ownsConnectionId(c.connectionId, c.connectionOwnerUid)
  );
  /** Servidor já filtrou; vazio aqui costuma ser corrida antes de connections-update / ownerUid. */
  if (filtered.length === 0 && incoming.length > 0) {
    return prev;
  }
  const trimmedIncoming = filtered.map((c) => trimConversationMessagesTail(c, maxTail));
  const prevById = new Map(prev.map((c) => [c.id, c]));
  const out = trimmedIncoming.map((inc) => {
    const p = prevById.get(inc.id);
    if (!p || !Array.isArray(p.messages) || p.messages.length <= inc.messages.length) return inc;
    const tPrev = newestActivityMs(p);
    const tInc = newestActivityMs(inc);
    if (tPrev >= tInc) return { ...inc, messages: p.messages };
    return inc;
  });
  lastIncomingHash = h;
  lastResult = out;
  return out;
}

export const conversationSyncTailLimit = SYNC_MSG_TAIL;
