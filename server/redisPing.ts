import IORedis from 'ioredis';

/** Ping rápido para health checks (abre conexão dedicada e fecha no fim). */
export async function redisPing(redisUrl: string): Promise<{ ok: boolean; pingMs?: number; error?: string }> {
  const t0 = Date.now();
  let client: IORedis | null = null;
  try {
    client = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 5000,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times <= 2 ? Math.min(times * 300, 900) : null),
    });
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') {
      return { ok: false, error: `Resposta inesperada: ${String(pong)}` };
    }
    return { ok: true, pingMs: Date.now() - t0 };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
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
