import toast from 'react-hot-toast';
import { isApiHttpTransientError, isApiNetworkError, isApiTimeoutError } from './apiFetchAuth';

export const API_OFFLINE_TOAST_ID = 'api-offline';

export const API_OFFLINE_TOAST_MESSAGE =
  'Servidor ocupado ou reiniciando. A página tenta de novo sozinha.';

/** Só mostra o aviso se a falha continuar este tempo — um GET falho com o painel ONLINE não assusta. */
export const API_OFFLINE_TOAST_DELAY_MS = 6_000;

const NETWORK_TOAST_RE =
  /Failed to fetch|Sem conexão com o servidor|Tempo esgotado ao (conectar|falar) com o servidor|NetworkError|Load failed|ERR_CONNECTION|ECONNRESET|Failed to load|Erro HTTP 50[234]|Conexão perdida com o servidor|Servidor ocupado ou reiniciando|Bad Gateway|Service Unavailable|Gateway Timeout/i;

const GO_UUID_TOAST_RE = /invalid UUID/i;

const GO_UUID_TOAST_MESSAGE =
  'O Evolution não reconheceu o identificador deste canal. Atualize a página; se o chip estiver Online, o disparo continua valendo.';

export function isOfflineToastMessage(message: unknown): boolean {
  if (typeof message === 'string') return NETWORK_TOAST_RE.test(message);
  if (message instanceof Error) return NETWORK_TOAST_RE.test(message.message);
  return false;
}

export function isTransientApiError(err: unknown): boolean {
  return (
    isApiNetworkError(err) ||
    isApiTimeoutError(err) ||
    isApiHttpTransientError(err) ||
    isOfflineToastMessage(err)
  );
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** Agenda o aviso único; cancela se a API voltar antes. */
export function scheduleApiOfflineToast(): void {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    toast.error(API_OFFLINE_TOAST_MESSAGE, { id: API_OFFLINE_TOAST_ID, duration: 8_000 });
  }, API_OFFLINE_TOAST_DELAY_MS);
}

export function dismissApiOfflineToast(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  toast.dismiss(API_OFFLINE_TOAST_ID);
}

/** Um único toast para queda de rede — vários GET em paralelo não empilham vermelho. */
export function toastApiError(err: unknown, fallback: string): void {
  if (isTransientApiError(err)) {
    scheduleApiOfflineToast();
    return;
  }
  const msg = err instanceof Error && err.message.trim() ? err.message : fallback;
  toast.error(msg || fallback);
}

let guardInstalled = false;

/**
 * Qualquer `toast.error('Failed to fetch')` vira o aviso único (com atraso).
 * Cobre telas antigas que ainda mostram a mensagem crua.
 */
export function installApiErrorToastGuard(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  const original = toast.error.bind(toast) as typeof toast.error;
  toast.error = ((message: unknown, opts?: Parameters<typeof toast.error>[1]) => {
    if (isOfflineToastMessage(message)) {
      scheduleApiOfflineToast();
      return API_OFFLINE_TOAST_ID;
    }
    const text =
      typeof message === 'string' ? message : message instanceof Error ? message.message : '';
    if (text && GO_UUID_TOAST_RE.test(text)) {
      return original(GO_UUID_TOAST_MESSAGE, { ...opts, id: opts?.id || 'go-invalid-uuid' });
    }
    return original(message as never, opts);
  }) as typeof toast.error;
}
