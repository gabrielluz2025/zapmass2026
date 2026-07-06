import IORedis from 'ioredis';

export type RedisMemoryInfo = {
  ok: boolean;
  usedMemoryBytes?: number;
  maxMemoryBytes?: number;
  usedMemoryHuman?: string;
  maxMemoryHuman?: string;
  usedPct?: number;
  warnThresholdMb: number;
  warn: boolean;
  error?: string;
};

function parseInfoLong(info: string, key: string): number | undefined {
  const match = info.match(new RegExp(`^${key}:(\\d+)`, 'm'));
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

function parseInfoString(info: string, key: string): string | undefined {
  const match = info.match(new RegExp(`^${key}:([^\\r\\n]+)`, 'm'));
  return match?.[1]?.trim() || undefined;
}

/** Lê uso de memória do Redis (INFO memory) — conexão efêmera. */
export async function redisMemoryInfo(redisUrl: string): Promise<RedisMemoryInfo> {
  const warnThresholdMb = Math.max(
    100,
    parseInt(process.env.REDIS_MEMORY_WARN_MB || '850', 10)
  );
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
    const info = await client.info('memory');
    const usedMemoryBytes = parseInfoLong(info, 'used_memory');
    const maxMemoryBytes = parseInfoLong(info, 'maxmemory');
    const usedMemoryHuman = parseInfoString(info, 'used_memory_human');
    const maxMemoryHuman = parseInfoString(info, 'maxmemory_human');
    const usedMb =
      usedMemoryBytes != null ? usedMemoryBytes / (1024 * 1024) : undefined;
    const usedPct =
      usedMemoryBytes != null && maxMemoryBytes != null && maxMemoryBytes > 0
        ? Math.round((usedMemoryBytes / maxMemoryBytes) * 1000) / 10
        : undefined;
    const warn = usedMb != null ? usedMb >= warnThresholdMb : false;
    return {
      ok: true,
      usedMemoryBytes,
      maxMemoryBytes,
      usedMemoryHuman,
      maxMemoryHuman,
      usedPct,
      warnThresholdMb,
      warn,
    };
  } catch (e) {
    return {
      ok: false,
      warnThresholdMb,
      warn: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    if (!client) return;
    try {
      if (client.status !== 'end') await client.quit();
    } catch {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}
