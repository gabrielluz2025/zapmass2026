import { filterByConnectionScope } from '../src/utils/connectionScope.js';
import {
  applyInboxAssignmentFilter,
  enrichOwnerInboxClaims,
  tagStaffOwnClaims
} from './inboxAssignments.js';
import type { Conversation } from './types.js';

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
