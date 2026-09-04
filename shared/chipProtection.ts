/** Perfil de sync da inbox — normal vs modo proteção (chip quieto). */
export type ChipSyncProfile = {
  fullHistory: boolean;
  fullInboxSync: boolean;
  msgPrefetch: number;
  sparseConvLimit: number;
  prefetchBatchSize: number;
};

/** auto = protege quando não há campanha; always = sempre; off = desligado. */
export type ChipProtectionPolicy = 'auto' | 'always' | 'off';

export type ChipProtectionReason =
  | 'policy_always'
  | 'policy_auto_idle'
  | 'ban_cooldown'
  | 'reconnect_storm'
  | 'manual_legacy';

export const CHIP_SYNC_PROFILE_NORMAL: ChipSyncProfile = {
  fullHistory: true,
  fullInboxSync: true,
  msgPrefetch: 200,
  sparseConvLimit: 120,
  prefetchBatchSize: 8,
};

/** Sync leve quando proteção ativa (sem campanha). */
export const CHIP_SYNC_PROFILE_QUIET: ChipSyncProfile = {
  fullHistory: false,
  fullInboxSync: false,
  msgPrefetch: 25,
  sparseConvLimit: 12,
  prefetchBatchSize: 3,
};

/** Sync mínimo após ban ou instabilidade — menor stress possível. */
export const CHIP_SYNC_PROFILE_STRICT: ChipSyncProfile = {
  fullHistory: false,
  fullInboxSync: false,
  msgPrefetch: 15,
  sparseConvLimit: 8,
  prefetchBatchSize: 2,
};

export function defaultChipProtectionPolicy(): ChipProtectionPolicy {
  const raw = String(process.env.ZAPMASS_CHIP_PROTECTION_DEFAULT ?? 'auto').trim().toLowerCase();
  if (raw === 'off' || raw === 'always') return raw;
  return 'auto';
}

export function chipProtectionReasonLabel(reason: ChipProtectionReason | null): string {
  switch (reason) {
    case 'policy_always':
      return 'Política: sempre protegido';
    case 'policy_auto_idle':
      return 'Automático: sem campanha ativa';
    case 'ban_cooldown':
      return 'Cooldown pós-banimento (48h)';
    case 'reconnect_storm':
      return 'Instabilidade: várias quedas seguidas';
    case 'manual_legacy':
      return 'Modo quieto manual (legado)';
    default:
      return 'Proteção desligada';
  }
}

/** Limites globais quando variáveis de ambiente não estão definidas. */
export function envChipSyncProfileNormal(): ChipSyncProfile {
  const fullOff = ['0', 'false', 'no', 'off'].includes(
    String(process.env.WA_FULL_INBOX_SYNC ?? '1').trim().toLowerCase()
  );
  const histRaw = process.env.EVOLUTION_SYNC_FULL_HISTORY;
  const fullHistory =
    histRaw != null && String(histRaw).trim() !== ''
      ? !['0', 'false', 'no', 'off'].includes(String(histRaw).trim().toLowerCase())
      : true;
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
    msgPrefetch: Math.min(base.msgPrefetch, CHIP_SYNC_PROFILE_QUIET.msgPrefetch),
    sparseConvLimit: Math.min(base.sparseConvLimit, CHIP_SYNC_PROFILE_QUIET.sparseConvLimit),
  };
}

export function strictSyncProfile(base: ChipSyncProfile): ChipSyncProfile {
  return {
    ...CHIP_SYNC_PROFILE_STRICT,
    msgPrefetch: Math.min(base.msgPrefetch, CHIP_SYNC_PROFILE_STRICT.msgPrefetch),
    sparseConvLimit: Math.min(base.sparseConvLimit, CHIP_SYNC_PROFILE_STRICT.sparseConvLimit),
  };
}
