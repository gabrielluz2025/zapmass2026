import { filterByConnectionScope } from './connectionScopeServer.js';
import {
  applyInboxAssignmentFilter,
  enrichOwnerInboxClaims,
  tagStaffOwnClaims
} from './inboxAssignments.js';
import { enrichConversationsWithCrmNames } from './contactNameEnrich.js';
import { enrichConversationsWithCrmPhones } from './contactPhoneEnrich.js';
import { resolvePostgresTenantId } from './auth/firebaseUidMap.js';
import { usePostgresChatArchive } from './chatArchiveStore.js';
import {
  INBOX_PAGE_SIZE_DEFAULT,
  sliceInboxPage,
  sortConversationsByActivity,
  type InboxPagePayload,
} from './inboxPagination.js';
import { listInboxThreadStubsPg } from './repositories/chatArchiveRepository.js';
import type { Conversation } from './types.js';
import { collapseConversationsByPhone } from '../src/utils/collapseConversationsByPhone.js';

/** Resolve dono de canal legado (`conn_*` sem `uid__`) para `filterByConnectionScope`. */
export type ConnectionOwnerResolver = (connectionId: string) => string | undefined;

/**
 * Remove base64 pesado (foto de perfil `data:` e mídia `data:` das mensagens) do payload
 * de broadcast. Isso reduz o array de vários MB para alguns KB e evita travar o event loop
 * ao serializar. Fotos chegam via `conversation-picture`/sob demanda; mídia via loadMessageMedia.
 * O merge no frontend preserva o que o cliente já tem.
 */
export function slimConversationsForBroadcast(list: Conversation[]): Conversation[] {
  return list.map((conv) => {
    const pic = conv.profilePicUrl;
    const slimPic = pic && pic.startsWith('data:') ? undefined : pic;
    let slimMessages = conv.messages;
    if (
      Array.isArray(conv.messages) &&
      conv.messages.some((m) => typeof m.mediaUrl === 'string' && m.mediaUrl.startsWith('data:'))
    ) {
      slimMessages = conv.messages.map((m) =>
        typeof m.mediaUrl === 'string' && m.mediaUrl.startsWith('data:')
          ? { ...m, mediaUrl: undefined }
          : m
      );
    }
    if (slimPic === pic && slimMessages === conv.messages) return conv;
    return { ...conv, profilePicUrl: slimPic, messages: slimMessages };
  });
}

/** Máximo de mensagens por conversa no payload socket (lista + tempo real). Histórico completo via load-chat-history. */
const SOCKET_INBOX_MSG_TAIL = (() => {
  const raw = Number(process.env.CHAT_SOCKET_MSG_TAIL ?? 25);
  if (!Number.isFinite(raw)) return 25;
  return Math.max(15, Math.min(80, Math.floor(raw)));
})();

/** Limite de conversas no broadcast completo (evita JSON gigante na RAM). */
const SOCKET_MAX_CONVERSATIONS = (() => {
  const raw = Number(process.env.CHAT_SOCKET_MAX_CONVERSATIONS ?? 800);
  if (!Number.isFinite(raw)) return 800;
  return Math.max(200, Math.min(3000, Math.floor(raw)));
})();

/**
 * Payload final para `conversations-update`: remove base64 pesado e limita mensagens por conversa.
 * Sem isso, 2000+ chats com histórico em RAM viram JSON de dezenas de MB e travam o event loop (latência 90s+).
 */
function trimConversationListForSocket(list: Conversation[]): Conversation[] {
  if (list.length <= SOCKET_MAX_CONVERSATIONS) return list;
  return [...list]
    .sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
    .slice(0, SOCKET_MAX_CONVERSATIONS);
}

export function prepareConversationsForSocketEmit(list: Conversation[]): Conversation[] {
  return trimConversationListForSocket(slimConversationsForBroadcast(collapseConversationsByPhone(list))).map((c) => {
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    if (msgs.length <= SOCKET_INBOX_MSG_TAIL) return c;
    return { ...c, messages: msgs.slice(-SOCKET_INBOX_MSG_TAIL) };
  });
}

export function prepareSingleConversationForSocketEmit(conv: Conversation): Conversation {
  const [one] = prepareConversationsForSocketEmit([conv]);
  return one;
}

/**
 * Histórico completo para callback `load-chat-history` (não usar tail de 25 do socket).
 * Remove base64 pesado mas devolve até `maxMessages` entradas para o cliente aplicar direto.
 */
