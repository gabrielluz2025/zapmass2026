import type { CircuitHealthScore, CircuitState } from './chipCircuitBreaker.js';
import { getChipCircuitBreaker } from './chipCircuitBreaker.js';
import {
  loadCampaignPoolConfig,
  resolvePoolStrategy,
  type CampaignPoolConfig,
  type PoolStrategy,
} from './campaignPoolRedis.js';
import { pickWeightedChannel } from './replyFlowEngine.js';

export type HealthyChannel = {
  connectionId: string;
  circuitState: CircuitState;
  effectiveWeight: number;
};

const HALF_OPEN_WEIGHT_PENALTY = 0.5;

export function baseChannelWeight(
  connectionId: string,
  channelWeights: Record<string, number> | undefined
): number {
  const raw = Number(channelWeights?.[connectionId]);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.min(999, Math.round(raw)));
}

export function applyCircuitWeightPenalty(weight: number, circuitState: CircuitState): number {
  if (circuitState === 'HALF_OPEN') return Math.max(1, weight * HALF_OPEN_WEIGHT_PENALTY);
  return weight;
}

export function buildEffectiveWeights(
  connectionIds: string[],
  channelWeights: Record<string, number> | undefined,
  circuitById: Map<string, CircuitState>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of connectionIds) {
    const state = circuitById.get(id) || 'CLOSED';
    const base = baseChannelWeight(id, channelWeights);
    out[id] = applyCircuitWeightPenalty(base, state);
  }
  return out;
}

export function pickPoolChannelByStrategy(params: {
  strategy: PoolStrategy;
  healthyIds: string[];
  channelWeights: Record<string, number>;
  index: number;
  excludeId?: string;
}): string | null {
  const exclude = String(params.excludeId || '').trim();
  let candidates = params.healthyIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (exclude) {
    const filtered = candidates.filter((id) => id !== exclude);
    if (filtered.length > 0) candidates = filtered;
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const strategy = params.strategy;
  if (strategy === 'priority') return candidates[0];

  if (strategy === 'weighted') {
    const weights: Record<string, number> = {};
    for (const id of candidates) {
      weights[id] = Math.max(1, Math.round(Number(params.channelWeights[id]) || 1));
    }
    return pickWeightedChannel(candidates, weights, Math.max(0, params.index));
  }

  const idx = Math.max(0, params.index) % candidates.length;
  return candidates[idx];
}

/** Seleção síncrona na fila inicial (chips já filtrados como open). */
export function pickInitialDispatchChannel(params: {
  strategy: PoolStrategy;
  connectionIds: string[];
  channelWeights: Record<string, number>;
  index: number;
}): string {
  const ids = params.connectionIds.filter(Boolean);
  if (ids.length === 0) return '';
  return (
    pickPoolChannelByStrategy({
      strategy: params.strategy,
      healthyIds: ids,
      channelWeights: params.channelWeights,
      index: params.index,
    }) || ids[0]
  );
}

export async function collectHealthyChannels(
  connectionIds: string[],
  channelWeights: Record<string, number> | undefined,
  isChannelUsable: (connectionId: string) => boolean
): Promise<HealthyChannel[]> {
  const cb = getChipCircuitBreaker();
  const unique = Array.from(new Set(connectionIds.map((id) => String(id || '').trim()).filter(Boolean)));
  const out: HealthyChannel[] = [];

  for (const connectionId of unique) {
    if (!isChannelUsable(connectionId)) continue;
    const score: CircuitHealthScore = await cb.getHealthScore(connectionId);
    if (!cb.isUsable(score)) continue;
    const base = baseChannelWeight(connectionId, channelWeights);
    out.push({
      connectionId,
      circuitState: score.state,
      effectiveWeight: applyCircuitWeightPenalty(base, score.state),
    });
  }

  return out;
}

function weightsFromHealthy(channels: HealthyChannel[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ch of channels) out[ch.connectionId] = ch.effectiveWeight;
  return out;
}

export async function pickDispatchChannel(params: {
  campaignId?: string;
  currentId: string;
  alternateIds?: string[];
  rotationIndex?: number;
  preferCurrent?: boolean;
  isChannelUsable: (connectionId: string) => boolean;
  poolOverride?: CampaignPoolConfig | null;
}): Promise<string | null> {
  const current = String(params.currentId || '').trim();
  const pool =
    params.poolOverride !== undefined
      ? params.poolOverride
      : params.campaignId
        ? await loadCampaignPoolConfig(params.campaignId)
        : null;

  const orderedIds = pool?.connectionIds?.length
    ? pool.connectionIds
    : Array.from(
        new Set([current, ...(params.alternateIds || [])].map((id) => String(id || '').trim()).filter(Boolean))
      );

  const strategy = resolvePoolStrategy(pool?.strategy, pool?.channelWeights);
  const channelWeights = pool?.channelWeights || {};

  const healthy = await collectHealthyChannels(orderedIds, channelWeights, params.isChannelUsable);
  if (healthy.length === 0) return null;

  const healthyIds = healthy.map((h) => h.connectionId);
  const effectiveWeights = weightsFromHealthy(healthy);

  if (params.preferCurrent !== false && current && healthyIds.includes(current)) {
    return current;
  }

  return pickPoolChannelByStrategy({
    strategy,
    healthyIds,
    channelWeights: effectiveWeights,
    index: params.rotationIndex ?? 0,
    excludeId: current,
  });
}
