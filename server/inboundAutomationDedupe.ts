import { createHash } from 'crypto';
import { getSharedRedis } from './redisShared.js';

const DEDUPE_TTL_SEC = 14 * 24 * 3600;

export function inboundDoneRedisKey(dedupeKey: string): string {
  return `zapmass:inbound:done:${dedupeKey}`;
}

export function buildInboundAutomationDedupeKey(params: {
  connectionId: string;
  messageId?: string;
  phoneDigits: string;
  timestampMs: number;
  bodyText: string;
}): string {
  const mid = String(params.messageId || '').trim();
  if (mid) return `msg:${params.connectionId}:${mid}`;
  const body = String(params.bodyText || '').slice(0, 120);
  const hash = createHash('sha256')
    .update(`${params.connectionId}|${params.phoneDigits}|${params.timestampMs}|${body}`)
    .digest('hex')
    .slice(0, 24);
  return `replay:${params.connectionId}:${hash}`;
}

/** Mesma resposta no mesmo chip+número (webhook vs replay com IDs diferentes). */
export function buildInboundBodyDedupeKey(
  connectionId: string,
  phoneDigits: string,
  bodyText: string
): string | null {
  const phone = String(phoneDigits || '').replace(/\D/g, '');
  const body = String(bodyText || '').trim().toLowerCase();
  if (phone.length < 8 || !body) return null;
  const suffix = phone.slice(-8);
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  return `body:${connectionId}:${suffix}:${hash}`;
}

export async function isInboundAutomationProcessed(dedupeKey: string): Promise<boolean> {
  const redis = getSharedRedis();
  if (!redis || !dedupeKey) return false;
  try {
    const n = await redis.exists(inboundDoneRedisKey(dedupeKey));
    return n === 1;
  } catch {
    return false;
  }
}

/** true = esta instância ganhou o direito de processar. */
export async function tryClaimInboundAutomation(dedupeKey: string): Promise<boolean> {
  const redis = getSharedRedis();
  if (!redis || !dedupeKey) return true;
  try {
    const ok = await redis.set(inboundDoneRedisKey(dedupeKey), '1', 'EX', DEDUPE_TTL_SEC, 'NX');
    return ok === 'OK';
  } catch {
    return true;
  }
}

export async function markInboundAutomationProcessed(dedupeKey: string): Promise<void> {
  const redis = getSharedRedis();
  if (!redis || !dedupeKey) return;
  try {
    await redis.setex(inboundDoneRedisKey(dedupeKey), DEDUPE_TTL_SEC, '1');
  } catch {
    /* best-effort */
  }
}
