/** Política de sync da inbox (servidor → UI via socket `inbox-sync-policy`). */

export type InboxSyncBlockReason = 'campaign' | 'warmup' | 'none';

export type InboxSyncPolicyPayload = {
  phoneFullBlocked: boolean;
  blockReason: InboxSyncBlockReason;
  /** Sync pesado do celular (Go) enfileirado — roda sozinho quando liberar. */
  pendingPhoneFull: boolean;
  /** Segundos até tentativa automática da fila (0 = imediato ou idle). */
  nextAutoAttemptSec: number;
  updatedAt: number;
};

export function defaultInboxSyncPolicy(): InboxSyncPolicyPayload {
  return {
    phoneFullBlocked: false,
    blockReason: 'none',
    pendingPhoneFull: false,
    nextAutoAttemptSec: 0,
    updatedAt: Date.now(),
  };
}
