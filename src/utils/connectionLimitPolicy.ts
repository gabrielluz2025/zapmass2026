import type { UserSubscription } from '../types';
import { isLegacyConnectionId } from './connectionScope';

export const BASE_CHANNEL_SLOTS = 2;
export const MAX_EXTRA_CHANNEL_SLOTS = 3;
export const MAX_CHANNELS_TOTAL = 5;
/** Teto lógico no app para o criador (o servidor aplica 999; aqui basta &gt; 5). */
const ADMIN_PRACTICAL_MAX = 99;

/**
 * Teto de canais para o app (2 base + `extraChannelSlots` pagos, máx. 5).
 * Contas de administrador (lista ADMIN no servidor) vêem teto alto na UI.
 */
export function getMaxConnectionSlotsForUser(
  subscription: UserSubscription | null,
  isAdminUser: boolean
): number {
  if (isAdminUser) return ADMIN_PRACTICAL_MAX;
  const n = Math.max(
    0,
    Math.min(MAX_EXTRA_CHANNEL_SLOTS, Math.floor(Number(subscription?.extraChannelSlots) || 0))
  );
  return Math.min(MAX_CHANNELS_TOTAL, BASE_CHANNEL_SLOTS + n);
}

/**
 * Só conexões com id `uid__…` (isolamento) contam. Canais legados (sem `__`) não entram.
 */
export function countAccountScopedConnections(connections: Array<{ id: string }>, userId: string | null | undefined): number {
  if (!userId) return 0;
  if (userId === 'anonymous') {
    return connections.filter((c) => isLegacyConnectionId(c.id)).length;
  }
  return connections.filter((c) => typeof c.id === 'string' && c.id.startsWith(`${userId}__`)).length;
}
