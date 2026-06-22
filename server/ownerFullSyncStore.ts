import IORedis from 'ioredis';
import { fullSyncIntervalMs, isFullSyncDue } from '../shared/dailyFullSync.js';

const memory = new Map<string, number>();
let redis: IORedis | null = null;

function redisKey(uid: string): string {
  return `zapmass:owner-full-sync:${uid}`;
}

function getRedis(): IORedis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!redis) {
    redis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    redis.connect().catch(() => {
      /* fallback memória */
    });
  }
  return redis;
}

export async function getOwnerLastFullSyncMs(ownerUid: string): Promise<number> {
  const uid = String(ownerUid || '').trim();
  if (!uid) return 0;
  const cached = memory.get(uid);
  if (cached) return cached;
  const client = getRedis();
  if (!client) return 0;
  try {
    const raw = await client.get(redisKey(uid));
    const n = raw != null ? Number(raw) : 0;
    if (Number.isFinite(n) && n > 0) {
      memory.set(uid, n);
      return n;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

export async function markOwnerFullSyncDone(ownerUid: string, atMs = Date.now()): Promise<void> {
  const uid = String(ownerUid || '').trim();
  if (!uid) return;
  memory.set(uid, atMs);
  const client = getRedis();
  if (!client) return;
  try {
    const ttlSec = Math.ceil((fullSyncIntervalMs() * 2) / 1000);
    await client.set(redisKey(uid), String(atMs), 'EX', Math.max(ttlSec, 86_400));
  } catch {
    /* ignore */
  }
}

export async function ownerFullSyncIsDue(ownerUid: string, force?: boolean): Promise<boolean> {
  if (force) return true;
  const last = await getOwnerLastFullSyncMs(ownerUid);
  return isFullSyncDue(last);
}
