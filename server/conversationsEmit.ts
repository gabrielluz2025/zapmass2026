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
