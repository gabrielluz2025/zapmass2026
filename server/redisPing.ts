import IORedis from 'ioredis';
import { getRedisUrlCandidates } from './redisConfig.js';

type RedisPingOptions = {
  connectTimeout?: number;
  commandTimeout?: number;
  maxRetriesPerRequest?: number;
};

export type RedisPingResult = {
  ok: boolean;
  pingMs?: number;
  error?: string;
  /** URL que respondeu ao PONG (pode diferir de REDIS_URL no .env). */
  usedUrl?: string;
};

/** Ping rápido para health checks (abre conexão dedicada e fecha no fim). */
export async function redisPing(
  redisUrl: string,
  opts?: RedisPingOptions
): Promise<RedisPingResult> {
  const t0 = Date.now();
  let client: IORedis | null = null;
  try {
    client = new IORedis(redisUrl, {
      maxRetriesPerRequest: opts?.maxRetriesPerRequest ?? 1,
      connectTimeout: opts?.connectTimeout ?? 5000,
      commandTimeout: opts?.commandTimeout ?? 5000,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times <= 2 ? Math.min(times * 300, 900) : null),
    });
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') {
      return { ok: false, error: `Resposta inesperada: ${String(pong)}` };
    }
    return { ok: true, pingMs: Date.now() - t0, usedUrl: redisUrl };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      usedUrl: redisUrl,
    };
  } finally {
    if (!client) return;
    try {
      if (client.status !== 'end') {
        await client.quit();
      }
    } catch {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Tenta REDIS_URL e fallbacks conhecidos (Compose/Swarm) até obter PONG. */
export async function redisPingWithFallback(
  primaryUrl?: string | null,
  opts?: RedisPingOptions
): Promise<RedisPingResult> {
  const candidates = getRedisUrlCandidates(primaryUrl);
  let last: RedisPingResult = { ok: false, error: 'Nenhuma URL Redis configurada.' };
  for (const url of candidates) {
    const ping = await redisPing(url, opts);
    if (ping.ok) {
      const { setResolvedRedisUrl } = await import('./redisConfig.js');
      setResolvedRedisUrl(ping.usedUrl || url);
      return ping;
    }
    last = ping;
  }
  return last;
}
