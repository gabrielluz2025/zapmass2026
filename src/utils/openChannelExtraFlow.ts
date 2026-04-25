/**
 * Navegação para a secção "Canais extras" em Minha assinatura (abrir o checkout/upgrade de slots).
 * Usa sessionStorage + evento global para a MainLayout trocar de aba e o MySubscriptionTab fazer scroll.
 */
export const CHANNEL_EXTRAS_SESSION_KEY = 'zapmass.scrollToChannelExtras';

export const EVENT_OPEN_CHANNEL_EXTRAS = 'zapmass:open-channel-extras' as const;

export function markScrollToChannelExtras(): void {
  try {
    sessionStorage.setItem(CHANNEL_EXTRAS_SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * Sinaliza que o utilizador quer adquirir canais além do teto actual (p.ex. 3.º canal).
 * O `App` (listener) assinala o scroll e muda a vista para "subscription".
 */
export function openChannelExtraPurchaseFlow(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_OPEN_CHANNEL_EXTRAS));
}

export function readAndClearChannelExtrasScrollFlag(): boolean {
  try {
    if (sessionStorage.getItem(CHANNEL_EXTRAS_SESSION_KEY) !== '1') return false;
    sessionStorage.removeItem(CHANNEL_EXTRAS_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}
