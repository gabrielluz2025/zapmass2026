import { apiUrl } from '../utils/apiBase';
import { getSessionIdToken } from '../utils/sessionAuth';

export type ChipProtectionPolicy = 'auto' | 'always' | 'off';

export type ChipProtectionConnectionRow = {
  id: string;
  name: string;
  status: string;
  circuitState: 'CLOSED' | 'HALF_OPEN' | 'THROTTLED' | 'OPEN';
  healthScore: number;
  healthBand: 'excellent' | 'good' | 'caution' | 'critical';
  failRatePct: number;
  deliveryRatioPct?: number;
  sentWindow: number;
  deliveredWindow?: number;
  failuresWindow: number;
  inQuarantine: boolean;
  quarantineUntil: string | null;
  banCount: number;
};

export type ChipProtectionFeedItem = {
  at: string;
  level: 'ok' | 'info' | 'warn' | 'danger';
  title: string;
  detail?: string;
};

export type ChipProtectionSnapshot = {
  chipQuietMode: boolean;
  chipProtectionPolicy: ChipProtectionPolicy;
  protectionReason: string | null;
  protectionReasonLabel: string;
  protectionLockUntil: string | null;
  lockRemainingMs: number | null;
  fetchedAt: string;
  nurture: { journeyEnabled: boolean; dueEnrollments: number; pausedByQuiet: boolean };
  autoWarmup: { active: boolean; connectionIds: string[]; pausedByQuiet: boolean };
  campaigns: { activeCount: number; queueHint: string };
  campaignProtection?: {
    runningCount: number;
    pausedByProtection: Array<{
      campaignId: string;
      reason?: string;
      message?: string;
      autoResumeAt?: number;
    }>;
  };
  connections: ChipProtectionConnectionRow[];
  liveFeed: ChipProtectionFeedItem[];
  sync: {
    fullHistory: boolean;
    fullInboxSync: boolean;
    msgPrefetch: number;
    sparseConvLimit: number;
    prefetchBatchSize: number;
  };
  risks: Array<{ level: 'warn' | 'info'; message: string }>;
  recommendations: string[];
};

async function authHeaders(): Promise<HeadersInit> {
  const token = await getSessionIdToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export async function fetchChipHealthSummary(): Promise<ChipHealthSummary> {
  const res = await fetch(apiUrl('/api/chip-health/summary'), { headers: await authHeaders() });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao carregar resumo de saúde dos chips.');
  return data as ChipHealthSummary;
}

export type ChipHealthSummary = {
  ok?: boolean;
  timestamp: string;
  totalChips: number;
  averageScore: number;
  distribution: {
    excellent: number;
    regular: number;
    degraded: number;
    critical: number;
  };
  statusCounts: {
    throttled: number;
    openCircuit: number;
    proxyDown: number;
    quarantine: number;
  };
};

export async function fetchChipProtection(): Promise<ChipProtectionSnapshot> {
  const res = await fetch(apiUrl('/api/chip-protection'), { headers: await authHeaders() });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao carregar proteção de chips.');
  return data as ChipProtectionSnapshot;
}

export async function setChipProtectionPolicy(
  policy: ChipProtectionPolicy
): Promise<ChipProtectionSnapshot> {
  const res = await fetch(apiUrl('/api/chip-protection'), {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ chipProtectionPolicy: policy }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao salvar política de proteção.');
  return data as ChipProtectionSnapshot;
}

export async function clearChipProtectionLock(): Promise<ChipProtectionSnapshot> {
  const res = await fetch(apiUrl('/api/chip-protection/clear-lock'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao encerrar cooldown.');
  return data as ChipProtectionSnapshot;
}

export async function resetChipCircuitBreaker(): Promise<ChipProtectionSnapshot> {
  const res = await fetch(apiUrl('/api/chip-protection/reset-circuit'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao resetar circuit breaker.');
  return data as ChipProtectionSnapshot;
}
