/** Classificação de assinatura para MRR / painel Ganhos (admin). */

export type SubscriptionBillingKind =
  | 'mercadopago'
  | 'manual_paid'
  | 'manual_bonus'
  | 'trial'
  | 'blocked'
  | 'none'
  | 'other';

export type ManualGrantKind = 'bonus' | 'paid_external';

export interface SubscriptionDocLike {
  status?: string;
  blocked?: boolean;
  manualGrant?: boolean;
  provider?: string;
  plan?: string | null;
  mercadoPagoPreapprovalId?: string;
  mercadoPagoChannelAddonPreapprovalId?: string;
  manualExtraChannelSlots?: number;
  manualGrantKind?: string;
  adminNote?: string;
}

const PAID_NOTE_RE =
  /\b(cobrad|pago|pix|transfer|boleto|cart[aã]o|externo|faturad|recibo|dinheiro)\b/i;
const BONUS_NOTE_RE =
  /\b(cortesia|gr[aá]tis|gratuito|bonus|bônus|degust|parceiro|teste|amostra|promo)\b/i;

function normStatus(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'none';
  return raw.trim().toLowerCase();
}

function normProvider(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'none';
  return raw.trim().toLowerCase();
}

export function resolveManualGrantKind(doc: SubscriptionDocLike): ManualGrantKind {
  const k = String(doc.manualGrantKind || '').trim().toLowerCase();
  if (k === 'paid_external' || k === 'paid') return 'paid_external';
  if (k === 'bonus' || k === 'cortesia') return 'bonus';
  const note = typeof doc.adminNote === 'string' ? doc.adminNote : '';
  if (PAID_NOTE_RE.test(note)) return 'paid_external';
  if (BONUS_NOTE_RE.test(note)) return 'bonus';
  return 'bonus';
}

export function hasMercadoPagoSubscription(doc: SubscriptionDocLike): boolean {
  if (doc.manualGrant === true) return false;
  if (normStatus(doc.status) !== 'active') return false;
  if (normProvider(doc.provider) !== 'mercadopago') return false;
  return Boolean(String(doc.mercadoPagoPreapprovalId || '').trim());
}

export function classifySubscriptionBilling(
  doc: SubscriptionDocLike | null | undefined
): SubscriptionBillingKind {
  if (!doc) return 'none';
  if (doc.blocked === true) return 'blocked';
  const status = normStatus(doc.status);
  if (status === 'trialing') return 'trial';
  if (hasMercadoPagoSubscription(doc)) return 'mercadopago';
  if (doc.manualGrant === true) {
    return resolveManualGrantKind(doc) === 'paid_external' ? 'manual_paid' : 'manual_bonus';
  }
  if (status === 'none' || status === '') return 'none';
  if (status === 'active') return 'other';
  return 'other';
}

export function planForMrrEstimate(doc: SubscriptionDocLike): 'monthly' | 'annual' | null {
  const p = typeof doc.plan === 'string' ? doc.plan.trim().toLowerCase() : '';
  if (p === 'monthly' || p === 'annual') return p;
  return null;
}

/** Slots de canal que entram no MRR pago (Mercado Pago). */
export function paidChannelAddonSlots(doc: SubscriptionDocLike): number {
  const mpId = String(doc.mercadoPagoChannelAddonPreapprovalId || '').trim();
  if (!mpId) return 0;
  return 1;
}

/** Slots manuais (cortesia) — referência de valor, não receita MP. */
export function courtesyChannelAddonSlots(doc: SubscriptionDocLike): number {
  const n = Math.floor(Number(doc.manualExtraChannelSlots) || 0);
  if (n <= 0) return 0;
  return Math.min(3, Math.max(0, n));
}

export function billingKindLabelPt(kind: SubscriptionBillingKind): string {
  switch (kind) {
    case 'mercadopago':
      return 'Mercado Pago';
    case 'manual_paid':
      return 'Manual cobrado';
    case 'manual_bonus':
      return 'Bônus';
    case 'trial':
      return 'Trial';
    case 'blocked':
      return 'Bloqueado';
    case 'none':
      return 'Sem plano';
    default:
      return 'Outro';
  }
}
