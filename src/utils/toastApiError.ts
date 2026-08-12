import toast from 'react-hot-toast';
import { isApiNetworkError, isApiTimeoutError } from './apiFetchAuth';

export const API_OFFLINE_TOAST_ID = 'api-offline';

export const API_OFFLINE_TOAST_MESSAGE =
  'Servidor ocupado ou reiniciando. A página tenta de novo sozinha.';

const NETWORK_TOAST_RE =
  /Failed to fetch|Sem conexão com o servidor|Tempo esgotado ao (conectar|falar) com o servidor|NetworkError|Load failed|ERR_CONNECTION|ECONNRESET|Failed to load/i;

export function isOfflineToastMessage(message: unknown): boolean {
  if (typeof message === 'string') return NETWORK_TOAST_RE.test(message);
  if (message instanceof Error) return NETWORK_TOAST_RE.test(message.message);
  return false;
}

export function isTransientApiError(err: unknown): boolean {
  return isApiNetworkError(err) || isApiTimeoutError(err) || isOfflineToastMessage(err);
}

/** Um único toast para queda de rede — vários GET em paralelo não empilham vermelho. */
export function toastApiError(err: unknown, fallback: string): void {
  if (isTransientApiError(err)) {
    toast.error(API_OFFLINE_TOAST_MESSAGE, { id: API_OFFLINE_TOAST_ID, duration: 8000 });
    return;
  }
  const msg = err instanceof Error && err.message.trim() ? err.message : fallback;
  toast.error(msg || fallback);
}

export function dismissApiOfflineToast(): void {
  toast.dismiss(API_OFFLINE_TOAST_ID);
}

let guardInstalled = false;

/**
 * Qualquer `toast.error('Failed to fetch')` vira o aviso único.
 * Cobre telas antigas que ainda mostram a mensagem crua.
 */
export function installApiErrorToastGuard(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  const original = toast.error.bind(toast) as typeof toast.error;
  toast.error = ((message: unknown, opts?: Parameters<typeof toast.error>[1]) => {
    if (isOfflineToastMessage(message)) {
      return original(API_OFFLINE_TOAST_MESSAGE, {
        ...opts,
        id: API_OFFLINE_TOAST_ID,
        duration: opts?.duration ?? 8000
      });
    }
    return original(message as never, opts);
  }) as typeof toast.error;
}
