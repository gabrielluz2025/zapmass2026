import { getChipCircuitBreaker } from './chipCircuitBreaker.js';
import { filterByConnectionScope } from './connectionScopeServer.js';
import { getReconnectStormProgress } from './chipProtectionService.js';
import {
  getUnifiedHealthForChip,
  setCachedUnifiedHealth,
  type UnifiedHealthBand,
} from './chipUnifiedHealthScore.js';
import { getProxyHealthSnapshot } from './proxyHealthMonitor.js';
import type { CircuitState } from './chipCircuitBreaker.js';
import type { ProxyHealthStatus } from './proxyHealthMonitor.js';

export type ChipHealthDistributionBucket = 'excellent' | 'regular' | 'degraded' | 'critical';

export type ChipHealthSummary = {
  timestamp: string;
  totalChips: number;
  averageScore: number;
  distribution: Record<ChipHealthDistributionBucket, number>;
  statusCounts: {
    throttled: number;
    openCircuit: number;
    proxyDown: number;
    quarantine: number;
  };
};

export type ChipHealthSummaryRow = {
  score: number;
  band: UnifiedHealthBand;
  circuitState: CircuitState;
  inQuarantine: boolean;
  proxyStatus: ProxyHealthStatus | null;
};

export function distributionBucketForScore(score: number): ChipHealthDistributionBucket {
  if (score >= 80) return 'excellent';
  if (score >= 50) return 'regular';
  if (score >= 30) return 'degraded';
  return 'critical';
}

export function aggregateChipHealthSummary(rows: ChipHealthSummaryRow[]): ChipHealthSummary {
  const distribution: Record<ChipHealthDistributionBucket, number> = {
    excellent: 0,
    regular: 0,
    degraded: 0,
    critical: 0,
  };
  const statusCounts = {
    throttled: 0,
    openCircuit: 0,
    proxyDown: 0,
    quarantine: 0,
  };

  let scoreSum = 0;
  for (const row of rows) {
    scoreSum += row.score;
    distribution[distributionBucketForScore(row.score)] += 1;
    if (row.circuitState === 'THROTTLED') statusCounts.throttled += 1;
    if (row.circuitState === 'OPEN') statusCounts.openCircuit += 1;
    if (row.proxyStatus === 'PROXY_DOWN') statusCounts.proxyDown += 1;
    if (row.inQuarantine) statusCounts.quarantine += 1;
  }

  const totalChips = rows.length;
  const averageScore =
    totalChips > 0 ? Math.round((scoreSum / totalChips) * 10) / 10 : 0;

  return {
    timestamp: new Date().toISOString(),
    totalChips,
    averageScore,
    distribution,
    statusCounts,
  };
}

export async function buildChipHealthSummary(tenantId: string): Promise<ChipHealthSummary> {
  const uid = String(tenantId || '').trim();
  const evo = await import('./evolutionService.js');
  const cb = getChipCircuitBreaker();
  const storm = getReconnectStormProgress(uid);
  const scopedConns = filterByConnectionScope(uid, evo.getConnections());
  const rows: ChipHealthSummaryRow[] = [];

  for (const conn of scopedConns) {
    const id = String(conn.id || '').trim();
    if (!id) continue;

    const banInfo = evo.getConnectionBanInfo(id);
    const circuit = await cb.getHealthScore(id);
    const proxyStatus =
      conn.proxyHealth?.status ?? getProxyHealthSnapshot(id)?.status ?? null;

    const unified = await getUnifiedHealthForChip(id, {
      connectedSinceMs: conn.connectedSince ?? null,
      circuit,
      proxyStatus,
      hasProxy: Boolean(conn.proxy?.host),
      inQuarantine: banInfo.inQuarantine,
      banCount: banInfo.banCount,
      reconnectStormCount: storm.count,
      reconnectStormThreshold: storm.threshold,
      sentWindow: circuit.sent,
    });
    setCachedUnifiedHealth(id, unified);

    rows.push({
      score: unified.score,
      band: unified.band,
      circuitState: unified.circuitState,
      inQuarantine: banInfo.inQuarantine,
      proxyStatus,
    });
  }

  return aggregateChipHealthSummary(rows);
}

export type ChipHealthWarmupGroup = 'A-quarentena' | 'B-crítico' | 'C-regular' | 'D-excelente';

export type ChipHealthDetailRow = {
  connectionId: string;
  name: string;
  status: string;
  score: number;
  band: UnifiedHealthBand;
  circuitState: CircuitState;
  inQuarantine: boolean;
  quarantineUntil: string | null;
  warmupGroup: ChipHealthWarmupGroup;
  tierLabel: string;
  suggestedDailyCap: number;
  delayMultiplier: number;
};

export type ChipHealthDetail = {
  timestamp: string;
  tenantId: string;
  chips: ChipHealthDetailRow[];
  recommendations: string[];
};

function warmupGroupForRow(inQuarantine: boolean, score: number): ChipHealthWarmupGroup {
  if (inQuarantine) return 'A-quarentena';
  if (score < 30) return 'B-crítico';
  if (score >= 80) return 'D-excelente';
  return 'C-regular';
}

/** Lista por chip (mesma RAM do processo API) — para scripts VPS com auth interna. */
export async function buildChipHealthDetail(tenantId: string): Promise<ChipHealthDetail> {
  const uid = String(tenantId || '').trim();
  const { getChipActivitySnapshot } = await import('./chipProtectionService.js');
  const evo = await import('./evolutionService.js');
  const { resolveChipTier } = await import('./chipTrustScore.js');
  const snap = await getChipActivitySnapshot(uid);

  const chips: ChipHealthDetailRow[] = snap.connections.map((c) => {
    const since = evo.getConnectionConnectedSince(c.id);
    const tier = resolveChipTier(typeof since === 'number' ? since : undefined);
    return {
      connectionId: c.id,
      name: c.name,
      status: c.status,
      score: c.healthScore,
      band: c.healthBand,
      circuitState: c.circuitState,
      inQuarantine: c.inQuarantine,
      quarantineUntil: c.quarantineUntil,
      warmupGroup: warmupGroupForRow(c.inQuarantine, c.healthScore),
      tierLabel: tier.label,
      suggestedDailyCap: tier.suggestedDailyCap,
      delayMultiplier: tier.delayMultiplier,
    };
  });

  chips.sort((a, b) => a.score - b.score);

  return {
    timestamp: new Date().toISOString(),
    tenantId: uid,
    chips,
    recommendations: snap.recommendations,
  };
}
