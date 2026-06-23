import type { ChatMessage, Conversation } from '../types';
import { collapseConversationsByPhone } from './collapseConversationsByPhone';

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

export function trimConversationMessagesTail(
  conv: Conversation,
  maxTail: number = SYNC_MSG_TAIL,
  preserveMinCount?: number
): Conversation {
  const msgs = Array.isArray(conv.messages) ? conv.messages : [];
  const limit =
    typeof preserveMinCount === 'number' && preserveMinCount > maxTail ? preserveMinCount : maxTail;
  if (msgs.length <= limit) return conv;
  return { ...conv, messages: msgs.slice(-limit) };
}

/** Remove ids duplicados (virtualizer quebra com key repetida). */
export function dedupeConversationsById(list: Conversation[]): Conversation[] {
  const m = new Map<string, Conversation>();
  for (const c of list) {
    const ex = m.get(c.id);
    if (!ex || newestActivityMs(c) >= newestActivityMs(ex)) m.set(c.id, c);
  }
  return Array.from(m.values());
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
  /**
   * Servidor já aplicou escopo por tenant. Se o filtro local descartar tudo (corrida:
   * connections-update ainda não chegou ao cliente), confia no payload do servidor
   * para não deixar o bate-papo vazio.
   */
  const scopedIncoming =
    filtered.length === 0 && incoming.length > 0 ? incoming : filtered;
  const trimmedIncoming = scopedIncoming.map((c) => trimConversationMessagesTail(c, maxTail));
  const dedupedIncoming = dedupeConversationsById(trimmedIncoming);
  const prevById = new Map(prev.map((c) => [c.id, c]));
  const out = dedupedIncoming
    .map((inc) => {
      const p = prevById.get(inc.id);
      // Payload enxuto do servidor remove foto base64 (data:) — preserva a que o cliente já tinha.
      const withPic =
        !inc.profilePicUrl && p?.profilePicUrl ? { ...inc, profilePicUrl: p.profilePicUrl } : inc;

      const mergedMeta: Conversation = {
        ...withPic,
        contactName: (withPic.contactName || p?.contactName || '').trim() || withPic.contactName,
        contactPhone: withPic.contactPhone || p?.contactPhone || '',
        waJidAlt: withPic.waJidAlt || p?.waJidAlt,
        lastMessage: (withPic.lastMessage || '').trim() ? withPic.lastMessage : p?.lastMessage || withPic.lastMessage,
        lastMessageTime: withPic.lastMessageTime || p?.lastMessageTime || '',
        lastMessageTimestamp: Math.max(
          withPic.lastMessageTimestamp ?? 0,
          p?.lastMessageTimestamp ?? 0,
          newestActivityMs(withPic),
          p ? newestActivityMs(p) : 0
        ),
        unreadCount:
          typeof withPic.unreadCount === 'number'
            ? withPic.unreadCount
            : p?.unreadCount ?? withPic.unreadCount,
      };

      const prevMsgs = Array.isArray(p?.messages) ? p!.messages : [];
      const incMsgs = Array.isArray(withPic.messages) ? withPic.messages : [];

      if (prevMsgs.length === 0) {
        return trimConversationMessagesTail(mergedMeta, maxTail);
      }
      if (incMsgs.length === 0) {
        return { ...mergedMeta, messages: prevMsgs };
      }

      const byId = new Map<string, ChatMessage>();
      for (const m of prevMsgs) byId.set(m.id, m);
      for (const m of incMsgs) {
        const ex = byId.get(m.id);
        if (ex) {
          if (m.waRemoteJidAlt && !ex.waRemoteJidAlt) ex.waRemoteJidAlt = m.waRemoteJidAlt;
          if (m.waSenderPn && !ex.waSenderPn) ex.waSenderPn = m.waSenderPn;
          byId.set(m.id, ex);
        } else {
          byId.set(m.id, m);
        }
      }
      const mergedMsgs = Array.from(byId.values()).sort(
        (a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)
      );
      return trimConversationMessagesTail(
        { ...mergedMeta, messages: mergedMsgs },
        maxTail,
        prevMsgs.length
      );
    })
    .sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0));
  if (h === lastIncomingHash && lastResult && lastResult.length === out.length && prev === lastResult) {
    return prev;
  }
  lastIncomingHash = h;
  const collapsed = collapseConversationsByPhone(out);
  lastResult = collapsed;
  return collapsed;
}

