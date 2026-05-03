import toast from 'react-hot-toast';

/** Grava o handshake lido por `ChatTab` e navega para o Pipeline. */
export function openChatNavigate(setCurrentView: (view: string) => void, phone: string, name: string): void {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) {
    toast.error('Telefone inválido para abrir o pipeline.');
    return;
  }
  try {
    sessionStorage.setItem(
      'zapmass.openChatByPhone',
      JSON.stringify({ phone: digits, name: (name || '').trim(), profilePicUrl: '' })
    );
  } catch {
    /* ignore */
  }
  setCurrentView('chat');
}
