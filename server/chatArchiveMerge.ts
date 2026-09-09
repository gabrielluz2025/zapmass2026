import { createHash } from 'node:crypto';
import {
  isWaChatArchiveEnabled,
  loadChatArchiveMessages,
  threadIdFromConversationId
} from './chatArchiveStore.js';
import type { ChatMessage, Conversation } from './types.js';

function collectArchiveThreadIds(
  conversationId: string,
  convMeta: Conversation | undefined,
  cpGuess: string
): string[] {
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    const t = String(id || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const connectionId = conversationId.includes(':')
    ? conversationId.slice(0, conversationId.indexOf(':'))
    : '';
  const jid = conversationId.includes(':') ? conversationId.slice(conversationId.indexOf(':') + 1) : '';

  add(threadIdFromConversationId(conversationId, cpGuess ? `+${cpGuess}` : ''));
  if (cpGuess) add(`p_${cpGuess}`);
  if (jid.toLowerCase().endsWith('@lid')) {
    const h = createHash('sha256').update(jid).digest('hex');
    add(`lid_${h.slice(0, 24)}`);
  }
  const altRaw = String(convMeta?.waJidAlt || '').trim();
  if (altRaw.includes('@') && connectionId) {
    add(threadIdFromConversationId(`${connectionId}:${altRaw}`));
    if (altRaw.toLowerCase().endsWith('@lid')) {
      const h = createHash('sha256').update(altRaw).digest('hex');
      add(`lid_${h.slice(0, 24)}`);
    }
  }
  return out;
}

async function loadArchivedMessagesWithFallbacks(
  ownerUid: string,
  conversationId: string,
  convMeta: Conversation | undefined,
  cpGuess: string,
  historyLimit: number
): Promise<ChatMessage[]> {
  const limit = Math.max(80, Math.min(historyLimit, 1500));
  for (const threadId of collectArchiveThreadIds(conversationId, convMeta, cpGuess)) {
    const archived = await loadChatArchiveMessages(ownerUid, threadId, limit);
    if (archived.length > 0) return archived;
  }
  return [];
}

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
  const convMeta = hooks.getConversations().find((c) => c.id === conversationId);
  const altRaw = String(convMeta?.waJidAlt || '').trim();
  const altPhone =
    altRaw && !altRaw.toLowerCase().endsWith('@lid')
      ? altRaw.split('@')[0]?.replace(/\D/g, '') || ''
      : '';
  const cpDigits = String(convMeta?.contactPhone || '').replace(/\D/g, '');
  const cpGuess =
    (cpDigits.length >= 10 && cpDigits.length <= 13 ? cpDigits : '') ||
    (altPhone.length >= 10 && altPhone.length <= 13 ? altPhone : '') ||
    (jid.toLowerCase().endsWith('@lid') ? '' : jid.split('@')[0]?.replace(/\D/g, '') || '');
  const archived = await loadArchivedMessagesWithFallbacks(
    ownerUid,
    conversationId,
    convMeta,
    cpGuess,
    historyLimit
  );
  if (archived.length === 0) return;

  const threadId =
    threadIdFromConversationId(conversationId, cpGuess ? `+${cpGuess}` : '') ||
    collectArchiveThreadIds(conversationId, convMeta, cpGuess)[0] ||
    '';

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
