import { apiUrl } from '../utils/apiBase';
import { getSessionIdToken } from '../utils/sessionAuth';

export type ChipProtectionSnapshot = {
  chipQuietMode: boolean;
  nurture: { journeyEnabled: boolean; dueEnrollments: number; pausedByQuiet: boolean };
  autoWarmup: { active: boolean; connectionIds: string[]; pausedByQuiet: boolean };
  campaigns: { activeCount: number; queueHint: string };
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

export async function fetchChipProtection(): Promise<ChipProtectionSnapshot> {
  const res = await fetch(apiUrl('/api/chip-protection'), { headers: await authHeaders() });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao carregar proteção de chips.');
  return data as ChipProtectionSnapshot;
}

export async function setChipQuietMode(enabled: boolean): Promise<ChipProtectionSnapshot> {
  const res = await fetch(apiUrl('/api/chip-protection'), {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ chipQuietMode: enabled }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao salvar modo chip quieto.');
  return data as ChipProtectionSnapshot;
}
