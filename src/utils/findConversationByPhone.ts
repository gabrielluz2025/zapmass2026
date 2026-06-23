import type { Conversation } from '../types';

export function phonesMatchDigits(a: string, b: string): boolean {
  const cd = (a || '').replace(/\D/g, '');
  const digits = (b || '').replace(/\D/g, '');
  if (!cd || !digits) return false;
  return (
    cd === digits ||
    cd.endsWith(digits) ||
    digits.endsWith(cd) ||
    (cd.length >= 10 && digits.length >= 10 && cd.slice(-10) === digits.slice(-10))
  );
}

/** Todas as conversas com o mesmo telefone. */
export function findConversationsForPhone(
  conversations: Conversation[],
  phoneDigits: string
): Conversation[] {
  const digits = (phoneDigits || '').replace(/\D/g, '');
  if (!digits) return [];
  return conversations
    .filter((c) => phonesMatchDigits((c.contactPhone || '').replace(/\D/g, ''), digits))
    .sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0));
}

/** Conversa mais recente com o mesmo telefone (útil ao abrir chat a partir da agenda). */
export function findBestConversationForPhone(
  conversations: Conversation[],
  phoneDigits: string
): Conversation | undefined {
  return findConversationsForPhone(conversations, phoneDigits)[0];
}

/** Conversa de um telefone em um canal específico. */
export function findConversationForPhoneOnChannel(
  conversations: Conversation[],
  phoneDigits: string,
  connectionId: string
): Conversation | undefined {
  const cid = (connectionId || '').trim();
  if (!cid) return undefined;
  return findConversationsForPhone(conversations, phoneDigits).find((c) => c.connectionId === cid);
}
