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
