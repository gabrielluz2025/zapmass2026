import type { UserSubscriptionDoc } from './subscriptionStore.js';

/** Quantos ids de pagamento MP guardar no doc da assinatura (tamanho do JSONB limitado). */
export const MP_PROCESSED_PAYMENT_IDS_MAX = 30;

type SubLike = Pick<
  UserSubscriptionDoc,
  | 'mercadoPagoLastPaymentId'
  | 'mercadoPagoProcessedPaymentIds'
  | 'mercadoPagoPreapprovalActivatedId'
  | 'mercadoPagoPreapprovalBridgePending'
  | 'mercadoPagoPreapprovalId'
> | null | undefined;

/**
 * O Mercado Pago envia várias notificações por pagamento (`created`, `updated`, reentregas).
 * Sem esta checagem cada uma estendia o acesso novamente (1 pagamento = N meses).
 */
export function isPaymentAlreadyProcessed(sub: SubLike, paymentId: string): boolean {
  const id = String(paymentId || '').trim();
  if (!id || !sub) return false;
  if (String(sub.mercadoPagoLastPaymentId || '').trim() === id) return true;
  const list = sub.mercadoPagoProcessedPaymentIds;
  return Array.isArray(list) && list.some((x) => String(x) === id);
}

export function withProcessedPaymentId(sub: SubLike, paymentId: string): string[] {
  const id = String(paymentId || '').trim();
  const prev = Array.isArray(sub?.mercadoPagoProcessedPaymentIds)
    ? sub!.mercadoPagoProcessedPaymentIds!.map(String)
    : [];
  if (!id) return prev;
  const next = prev.filter((x) => x !== id);
  next.push(id);
  return next.slice(-MP_PROCESSED_PAYMENT_IDS_MAX);
}

/**
 * `preapproval` com status `authorized` é reenviado a cada atualização da assinatura.
 * Só a primeira autorização concede o ciclo inicial; as seguintes são ignoradas.
 */
export function isPreapprovalAlreadyActivated(sub: SubLike, preapprovalId: string): boolean {
  const id = String(preapprovalId || '').trim();
  if (!id || !sub) return false;
  return String(sub.mercadoPagoPreapprovalActivatedId || '').trim() === id;
}

/**
 * Autorização do débito já concedeu o primeiro ciclo; o primeiro pagamento aprovado depois dela
 * apenas é registado (senão o cliente ganharia 2 períodos pelo mesmo pagamento).
 */
export function shouldConsumePreapprovalBridge(sub: SubLike): boolean {
  return sub?.mercadoPagoPreapprovalBridgePending === true;
}

/**
 * Serializa o processamento por tenant dentro do mesmo processo (webhooks simultâneos do mesmo pagamento).
 * Não protege entre réplicas — a idempotência persistida cobre reentregas sequenciais.
 */
const tails = new Map<string, Promise<unknown>>();

export async function withTenantLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
