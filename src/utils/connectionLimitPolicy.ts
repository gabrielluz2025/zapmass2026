import type { UserSubscription } from '../types';
import { filterByConnectionScope } from './connectionScope';

export const BASE_CHANNEL_SLOTS = 2;
export const MAX_EXTRA_CHANNEL_SLOTS = 3;
export const MAX_CHANNELS_TOTAL = 5;
/** Teto lógico no app para o criador (o servidor aplica 999; aqui basta &gt; 5). */
const ADMIN_PRACTICAL_MAX = 99;

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function hasChannelAddonPurchaseProof(sub: UserSubscription | null): boolean {
  if (!sub) return false;
  if (sub.manualGrant === true) return true;
  if (nonEmptyString(sub.mercadoPagoChannelAddonPreapprovalId)) return true;
  if (nonEmptyString(sub.mercadoPagoChannelAddonOneTimePaymentId)) return true;
  return false;
}

/** Alinhado a SubscriptionContext / servidor: trialing com trial expirado = false. */
function statusAllowsPaidExtras(sub: UserSubscription | null): boolean {
  if (!sub) return false;
  if (sub.blocked === true) return false;
  const now = Date.now();
  const manualEnd = toMs(sub.manualAccessEndsAt);
  if (sub.manualGrant === true) {
    if (manualEnd == null) return true;
    return now < manualEnd;
  }
  const trialEnd = toMs(sub.trialEndsAt);
  const accessEnd = toMs(sub.accessEndsAt);
  if (sub.status === 'active') {
    if (accessEnd == null) return true;
    return now < accessEnd;
  }
  if (sub.status === 'trialing' && trialEnd != null) {
    return now < trialEnd;
  }
  return false;
}

function toMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (v as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  if (typeof (v as { seconds?: unknown }).seconds === 'number') {
    const sec = Number((v as { seconds: number }).seconds);
    return Number.isFinite(sec) ? sec * 1000 : null;
  }
  if (typeof v === 'string') {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function manualGrantedExtraSlots(sub: UserSubscription | null): number {
  if (!sub) return 0;
  const raw = Math.max(
    0,
    Math.min(MAX_EXTRA_CHANNEL_SLOTS, Math.floor(Number(sub.manualExtraChannelSlots) || 0))
  );
  if (raw <= 0) return 0;
  const endMs = toMs(sub.manualExtraChannelSlotsEndsAt);
  if (endMs == null) return raw;
  return endMs > Date.now() ? raw : 0;
}

function paidIncludedChannels(sub: UserSubscription | null): number {
  const n = Math.floor(Number(sub?.includedChannels) || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.min(MAX_CHANNELS_TOTAL, n));
}

/**
 * Teto de canais para o app (2 base + `extraChannelSlots` pagos, máx. 5).
 * Contas de administrador (lista ADMIN no servidor) vêem teto alto na UI.
 * Extras exigem prova de add-on (igual ao servidor) — nunca só o numero no Firestore.
 */
export function getMaxConnectionSlotsForUser(
  subscription: UserSubscription | null,
  isAdminUser: boolean
): number {
  if (isAdminUser) return ADMIN_PRACTICAL_MAX;
  const included = paidIncludedChannels(subscription);
  if (included > 0 && statusAllowsPaidExtras(subscription)) {
    return Math.min(MAX_CHANNELS_TOTAL, included + manualGrantedExtraSlots(subscription));
  }
  const raw = Math.max(
    0,
    Math.min(MAX_EXTRA_CHANNEL_SLOTS, Math.floor(Number(subscription?.extraChannelSlots) || 0))
  );
  const paidExtras =
    statusAllowsPaidExtras(subscription) && hasChannelAddonPurchaseProof(subscription) ? raw : 0;
  const effective = Math.max(paidExtras, manualGrantedExtraSlots(subscription));
  return Math.min(MAX_CHANNELS_TOTAL, BASE_CHANNEL_SLOTS + effective);
}

/**
 * Alinhado ao servidor: mesma regra de visibilidade que `filterByConnectionScope`.
 */
export function countAccountScopedConnections(connections: Array<{ id: string }>, userId: string | null | undefined): number {
  if (!userId) return 0;
  return filterByConnectionScope(userId, connections).length;
}
