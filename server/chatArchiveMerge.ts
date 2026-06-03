import {
  isWaChatArchiveEnabled,
  loadChatArchiveMessages,
  threadIdFromConversationId
} from './chatArchiveStore.js';
import type { ChatMessage, Conversation } from './types.js';

export type ChatArchiveMergeHooks = {
  getConversations: () => Conversation[];
  upsertConversation: (conv: Conversation, opts?: { skipArchive?: boolean }) => void;
  allowDeletedConversation: (conversationId: string) => void;
  emitConversationDelta: (conversationId: string) => void;
  resolveConnectionOwnerUid: (connectionId: string) => string | undefined;
  ownerUidFromConnectionId: (connectionId: string) => string | undefined;
  maxMessages: number;
};

export async function mergeChatArchiveIntoConversation(
  conversationId: string,
  historyLimit: number,
  hooks: ChatArchiveMergeHooks
): Promise<void> {
  if (!isWaChatArchiveEnabled()) return;
  const [connectionId, ...chatParts] = conversationId.split(':');
  if (!connectionId || chatParts.length === 0) return;
  const jid = chatParts.join(':');
  const ownerUid =
    hooks.resolveConnectionOwnerUid(connectionId) || hooks.ownerUidFromConnectionId(connectionId);
  if (!ownerUid) return;
  const digitsOnly = jid.split('@')[0]?.replace(/\D/g, '') || '';
  const cpGuess = digitsOnly.length >= 10 ? `+${digitsOnly}` : '';
  const threadId = threadIdFromConversationId(conversationId, cpGuess);
  if (!threadId) return;

  const archived = await loadChatArchiveMessages(
    ownerUid,
    threadId,
    Math.max(80, Math.min(historyLimit, 1500))
  );
  if (archived.length === 0) return;

  const conversations = hooks.getConversations();
  let conv = conversations.find((c) => c.id === conversationId);
  if (!conv) {
    hooks.allowDeletedConversation(conversationId);
    const last = archived[archived.length - 1];
    const contactPhone =
      cpGuess || (threadId.startsWith('p_') ? `+${threadId.slice(2)}` : '') || '';
    const stub: Conversation = {
      id: conversationId,
      contactName:
        (contactPhone.replace(/\D/g, '') || jid.replace(/@.*/, '') || 'Contato').slice(0, 120),
      contactPhone,
      connectionId,
      unreadCount: 0,
      lastMessage: last?.text || '',
      lastMessageTime: last?.timestamp || '',
      lastMessageTimestamp: last?.timestampMs,
      messages: archived.slice(-hooks.maxMessages),
      tags: ['Arquivo']
    };
    hooks.upsertConversation(stub, { skipArchive: true });
    hooks.emitConversationDelta(conversationId);
    return;
  }

  const byId = new Map<string, ChatMessage>();
  for (const m of archived) {
    byId.set(m.id, m);
  }
  for (const m of conv.messages) {
    const existing = byId.get(m.id);
    if (!existing) {
      byId.set(m.id, m);
    } else {
      if (m.fromCampaign) existing.fromCampaign = true;
      if (m.campaignId) existing.campaignId = m.campaignId;
      if (m.mediaUrl && !existing.mediaUrl) existing.mediaUrl = m.mediaUrl;
    }
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)
  );
  const lastM = merged[merged.length - 1];
  const nextConv: Conversation = {
    ...conv,
    messages: merged.slice(-hooks.maxMessages),
    lastMessage: lastM?.text ?? conv.lastMessage,
    lastMessageTime: lastM?.timestamp ?? conv.lastMessageTime,
    lastMessageTimestamp: lastM?.timestampMs ?? conv.lastMessageTimestamp
  };
  hooks.upsertConversation(nextConv, { skipArchive: true });
  hooks.emitConversationDelta(conversationId);
}

export async function hydrateChatArchiveForConversation(
  conversationId: string,
  historyLimit: number,
  hooks: ChatArchiveMergeHooks
): Promise<{ ok: boolean; total: number; error?: string }> {
  try {
    await mergeChatArchiveIntoConversation(conversationId, historyLimit, hooks);
    const conv = hooks.getConversations().find((c) => c.id === conversationId);
    return { ok: true, total: conv?.messages?.length ?? 0 };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      total: hooks.getConversations().find((c) => c.id === conversationId)?.messages?.length ?? 0,
      error: msg
    };
  }
}
