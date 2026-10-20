export const EVENT_SUBSCRIPTION_REQUIRED = 'zapmass:subscription-required' as const;

export const DEFAULT_SUBSCRIPTION_REQUIRED_MSG =
  'Plano ativo ou teste válido é necessário. Abra Minha assinatura para assinar o ZapMass Pro e liberar o uso.';

export type SubscriptionRequiredDetail = { message?: string };

export class SubscriptionRequiredError extends Error {
  readonly code = 'SUBSCRIPTION_REQUIRED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionRequiredError';
  }
}

export function isSubscriptionRequiredError(err: unknown): err is SubscriptionRequiredError {
  return err instanceof SubscriptionRequiredError;
}

export function formatSubscriptionRequiredMessage(message?: string): string {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  return trimmed || DEFAULT_SUBSCRIPTION_REQUIRED_MSG;
}

export function isSubscriptionRequiredHttpPayload(
  status: number,
  body: unknown
): body is { code: 'SUBSCRIPTION_REQUIRED'; error?: string } {
  if (status !== 402 || !body || typeof body !== 'object') return false;
  return (body as { code?: string }).code === 'SUBSCRIPTION_REQUIRED';
}

/** Mesmo sinal do socket `subscription-required` — App abre o modal Pro. */
export function emitSubscriptionRequired(message?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<SubscriptionRequiredDetail>(EVENT_SUBSCRIPTION_REQUIRED, {
      detail: { message: formatSubscriptionRequiredMessage(message) },
    })
  );
}
