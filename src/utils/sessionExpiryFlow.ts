/** Mensagem padrão quando a sessão realmente expirou (logout necessário). */
export const SESSION_EXPIRED_MESSAGE = 'Sessão expirada. Entre novamente.';

export const GLOBAL_SESSION_TOAST_ID = 'global-session-expired';

const SESSION_MSG_RE = /sessão expirada/i;

export function isSessionExpiredMessage(message: unknown): boolean {
  if (typeof message === 'string') return SESSION_MSG_RE.test(message);
  if (message instanceof Error) return SESSION_MSG_RE.test(message.message);
  return false;
}

/** Evita toast de sessão enquanto o boot/refresh inicial ainda está em curso. */
let authBootstrapInFlight = 0;

export function beginAuthSessionBootstrap(): void {
  authBootstrapInFlight += 1;
}

export function endAuthSessionBootstrap(): void {
  authBootstrapInFlight = Math.max(0, authBootstrapInFlight - 1);
}

export function isAuthSessionBootstrapActive(): boolean {
  return authBootstrapInFlight > 0;
}

export class ApiForbiddenError extends Error {
  readonly httpStatus = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ApiForbiddenError';
  }
}
