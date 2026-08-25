/** Perfil de sync da inbox — normal vs modo proteção (chip quieto). */
export type ChipSyncProfile = {
  fullHistory: boolean;
  fullInboxSync: boolean;
  msgPrefetch: number;
  sparseConvLimit: number;
  prefetchBatchSize: number;
};

export const CHIP_SYNC_PROFILE_NORMAL: ChipSyncProfile = {
  fullHistory: true,
  fullInboxSync: true,
  msgPrefetch: 200,
  sparseConvLimit: 120,
  prefetchBatchSize: 8,
};

/** Sync leve: só lista conversas + poucas mensagens recentes. */
export const CHIP_SYNC_PROFILE_QUIET: ChipSyncProfile = {
  fullHistory: false,
  fullInboxSync: false,
  msgPrefetch: 25,
  sparseConvLimit: 12,
  prefetchBatchSize: 3,
};

/** Limites globais conservadores quando variáveis de ambiente não estão definidas. */
export function envChipSyncProfileNormal(): ChipSyncProfile {
  const fullOff = ['0', 'false', 'no', 'off'].includes(
    String(process.env.WA_FULL_INBOX_SYNC ?? '1').trim().toLowerCase()
  );
  const histRaw = process.env.EVOLUTION_SYNC_FULL_HISTORY;
  const fullHistory =
    histRaw != null && String(histRaw).trim() !== ''
      ? !['0', 'false', 'no', 'off'].includes(String(histRaw).trim().toLowerCase())
      : !fullOff;
  const prefetch = Number(process.env.EVOLUTION_SYNC_MSG_PREFETCH ?? 200);
  const sparse = Number(process.env.EVOLUTION_SYNC_SPARSE_CONV_LIMIT ?? 120);
  return {
    fullHistory,
    fullInboxSync: !fullOff,
    msgPrefetch: Number.isFinite(prefetch) ? Math.max(50, Math.min(500, prefetch)) : 200,
    sparseConvLimit: Number.isFinite(sparse) ? Math.max(10, Math.min(300, sparse)) : 120,
    prefetchBatchSize: fullOff ? 4 : 8,
  };
}

export function mergeSyncProfile(base: ChipSyncProfile, quiet: boolean): ChipSyncProfile {
  if (!quiet) return base;
  return {
    ...CHIP_SYNC_PROFILE_QUIET,
    // Respeita env se ainda mais conservador
    msgPrefetch: Math.min(base.msgPrefetch, CHIP_SYNC_PROFILE_QUIET.msgPrefetch),
    sparseConvLimit: Math.min(base.sparseConvLimit, CHIP_SYNC_PROFILE_QUIET.sparseConvLimit),
  };
}
