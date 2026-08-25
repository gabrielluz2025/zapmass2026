import { createHash } from 'node:crypto';
import { getSharedRedis } from './redisShared.js';

const KEY_PREFIX = 'msg:hash:';
const WINDOW_SEC = 5 * 60;
const DEFAULT_THRESHOLD = 10;
const DEFAULT_PENALTY_MS = 45_000;

export type ContentHashLockResult = {
  hash: string;
  count: number;
  threshold: number;
  /** true quando count > threshold — aplicar penalidade ou falhar. */
  overLimit: boolean;
  penaltyMs: number;
};

function hashKey(tenantId: string, md5: string): string {
  return `${KEY_PREFIX}${String(tenantId || '').trim()}:${md5}`;
}

/** Normaliza texto para hash estável (ignora caixa e espaços extras). */
export function normalizeMessageForContentHash(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function md5MessageContent(text: string): string {
  const normalized = normalizeMessageForContentHash(text);
  return createHash('md5').update(normalized, 'utf8').digest('hex');
}

function readThreshold(): number {
  const n = Number(process.env.CONTENT_HASH_LOCK_THRESHOLD ?? DEFAULT_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_THRESHOLD;
}

function readPenaltyMs(): number {
  const n = Number(process.env.CONTENT_HASH_LOCK_PENALTY_MS ?? DEFAULT_PENALTY_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_PENALTY_MS;
}

/**
 * Incrementa contador Redis da hash (TTL 5 min) e retorna se excedeu o limite.
 * Mensagens vazias ou só mídia devem ser ignoradas pelo caller.
 */
export async function trackContentHashLock(
  tenantId: string,
  messageText: string
): Promise<ContentHashLockResult | null> {
  const tid = String(tenantId || '').trim();
  const normalized = normalizeMessageForContentHash(messageText);
  if (!tid || normalized.length < 8) return null;

  const md5 = createHash('md5').update(normalized, 'utf8').digest('hex');
  const threshold = readThreshold();
  const penaltyMs = readPenaltyMs();

  const redis = getSharedRedis();
  if (!redis) {
    return { hash: md5, count: 1, threshold, overLimit: false, penaltyMs };
  }

  const key = hashKey(tid, md5);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SEC);
  }

  return {
    hash: md5,
    count,
    threshold,
    overLimit: count > threshold,
    penaltyMs,
  };
}
