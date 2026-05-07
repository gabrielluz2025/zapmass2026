import toast from 'react-hot-toast';

/** Lido pelo `ChatTab` para selecionar a conversa assim que aparecer na lista. */
export const OPEN_CHAT_BY_CONVERSATION_ID_KEY = 'zapmass.openChatByConversationId';

export function openChatByConversationIdNavigate(
  navigateTo: (view: string) => void,
  conversationId: string
): void {
  const id = String(conversationId || '').trim();
  if (!id) {
    toast.error('Conversa inválida.');
    return;
  }
  try {
    sessionStorage.setItem(OPEN_CHAT_BY_CONVERSATION_ID_KEY, id);
  } catch {
    /* ignore */
  }
  navigateTo('chat');
}
