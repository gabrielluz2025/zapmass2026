import { getSharedRedis } from './redisShared.js';

export type PoolStrategy = 'weighted' | 'priority' | 'round_robin';

export type CampaignPoolConfig = {
  strategy: PoolStrategy;
  channelWeights: Record<string, number>;
  connectionIds: string[];
  poolId?: string;
  savedAt: number;
};

const POOL_KEY_PREFIX = 'campaign:pool:';
/** Alinhado ao TTL do runtime de campanha (24h). */
const POOL_TTL_SECS = 24 * 3600;

function poolKey(campaignId: string): string {
  return `${POOL_KEY_PREFIX}${String(campaignId || '').trim()}`;
}

export function resolvePoolStrategy(
  strategy: PoolStrategy | undefined,
  channelWeights: Record<string, number> | undefined
): PoolStrategy {
  if (strategy === 'weighted' || strategy === 'priority' || strategy === 'round_robin') {
    return strategy;
  }
  if (channelWeights && Object.keys(channelWeights).length > 0) return 'weighted';
  return 'round_robin';
}

export async function saveCampaignPoolConfig(
  campaignId: string,
  config: Omit<CampaignPoolConfig, 'savedAt'>
): Promise<void> {
  const redis = getSharedRedis();
  const cid = String(campaignId || '').trim();
  if (!redis || !cid) return;

  const payload: CampaignPoolConfig = {
    strategy: config.strategy,
    channelWeights: config.channelWeights || {},
    connectionIds: Array.isArray(config.connectionIds) ? config.connectionIds : [],
    poolId: config.poolId,
    savedAt: Date.now(),
  };

  await redis.setex(poolKey(cid), POOL_TTL_SECS, JSON.stringify(payload));
}

export async function loadCampaignPoolConfig(campaignId: string): Promise<CampaignPoolConfig | null> {
  const redis = getSharedRedis();
  const cid = String(campaignId || '').trim();
  if (!redis || !cid) return null;

  try {
    const raw = await redis.get(poolKey(cid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CampaignPoolConfig>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      strategy: resolvePoolStrategy(parsed.strategy, parsed.channelWeights),
      channelWeights:
        typeof parsed.channelWeights === 'object' && parsed.channelWeights !== null
          ? (parsed.channelWeights as Record<string, number>)
          : {},
      connectionIds: Array.isArray(parsed.connectionIds)
        ? parsed.connectionIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [],
      poolId: typeof parsed.poolId === 'string' ? parsed.poolId : undefined,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function deleteCampaignPoolConfig(campaignId: string): Promise<void> {
  const redis = getSharedRedis();
  const cid = String(campaignId || '').trim();
  if (!redis || !cid) return;
  await redis.del(poolKey(cid));
}
