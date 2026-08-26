import { createHash } from 'crypto';
import { getSharedRedis } from './redisShared.js';

const DEDUPE_TTL_SEC = 14 * 24 * 3600;

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

export async function isInboundAutomationProcessed(dedupeKey: string): Promise<boolean> {
  const redis = getSharedRedis();
  if (!redis || !dedupeKey) return false;
  try {
    const n = await redis.exists(`zapmass:inbound:done:${dedupeKey}`);
    return n === 1;
  } catch {
    return false;
  }
}

export async function markInboundAutomationProcessed(dedupeKey: string): Promise<void> {
  const redis = getSharedRedis();
  if (!redis || !dedupeKey) return;
  try {
    await redis.setex(`zapmass:inbound:done:${dedupeKey}`, DEDUPE_TTL_SEC, '1');
  } catch {
    /* best-effort */
  }
}
