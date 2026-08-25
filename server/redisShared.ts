import IORedis from 'ioredis';
import { getEffectiveRedisUrl } from './redisConfig.js';

let sharedRedis: IORedis | null = null;
let sharedRedisUrl: string | null = null;

/** Conexão Redis compartilhada para circuit breaker, throttle, etc. */
export function getSharedRedis(): IORedis | null {
  const url = getEffectiveRedisUrl();
  if (!url) return null;

  if (sharedRedis && sharedRedisUrl && sharedRedisUrl !== url) {
    try {
      sharedRedis.disconnect();
    } catch {
      /* ignore */
    }
    sharedRedis = null;
  }

  if (!sharedRedis) {
    sharedRedis = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    sharedRedisUrl = url;
  }

  if (sharedRedis.status === 'end' || sharedRedis.status === 'close') {
    sharedRedis = new IORedis(url, { maxRetriesPerRequest: null });
    sharedRedisUrl = url;
  }

  return sharedRedis;
}
