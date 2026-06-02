import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import {
  appendChatArchiveMessagesFirestore,
  isWaChatArchiveEnabled,
  loadChatArchiveMessagesFirestore,
  threadIdFromConversationId
} from './chatArchiveFirestore.js';
import {
  appendChatArchiveMessagesPg,
  loadChatArchiveMessagesPg
} from './repositories/chatArchiveRepository.js';
import type { ChatMessage } from './types.js';

export { isWaChatArchiveEnabled, threadIdFromConversationId };

export function usePostgresChatArchive(): boolean {
  return vpsDataEnabled() && !!getZapmassPool();
}

export async function appendChatArchiveMessages(
  ownerUid: string,
  threadId: string,
  meta: { contactName: string; contactPhone: string; connectionId: string },
  messages: ChatMessage[]
): Promise<void> {
  if (!isWaChatArchiveEnabled() || !ownerUid || !threadId || messages.length === 0) return;
  if (usePostgresChatArchive()) {
    return appendChatArchiveMessagesPg(ownerUid, threadId, meta, messages);
  }
  return appendChatArchiveMessagesFirestore(ownerUid, threadId, meta, messages);
}

export async function loadChatArchiveMessages(
  ownerUid: string,
  threadId: string,
  limit: number = 500
): Promise<ChatMessage[]> {
  if (!isWaChatArchiveEnabled() || !ownerUid || !threadId) return [];
  if (usePostgresChatArchive()) {
    return loadChatArchiveMessagesPg(ownerUid, threadId, limit);
  }
  return loadChatArchiveMessagesFirestore(ownerUid, threadId, limit);
}
