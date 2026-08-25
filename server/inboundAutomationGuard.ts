import { getSharedRedis } from './redisShared.js';
import { loadTenantSettings } from './tenantSettings.js';

export type InboundGuardResult =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterMs: number };

const RATE_LIMIT_WINDOW_SEC = 60;
const RATE_LIMIT_MAX = Number(process.env.INBOUND_AUTOMATION_MAX_PER_MIN ?? 12);

function lockActive(until?: string): boolean {
  if (!until) return false;
  const t = new Date(until).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function lockRetryMs(until?: string): number {
  if (!until) return 60_000;
  const t = new Date(until).getTime();
  return Math.max(5_000, t - Date.now());
}

/**
 * Bloqueia ou limita automações inbound (support bot, reply flow) durante cooldown pós-ban
 * ou instabilidade — evita que inbound burle isolamento do chip.
 */
export async function checkInboundAutomationAllowed(
  tenantId: string,
  scopeKey = 'global'
): Promise<InboundGuardResult> {
  const uid = String(tenantId || '').trim();
  if (!uid || uid === 'anonymous') return { allowed: true };

  const settings = await loadTenantSettings(uid);
  if (settings.chipProtectionPolicy === 'off') return { allowed: true };

  const lockReason = String(settings.chipProtectionLockReason || '').trim();
  if (lockActive(settings.chipProtectionLockUntil)) {
    if (lockReason === 'ban_cooldown') {
      return {
        allowed: false,
        reason: 'Automação inbound pausada: cooldown pós-banimento do workspace.',
        retryAfterMs: lockRetryMs(settings.chipProtectionLockUntil),
      };
    }
    if (lockReason === 'reconnect_storm') {
      return {
        allowed: false,
        reason: 'Automação inbound limitada: instabilidade recente nos chips.',
        retryAfterMs: Math.min(lockRetryMs(settings.chipProtectionLockUntil), 120_000),
      };
    }
  }

  const redis = getSharedRedis();
  if (!redis) return { allowed: true };

  const key = `inbound:rl:${uid}:${scopeKey}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SEC);
  }
  if (count > RATE_LIMIT_MAX) {
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      reason: 'Rate limit de automação inbound (proteção anti-ban).',
      retryAfterMs: Math.max(1000, ttl * 1000),
    };
  }

  return { allowed: true };
}
