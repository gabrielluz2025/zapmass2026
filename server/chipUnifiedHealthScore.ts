import type { CircuitHealthScore, CircuitState } from './chipCircuitBreaker.js';
import { getChipCircuitBreaker } from './chipCircuitBreaker.js';
import { resolveChipTier } from './chipTrustScore.js';
import { getSharedRedis } from './redisShared.js';
import type { ProxyHealthStatus } from './proxyHealthMonitor.js';

export type UnifiedHealthBand = 'excellent' | 'good' | 'caution' | 'critical';

export type UnifiedHealthComponents = {
  maturity: number;
  circuit: number;
  bidirectional: number;
  infra: number;
};

export type UnifiedChipHealth = {
  score: number;
  band: UnifiedHealthBand;
  delayMultiplier: number;
  poolWeightMultiplier: number;
  usable: boolean;
  components: UnifiedHealthComponents;
  circuitState: CircuitState;
  labels: string[];
};

export type UnifiedHealthInput = {
  connectedSinceMs?: number | null;
  circuit: CircuitHealthScore;
  inboundWindow?: number;
  sentWindow?: number;
  proxyStatus?: ProxyHealthStatus | null;
  hasProxy?: boolean;
  inQuarantine?: boolean;
  banCount?: number;
  reconnectStormCount?: number;
  reconnectStormThreshold?: number;
};

const WEIGHTS = {
  maturity: 0.4,
  circuit: 0.3,
  bidirectional: 0.2,
  infra: 0.1,
} as const;

const INBOUND_KEY_PREFIX = 'chip:health:inbound:';
const INBOUND_WINDOW_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 30_000;

const unifiedHealthCache = new Map<string, { health: UnifiedChipHealth; at: number }>();

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolveBand(score: number): UnifiedHealthBand {
  if (score >= 80) return 'excellent';
  if (score >= 50) return 'good';
  if (score >= 30) return 'caution';
  return 'critical';
}

/** Sub-score 0–100 pela idade/maturidade do chip (chipTrustScore). */
export function computeMaturityScore(connectedSinceMs?: number | null, nowMs = Date.now()): number {
  const profile = resolveChipTier(connectedSinceMs ?? undefined, nowMs);
  switch (profile.tier) {
    case '0A':
      return clampScore(20 + profile.ageDays * 7);
    case '0B':
      return clampScore(42 + (profile.ageDays - 3) * 4);
    case 1:
      return clampScore(58 + (profile.ageDays - 8) * 1.6);
    case 2:
      return clampScore(Math.min(100, 82 + (profile.ageDays - 22) * 0.6));
    default:
      return 25;
  }
}

/** Sub-score 0–100 a partir do circuit breaker Redis. */
export function computeCircuitScore(circuit: CircuitHealthScore): number {
  if (circuit.state === 'OPEN') return 0;
  if (circuit.state === 'HALF_OPEN') return 38;
  if (circuit.state === 'THROTTLED') return 52;

  const delivery = clampScore(circuit.deliveryRatio * 100);
  const reliability = clampScore((1 - circuit.failRate) * 100);
  const sampleBoost = circuit.sent + circuit.failures >= 8 ? 0 : 8;
  return clampScore(delivery * 0.65 + reliability * 0.35 + sampleBoost);
}

/** Sub-score 0–100 — respostas inbound vs envios na janela. */
export function computeBidirectionalScore(
  sentWindow: number,
  inboundWindow: number
): number {
  const sent = Math.max(0, sentWindow);
  const inbound = Math.max(0, inboundWindow);
  if (sent === 0 && inbound === 0) return 72;
  if (sent === 0) return Math.min(100, 60 + inbound * 5);
  const ratio = inbound / sent;
  if (ratio >= 0.5) return 100;
  if (ratio >= 0.2) return clampScore(55 + ratio * 120);
  if (ratio >= 0.05) return clampScore(35 + ratio * 200);
  return clampScore(20 + ratio * 300);
}

/** Sub-score 0–100 — proxy, quarentena e instabilidade de rede. */
export function computeInfraScore(params: {
  proxyStatus?: ProxyHealthStatus | null;
  hasProxy?: boolean;
  inQuarantine?: boolean;
  banCount?: number;
  reconnectStormCount?: number;
  reconnectStormThreshold?: number;
}): number {
  if (params.inQuarantine) return 5;
  if ((params.banCount ?? 0) >= 2) return 15;
  if ((params.banCount ?? 0) >= 1) return 35;

  let score = 88;
  const status = params.proxyStatus;
  if (status === 'PROXY_DOWN') score = 0;
  else if (status === 'DATACENTER') score = 55;
  else if (status === 'DRIFT') score = 62;
  else if (status === 'OK') score = 100;
  else if (params.hasProxy) score = 75;
  else score = 70;

  const threshold = params.reconnectStormThreshold ?? 3;
  const stormCount = params.reconnectStormCount ?? 0;
  if (stormCount >= threshold) score = Math.min(score, 20);
  else if (stormCount >= threshold - 1) score = Math.min(score, 45);

  return clampScore(score);
}

