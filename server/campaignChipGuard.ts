import type { ChipProtectionPolicy } from '../shared/chipProtection.js';

export type CampaignProtectionReason =
  | 'all_channels_down'
  | 'ban_cooldown'
  | 'reconnect_storm'
  | 'chip_ban';

export type CampaignDispatchGuardResult =
  | { action: 'proceed' }
  | {
      action: 'pause';
      reason: CampaignProtectionReason;
      autoResumeAt?: number;
      message: string;
    }
  | {
      action: 'slow';
      reason: CampaignProtectionReason;
      extraDelayMs: number;
      message: string;
    };

const OFFLINE_RETRY_MS = 30 * 60 * 1000;
const STORM_SLOW_MS = 90_000;

function lockActive(until?: string): boolean {
  if (!until) return false;
  const t = new Date(until).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function lockUntilMs(until?: string): number | undefined {
  if (!until) return undefined;
  const t = new Date(until).getTime();
  return Number.isFinite(t) ? t : undefined;
}

export function campaignProtectionReasonLabel(reason: CampaignProtectionReason): string {
  switch (reason) {
    case 'all_channels_down':
      return 'Todos os chips indisponíveis';
    case 'ban_cooldown':
      return 'Cooldown pós-banimento';
    case 'reconnect_storm':
      return 'Instabilidade nos chips';
    case 'chip_ban':
      return 'Chip banido durante campanha';
    default:
      return 'Proteção de campanha';
  }
}

/** Avalia se uma campanha em execução deve pausar, desacelerar ou continuar. */
export async function evaluateCampaignDispatchGuard(params: {
  ownerUid: string;
  channelIds: string[];
  chipProtectionPolicy?: ChipProtectionPolicy;
  chipProtectionLockUntil?: string;
  chipProtectionLockReason?: string;
  isChannelUsable: (connectionId: string) => boolean;
}): Promise<CampaignDispatchGuardResult> {
  const policy = params.chipProtectionPolicy ?? 'auto';
  if (policy === 'off') return { action: 'proceed' };

  const ids = [...new Set(params.channelIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const usable = ids.filter((id) => params.isChannelUsable(id));

  const lockReason = String(params.chipProtectionLockReason || '').trim();
  const banLock = lockActive(params.chipProtectionLockUntil) && lockReason === 'ban_cooldown';
  const stormLock = lockActive(params.chipProtectionLockUntil) && lockReason === 'reconnect_storm';

  if (banLock) {
    return {
      action: 'pause',
      reason: 'ban_cooldown',
      autoResumeAt: lockUntilMs(params.chipProtectionLockUntil),
      message:
        'Campanha pausada automaticamente: banimento recente no WhatsApp. Jobs agendados para outro dia mantêm o horário. Retomada automática após o cooldown.',
    };
  }

  if (stormLock) {
    if (usable.length === 0) {
      return {
        action: 'pause',
        reason: 'reconnect_storm',
        autoResumeAt: lockUntilMs(params.chipProtectionLockUntil),
        message:
          'Campanha pausada: várias quedas seguidas e nenhum chip estável. Retomará quando o lock expirar ou os chips voltarem.',
      };
    }
    return {
      action: 'slow',
      reason: 'reconnect_storm',
      extraDelayMs: STORM_SLOW_MS,
      message: 'Envios desacelerados (+90s) por instabilidade recente nos chips.',
    };
  }

  if (usable.length === 0) {
    return {
      action: 'pause',
      reason: 'all_channels_down',
      autoResumeAt: Date.now() + OFFLINE_RETRY_MS,
      message:
        'Campanha pausada: nenhum chip online/disponível. Retomada automática em ~30 min ou no horário agendado de cada contato.',
    };
  }

  return { action: 'proceed' };
}

export function collectCampaignChannelIds(
  primaryId: string,
  alternateIds?: string[],
  runtimeIds?: string[]
): string[] {
  const set = new Set<string>();
  for (const id of [primaryId, ...(alternateIds || []), ...(runtimeIds || [])]) {
    const s = String(id || '').trim();
    if (s) set.add(s);
  }
  return [...set];
}

export { OFFLINE_RETRY_MS, STORM_SLOW_MS };
