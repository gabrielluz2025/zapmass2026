import type { Conversation } from '../../../types';
import type { ChatInboxPrefsState, InboxSmartTab } from '../../../utils/chatInboxPrefs';
import {
  isConversationArchived,
  isConversationSnoozed,
} from '../../../utils/chatInboxPrefs';
import { unreadCount } from './conversationDisplay';
import type { ClientCrmData } from '../../chat/useClientCrm';

export function conversationHasCampaignMessages(conv: Conversation): boolean {
  return (conv.messages || []).some((m) => m.fromCampaign) || conv.tags?.includes('Campanha');
}

export function conversationIsHot(crm: ClientCrmData | undefined): boolean {
  const status = crm?.status;
  return status === 'lead' || crm?.tags?.includes('quente') || crm?.tags?.includes('hot');
}

export function filterConversationsBySmartTab(
  list: Conversation[],
  tab: InboxSmartTab,
  prefs: ChatInboxPrefsState,
  crmByConvId: (id: string) => ClientCrmData | undefined,
  now = Date.now()
): Conversation[] {
  return list.filter((c) => {
    const archived = isConversationArchived(prefs, c.id);
    const snoozed = isConversationSnoozed(prefs, c.id, now);

    if (tab === 'archived') return archived;
    if (archived && tab !== 'all') return false;
    if (snoozed && tab !== 'snoozed' && tab !== 'all') return false;
    if (tab === 'snoozed') return snoozed;

    switch (tab) {
      case 'unread':
        return unreadCount(c) > 0;
      case 'hot':
        return conversationIsHot(crmByConvId(c.id));
      case 'campaign':
        return conversationHasCampaignMessages(c);
      case 'team':
        return Boolean(c.inboxClaimedByAuthUid);
      default:
        return !snoozed;
    }
  });
}

export function sortInboxWithPins(
  list: Conversation[],
  pinnedIds: string[]
): Conversation[] {
  const pinSet = new Set(pinnedIds);
  return [...list].sort((a, b) => {
    const ap = pinSet.has(a.id) ? 1 : 0;
    const bp = pinSet.has(b.id) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
  });
}