export function composeUnifiedHealth(input: UnifiedHealthInput): UnifiedChipHealth {
  const maturity = computeMaturityScore(input.connectedSinceMs);
  const circuit = computeCircuitScore(input.circuit);
  const bidirectional = computeBidirectionalScore(
    input.sentWindow ?? input.circuit.sent,
    input.inboundWindow ?? 0
  );
  const infra = computeInfraScore({
    proxyStatus: input.proxyStatus,
    hasProxy: input.hasProxy,
    inQuarantine: input.inQuarantine,
    banCount: input.banCount,
    reconnectStormCount: input.reconnectStormCount,
    reconnectStormThreshold: input.reconnectStormThreshold,
  });

  let score = clampScore(
    maturity * WEIGHTS.maturity +
      circuit * WEIGHTS.circuit +
      bidirectional * WEIGHTS.bidirectional +
      infra * WEIGHTS.infra
  );

  if (input.inQuarantine) score = Math.min(score, 25);
  if (input.circuit.state === 'OPEN') score = Math.min(score, 15);

  const band = resolveBand(score);
  const labels: string[] = [];
  if (band === 'excellent') labels.push('Saudável');
  else if (band === 'good') labels.push('Atenção moderada');
  else if (band === 'caution') labels.push('Desacelerado');
  else labels.push('Crítico');

  if (input.circuit.state === 'THROTTLED') labels.push('Soft-ban (ACK baixo)');
  if (input.circuit.state === 'HALF_OPEN') labels.push('Falhas elevadas');
  if (input.circuit.state === 'OPEN') labels.push('Circuit breaker aberto');

  const delayMultiplier = unifiedDelayMultiplier(score, input.circuit.state);
  const poolWeightMultiplier = unifiedPoolWeightMultiplier(score, input.circuit.state);
  const usable = isUnifiedUsable(score, input.circuit.state, Boolean(input.inQuarantine));

  return {
    score,
    band,
    delayMultiplier,
    poolWeightMultiplier,
    usable,
    components: { maturity, circuit, bidirectional, infra },
    circuitState: input.circuit.state,
    labels,
  };
}

export function unifiedDelayMultiplier(score: number, circuitState?: CircuitState): number {
  if (circuitState === 'OPEN' || score < 30) return 4;
  if (circuitState === 'THROTTLED' || score < 50) return 2.5;
  if (circuitState === 'HALF_OPEN' || score < 80) return 1.5;
  return 1;
}

export function unifiedPoolWeightMultiplier(score: number, circuitState: CircuitState): number {
  if (circuitState === 'OPEN' || score < 30) return 0;
  if (circuitState === 'THROTTLED' || score < 50) return 0.35;
  if (circuitState === 'HALF_OPEN' || score < 80) return 0.55;
  return 1;
}

export function isUnifiedUsable(
  score: number,
  circuitState: CircuitState,
  inQuarantine = false
): boolean {
  if (inQuarantine) return false;
  if (circuitState === 'OPEN') return false;
  if (score < 30) return false;
  return true;
}

export function applyUnifiedWeightPenalty(baseWeight: number, health: UnifiedChipHealth): number {
  if (!health.usable || health.poolWeightMultiplier <= 0) return 0;
  return Math.max(1, Math.round(baseWeight * health.poolWeightMultiplier));
}

export async function recordChipInboundMessage(chipId: string): Promise<void> {
  const redis = getSharedRedis();
  const id = String(chipId || '').trim();
  if (!redis || !id) return;

  const key = `${INBOUND_KEY_PREFIX}${id}`;
  const member = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const minScore = Date.now() - INBOUND_WINDOW_MS;
  const pipeline = redis.pipeline();
  pipeline.zadd(key, Date.now(), member);
  pipeline.zremrangebyscore(key, '-inf', minScore);
  pipeline.expire(key, Math.ceil(INBOUND_WINDOW_MS / 1000));
  await pipeline.exec();
}

async function getInboundWindowCount(chipId: string): Promise<number> {
  const redis = getSharedRedis();
  const id = String(chipId || '').trim();
  if (!redis || !id) return 0;

  const key = `${INBOUND_KEY_PREFIX}${id}`;
  const minScore = Date.now() - INBOUND_WINDOW_MS;
  await redis.zremrangebyscore(key, '-inf', minScore);
  const count = await redis.zcard(key);
  return Number(count) || 0;
}

export function getCachedUnifiedHealth(chipId: string): UnifiedChipHealth | null {
  const id = String(chipId || '').trim();
  if (!id) return null;
  const row = unifiedHealthCache.get(id);
  if (!row) return null;
  if (Date.now() - row.at > CACHE_TTL_MS) return null;
  return row.health;
}

export function setCachedUnifiedHealth(chipId: string, health: UnifiedChipHealth): void {
  const id = String(chipId || '').trim();
  if (!id) return;
  unifiedHealthCache.set(id, { health, at: Date.now() });
}

export async function getUnifiedHealthForChip(
  chipId: string,
  ctx: Omit<UnifiedHealthInput, 'circuit' | 'inboundWindow'> & {
    circuit?: CircuitHealthScore;
    inboundWindow?: number;
  }
): Promise<UnifiedChipHealth> {
  const id = String(chipId || '').trim();
  const cached = getCachedUnifiedHealth(id);
  if (cached) return cached;

  const circuit = ctx.circuit ?? (await getChipCircuitBreaker().getHealthScore(id));
  const inboundWindow =
    ctx.inboundWindow !== undefined ? ctx.inboundWindow : await getInboundWindowCount(id);

  const health = composeUnifiedHealth({
    ...ctx,
    circuit,
    inboundWindow,
    sentWindow: ctx.sentWindow ?? circuit.sent,
  });

  setCachedUnifiedHealth(id, health);
  return health;
}