export const conversationSyncTailLimit = SYNC_MSG_TAIL;

function mergeOneConversation(
  prev: Conversation | undefined,
  inc: Conversation,
  maxTail: number
): Conversation {
  const withPic =
    !inc.profilePicUrl && prev?.profilePicUrl ? { ...inc, profilePicUrl: prev.profilePicUrl } : inc;

  const mergedMeta: Conversation = {
    ...withPic,
    contactName: (withPic.contactName || prev?.contactName || '').trim() || withPic.contactName,
    contactPhone: withPic.contactPhone || prev?.contactPhone || '',
    waJidAlt: withPic.waJidAlt || prev?.waJidAlt,
    lastMessage: (withPic.lastMessage || '').trim() ? withPic.lastMessage : prev?.lastMessage || withPic.lastMessage,
    lastMessageTime: withPic.lastMessageTime || prev?.lastMessageTime || '',
    lastMessageTimestamp: Math.max(
      withPic.lastMessageTimestamp ?? 0,
      prev?.lastMessageTimestamp ?? 0,
      newestActivityMs(withPic),
      prev ? newestActivityMs(prev) : 0
    ),
    unreadCount:
      typeof withPic.unreadCount === 'number' ? withPic.unreadCount : prev?.unreadCount ?? withPic.unreadCount,
    waPresence:
      (withPic.waPresenceUpdatedAt ?? 0) >= (prev?.waPresenceUpdatedAt ?? 0)
        ? withPic.waPresence ?? prev?.waPresence
        : prev?.waPresence ?? withPic.waPresence,
    waPresenceUpdatedAt: Math.max(
      withPic.waPresenceUpdatedAt ?? 0,
      prev?.waPresenceUpdatedAt ?? 0
    ) || undefined,
    waLastSeenMs: Math.max(withPic.waLastSeenMs ?? 0, prev?.waLastSeenMs ?? 0) || undefined
  };

  const prevMsgs = Array.isArray(prev?.messages) ? prev!.messages : [];
  const incMsgs = Array.isArray(withPic.messages) ? withPic.messages : [];

  if (prevMsgs.length === 0) return trimConversationMessagesTail(mergedMeta, maxTail);
  if (incMsgs.length === 0) return { ...mergedMeta, messages: prevMsgs };

  const ackOutgoing = incMsgs.some(
    (m) => m.sender === 'me' && m.id && !String(m.id).startsWith('pending-')
  );
  const basePrev = ackOutgoing
    ? prevMsgs.filter((m) => !String(m.id).startsWith('pending-'))
    : prevMsgs;

  const byId = new Map<string, ChatMessage>();
  for (const m of basePrev) byId.set(m.id, m);
  for (const m of incMsgs) {
    const ex = byId.get(m.id);
    if (ex) {
      if (m.waRemoteJidAlt && !ex.waRemoteJidAlt) ex.waRemoteJidAlt = m.waRemoteJidAlt;
      if (m.waSenderPn && !ex.waSenderPn) ex.waSenderPn = m.waSenderPn;
      if (m.status && ex.sender === 'me') ex.status = m.status;
      byId.set(m.id, ex);
    } else {
      byId.set(m.id, m);
    }
  }
  const mergedMsgs = Array.from(byId.values()).sort(
    (a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)
  );
  return trimConversationMessagesTail(
    { ...mergedMeta, messages: mergedMsgs },
    maxTail,
    prevMsgs.length
  );
}

/** Atualização incremental (`conversation-delta`) — uma conversa por evento. */
export function mergeConversationDelta(
  prev: Conversation[],
  delta: Conversation,
  ownsConnectionId: (connectionId: string, connectionOwnerUid?: string) => boolean,
  maxTail: number = SYNC_MSG_TAIL
): Conversation[] {
  const trimmed = trimConversationMessagesTail(delta, maxTail);
  const scoped =
    ownsConnectionId(trimmed.connectionId, trimmed.connectionOwnerUid) ||
    (prev.length === 0 && trimmed.id);
  if (!scoped) return prev;

  const prevById = new Map(prev.map((c) => [c.id, c]));
  const merged = mergeOneConversation(prevById.get(trimmed.id), trimmed, maxTail);
  const next = prevById.has(trimmed.id)
    ? prev.map((c) => (c.id === trimmed.id ? merged : c))
    : [...prev, merged];
  return collapseConversationsByPhone(
    dedupeConversationsById(next).sort(
      (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
    )
  );
}
