import IORedis from 'ioredis';
import { createHash } from 'crypto';

const memoryCache = new Map<string, { answer: string; expiresAt: number }>();
const memoryUsage = new Map<string, { count: number; dayKey: string }>();

let redis: IORedis | null = null;

function getRedis(): IORedis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!redis) {
    redis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true
    });
    redis.connect().catch(() => {
      /* memória */
    });
  }
  return redis;
}

function dayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyLimit(): number {
  const n = Number(process.env.ASSISTANT_DAILY_LIMIT ?? 20);
  return Number.isFinite(n) ? Math.min(200, Math.max(1, Math.floor(n))) : 20;
}

function cacheTtlSec(): number {
  const h = Number(process.env.ASSISTANT_CACHE_HOURS ?? 24);
  const hours = Number.isFinite(h) ? Math.min(168, Math.max(1, h)) : 24;
  return hours * 3600;
}

function usageKey(tenantId: string, actorId: string): string {
  return `zapmass:assistant:usage:${tenantId}:${actorId}:${dayKeyUtc()}`;
}

function cacheKey(tenantId: string, questionKey: string): string {
  const hash = createHash('sha256').update(questionKey).digest('hex').slice(0, 32);
  return `zapmass:assistant:cache:${tenantId}:${hash}`;
}

export async function getRemainingQuota(tenantId: string, actorId: string): Promise<number> {
  const limit = dailyLimit();
  const memKey = `${tenantId}:${actorId}`;
  const dk = dayKeyUtc();
  const mem = memoryUsage.get(memKey);
  if (mem && mem.dayKey === dk) return Math.max(0, limit - mem.count);

  const client = getRedis();
  if (client) {
    try {
      const raw = await client.get(usageKey(tenantId, actorId));
      const used = raw != null ? Number(raw) : 0;
      return Math.max(0, limit - (Number.isFinite(used) ? used : 0));
    } catch {
      /* fallback */
    }
  }
  return limit;
}

export async function consumeQuota(
  tenantId: string,
  actorId: string
): Promise<{ ok: true; remaining: number } | { ok: false; remaining: 0 }> {
  const limit = dailyLimit();
  const remainingBefore = await getRemainingQuota(tenantId, actorId);
  if (remainingBefore <= 0) return { ok: false, remaining: 0 };

  const memKey = `${tenantId}:${actorId}`;
  const dk = dayKeyUtc();
  const mem = memoryUsage.get(memKey);
  const nextCount = mem && mem.dayKey === dk ? mem.count + 1 : 1;
  memoryUsage.set(memKey, { count: nextCount, dayKey: dk });

  const client = getRedis();
  if (client) {
    try {
      const key = usageKey(tenantId, actorId);
      const n = await client.incr(key);
      if (n === 1) await client.expire(key, 86400 * 2);
    } catch {
      /* memória já incrementada */
    }
  }

  return { ok: true, remaining: Math.max(0, limit - nextCount) };
}

export async function getCachedAnswer(tenantId: string, questionKey: string): Promise<string | null> {
  const ck = cacheKey(tenantId, questionKey);
  const mem = memoryCache.get(ck);
  if (mem && mem.expiresAt > Date.now()) return mem.answer;

  const client = getRedis();
  if (client) {
    try {
      const raw = await client.get(ck);
      if (raw) return raw;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function setCachedAnswer(tenantId: string, questionKey: string, answer: string): Promise<void> {
  const ck = cacheKey(tenantId, questionKey);
  const ttl = cacheTtlSec();
  memoryCache.set(ck, { answer, expiresAt: Date.now() + ttl * 1000 });

  const client = getRedis();
  if (client) {
    try {
      await client.setex(ck, ttl, answer);
    } catch {
      /* ignore */
    }
  }
}

export function getAssistantConfig(isPlatformAdmin = false) {
  const hasKeys = !!(process.env.GEMINI_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim());
  const llmAllowed =
    isPlatformAdmin && hasKeys && process.env.ASSISTANT_LLM_ENABLED !== 'false';
  return {
    dailyLimit: dailyLimit(),
    llmEnabled: llmAllowed,
    provider: llmAllowed
      ? process.env.GROQ_API_KEY?.trim()
        ? 'groq'
        : 'gemini'
      : 'none'
  };
}