export function prepareConversationHistoryForClient(
  conv: Conversation,
  maxMessages: number
): Conversation['messages'] {
  const capped = Math.max(50, Math.min(maxMessages, MAX_HISTORY_CLIENT_MSGS));
  const [slim] = slimConversationsForBroadcast([conv]);
  if (!slim) return [];
  const msgs = Array.isArray(slim.messages) ? slim.messages : [];
  if (msgs.length <= capped) return msgs;
  return msgs.slice(-capped);
}

const MAX_HISTORY_CLIENT_MSGS = (() => {
  const raw = Number(process.env.CHAT_HISTORY_CLIENT_MSGS ?? 8000);
  if (!Number.isFinite(raw)) return 8000;
  return Math.max(200, Math.min(12000, Math.floor(raw)));
})();

/** Uma conversa para `conversation-delta` (escopo + CRM aplicado no caller). */
export async function socketConversationDeltaPayload(
  tenantUid: string,
  authUid: string,
  conv: Conversation,
  resolveConnectionOwner?: ConnectionOwnerResolver
): Promise<Conversation | null> {
  const scoped = conversationsPayloadForViewer(tenantUid, authUid, [conv], resolveConnectionOwner);
  if (scoped.length === 0) return null;
  const withPhones = await enrichConversationsWithCrmPhones(tenantUid, scoped);
  const withNames = await enrichConversationsWithCrmNames(tenantUid, withPhones);
  return prepareSingleConversationForSocketEmit(withNames[0]!);
}

/** Escopo tenant/staff + nomes CRM + payload enxuto para socket. */
export async function socketConversationsPayload(
  tenantUid: string,
  authUid: string,
  allConversations: Conversation[],
  resolveConnectionOwner?: ConnectionOwnerResolver
): Promise<Conversation[]> {
  const scoped = conversationsPayloadForViewer(
    tenantUid,
    authUid,
    allConversations,
    resolveConnectionOwner
  );
  const withPhones = await enrichConversationsWithCrmPhones(tenantUid, scoped);
  const withNames = await enrichConversationsWithCrmNames(tenantUid, withPhones);
  return prepareConversationsForSocketEmit(withNames);
}

/** Página da inbox (RAM) com escopo + CRM + payload enxuto. */
export async function socketInboxPagePayload(
  tenantUid: string,
  authUid: string,
  allConversations: Conversation[],
  resolveConnectionOwner?: ConnectionOwnerResolver,
  opts?: { cursor?: number | null; limit?: number; reset?: boolean }
): Promise<InboxPagePayload> {
  let scoped = conversationsPayloadForViewer(
    tenantUid,
    authUid,
    allConversations,
    resolveConnectionOwner
  );
  if (opts?.cursor == null && usePostgresChatArchive()) {
    try {
      const pgStubs = await listInboxThreadStubsPg(resolvePostgresTenantId(tenantUid), {
        limit: Math.min(200, (opts?.limit ?? INBOX_PAGE_SIZE_DEFAULT) * 3),
      });
      const ramIds = new Set(scoped.map((c) => c.id));
      for (const stub of pgStubs) {
        if (!ramIds.has(stub.id)) scoped.push(stub);
      }
    } catch {
      /* ignore */
    }
  }
  const sorted = sortConversationsByActivity(scoped);
  const page = sliceInboxPage(sorted, { cursor: opts?.cursor, limit: opts?.limit ?? INBOX_PAGE_SIZE_DEFAULT });
  const withPhones = await enrichConversationsWithCrmPhones(tenantUid, page.conversations);
  const withNames = await enrichConversationsWithCrmNames(tenantUid, withPhones);
  return {
    ...page,
    conversations: prepareConversationsForSocketEmit(withNames),
    reset: opts?.reset,
  };
}

/**
 * Lista de conversas que cada socket deve ver: escopo de chip + regras de inbox (staff).
 */
export function conversationsPayloadForViewer(
  tenantUid: string,
  authUid: string,
  allConversations: Conversation[],
  resolveConnectionOwner?: ConnectionOwnerResolver
): Conversation[] {
  const scoped = filterByConnectionScope(
    tenantUid,
    allConversations.map((c) => {
      const connectionOwnerUid = resolveConnectionOwner?.(c.connectionId);
      return {
        ...c,
        connectionId: c.connectionId,
        ownerUid: connectionOwnerUid,
        connectionOwnerUid
      };
    })
  ) as Conversation[];

  if (authUid !== tenantUid) {
    const filtered = applyInboxAssignmentFilter(tenantUid, authUid, scoped);
    return tagStaffOwnClaims(tenantUid, authUid, filtered) as Conversation[];
  }
  return enrichOwnerInboxClaims(tenantUid, scoped) as Conversation[];
}
