import { filterByConnectionScope } from '../src/utils/connectionScope.js';
import {
  applyInboxAssignmentFilter,
  enrichOwnerInboxClaims,
  tagStaffOwnClaims
} from './inboxAssignments.js';
import type { Conversation } from './types.js';

/**
 * Lista de conversas que cada socket deve ver: escopo de chip + regras de inbox (staff).
 */
export function conversationsPayloadForViewer(
  tenantUid: string,
  authUid: string,
  allConversations: Conversation[]
): Conversation[] {
  const scoped = filterByConnectionScope(
    tenantUid,
    allConversations.map((c) => ({ ...c, connectionId: c.connectionId }))
  ) as Conversation[];

  if (authUid !== tenantUid) {
    const filtered = applyInboxAssignmentFilter(tenantUid, authUid, scoped);
    return tagStaffOwnClaims(tenantUid, authUid, filtered) as Conversation[];
  }
  return enrichOwnerInboxClaims(tenantUid, scoped) as Conversation[];
}
