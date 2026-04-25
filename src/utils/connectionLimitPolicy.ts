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

function statusAllowsPaidExtras(sub: UserSubscription | null): boolean {
  if (!sub) return false;
  if (sub.manualGrant === true) return true;
  return sub.status === 'active' || sub.status === 'trialing';
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
  const raw = Math.max(
    0,
    Math.min(MAX_EXTRA_CHANNEL_SLOTS, Math.floor(Number(subscription?.extraChannelSlots) || 0))
  );
  const effective =
    statusAllowsPaidExtras(subscription) && hasChannelAddonPurchaseProof(subscription) ? raw : 0;
  return Math.min(MAX_CHANNELS_TOTAL, BASE_CHANNEL_SLOTS + effective);
}

/**
 * Alinhado ao servidor: mesma regra de visibilidade que `filterByConnectionScope`.
 */
export function countAccountScopedConnections(connections: Array<{ id: string }>, userId: string | null | undefined): number {
  if (!userId) return 0;
  return filterByConnectionScope(userId, connections).length;
}
