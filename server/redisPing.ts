import IORedis from 'ioredis';

/** Ping rápido para health checks (fecha ligação no fim). */
export async function redisPing(redisUrl: string): Promise<{ ok: boolean; pingMs?: number; error?: string }> {
  const t0 = Date.now();
  const client = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 4000,
    retryStrategy: () => null
  });
  try {
    await client.ping();
    return { ok: true, pingMs: Date.now() - t0 };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    };
  } finally {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
}
