import { Campaign, CampaignStatus } from '../types';
import { getCampaignProgressMetrics } from './campaignMetrics';

function parseCampaignTime(c: Campaign): number {
  const raw = c.lastRunAt || c.createdAt;
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

export interface CampaignRadar {
  lastTouched: Campaign | null;
  bestSuccess: Campaign | null;
  bestSuccessPct: number;
  nextScheduled: { campaign: Campaign; nextRunAt: string } | null;
}

export interface CampaignFleetSummary {
  running: number;
  scheduled: number;
  completed: number;
  paused: number;
  failed: number;
}

const STATUS_PT: Record<string, string> = {
  [CampaignStatus.RUNNING]: 'Em disparo',
  [CampaignStatus.WAITING_REPLY]: 'Aguardando respostas',
  [CampaignStatus.SCHEDULED]: 'Agendada',
  [CampaignStatus.COMPLETED]: 'Concluída',
  [CampaignStatus.PAUSED]: 'Pausada',
  [CampaignStatus.FAILED]: 'Falhou',
  [CampaignStatus.DRAFT]: 'Rascunho'
};

export function campaignStatusLabel(status: CampaignStatus | string): string {
  return STATUS_PT[status] || String(status || '—');
}

export function computeCampaignFleetSummary(campaigns: Campaign[]): CampaignFleetSummary {
  let running = 0;
  let scheduled = 0;
  let completed = 0;
  let paused = 0;
  let failed = 0;
  for (const c of campaigns) {
    if (c.status === CampaignStatus.RUNNING) running++;
    else if (c.status === CampaignStatus.SCHEDULED) scheduled++;
    else if (c.status === CampaignStatus.COMPLETED) completed++;
    else if (c.status === CampaignStatus.PAUSED) paused++;
    else if (c.status === CampaignStatus.FAILED) failed++;
  }
  return { running, scheduled, completed, paused, failed };
}

export function formatCampaignWhen(c: Campaign): string {
  const raw = c.lastRunAt || c.createdAt;
  if (!raw) return '';
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function computeCampaignRadar(campaigns: Campaign[]): CampaignRadar {
  if (!campaigns.length) {
    return { lastTouched: null, bestSuccess: null, bestSuccessPct: 0, nextScheduled: null };
  }

  const healed = [...campaigns].sort((a, b) => parseCampaignTime(b) - parseCampaignTime(a));
  const lastTouched = healed[0] || null;

  let bestCampaign: Campaign | null = null;
  let bestPct = 0;
  for (const c of campaigns) {
    if (c.status !== CampaignStatus.COMPLETED) continue;
    const m = getCampaignProgressMetrics(c);
    if (m.effectiveProcessed <= 0 || m.ok <= 0) continue;
    const pct = m.successRatePct;
    if (pct > bestPct || (pct === bestPct && m.ok > (bestCampaign ? getCampaignProgressMetrics(bestCampaign).ok : 0))) {
      bestPct = pct;
      bestCampaign = c;
    }
  }

  let next: { campaign: Campaign; nextRunAt: string } | null = null;
  for (const c of campaigns) {
    if (c.status !== CampaignStatus.SCHEDULED) continue;
    const nr = c.nextRunAt;
    if (!nr) continue;
    const t = new Date(nr).getTime();
    if (!Number.isFinite(t)) continue;
    if (!next || t < new Date(next.nextRunAt).getTime()) next = { campaign: c, nextRunAt: nr };
  }

  return { lastTouched, bestSuccess: bestCampaign, bestSuccessPct: bestPct, nextScheduled: next };
}
