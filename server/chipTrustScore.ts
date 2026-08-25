export type ChipTier = '0A' | '0B' | 1 | 2;

export type ChipTierProfile = {
  tier: ChipTier;
  label: string;
  /** Multiplicador sobre o delay base entre mensagens. */
  delayMultiplier: number;
  /** Teto sugerido de mensagens/dia (0 = sem teto extra do tier). */
  suggestedDailyCap: number;
  ageDays: number;
};

const DAY_MS = 86_400_000;

const TIER_CONFIG: Record<
  ChipTier,
  { label: string; delayMultiplier: number; suggestedDailyCap: number; minDays: number; maxDays: number | null }
> = {
  '0A': { label: 'Crítico (0–2d)', delayMultiplier: 5, suggestedDailyCap: 20, minDays: 0, maxDays: 2 },
  '0B': { label: 'Novo (3–7d)', delayMultiplier: 3, suggestedDailyCap: 80, minDays: 3, maxDays: 7 },
  1: { label: 'Aquecimento (8–21d)', delayMultiplier: 1.8, suggestedDailyCap: 250, minDays: 8, maxDays: 21 },
  2: { label: 'Estabelecido (>21d)', delayMultiplier: 1, suggestedDailyCap: 0, minDays: 22, maxDays: null },
};

/** Resolve tier pela idade do chip (connectedSince em epoch ms). */
export function resolveChipTier(connectedSinceMs: number | undefined, nowMs = Date.now()): ChipTierProfile {
  const since = Number(connectedSinceMs);
  if (!Number.isFinite(since) || since <= 0) {
    return profileForTier('0A', 0);
  }
  const ageDays = Math.max(0, Math.floor((nowMs - since) / DAY_MS));
  if (ageDays <= 2) return profileForTier('0A', ageDays);
  if (ageDays <= 7) return profileForTier('0B', ageDays);
  if (ageDays <= 21) return profileForTier(1, ageDays);
  return profileForTier(2, ageDays);
}

function profileForTier(tier: ChipTier, ageDays: number): ChipTierProfile {
  const cfg = TIER_CONFIG[tier];
  return {
    tier,
    label: cfg.label,
    delayMultiplier: cfg.delayMultiplier,
    suggestedDailyCap: cfg.suggestedDailyCap,
    ageDays,
  };
}

/** Delay dinâmico = base × multiplicador do tier (mínimo base). */
export function computeTierAdjustedDelay(baseDelayMs: number, profile: ChipTierProfile): number {
  const base = Math.max(1000, Math.floor(baseDelayMs));
  return Math.floor(base * profile.delayMultiplier);
}

/** Delay extra a aplicar quando o job já está pronto (tier > 0). */
export function computeTierExtraDelayMs(baseDelayMs: number, profile: ChipTierProfile): number {
  const adjusted = computeTierAdjustedDelay(baseDelayMs, profile);
  return Math.max(0, adjusted - baseDelayMs);
}

/** Verifica se o chip atingiu o cap sugerido do tier no dia corrente. */
export function isTierDailyCapReached(messagesSentToday: number, profile: ChipTierProfile): boolean {
  if (profile.suggestedDailyCap <= 0) return false;
  return Math.max(0, messagesSentToday) >= profile.suggestedDailyCap;
}
