import type { Campaign } from '../types';
import { CampaignStatus } from '../types';
import {
  aggregateFunnelFromReportRows,
  clampCampaignFunnelMetrics
} from './campaignFunnelMetrics';
import { getCampaignProgressMetrics } from './campaignMetrics';

function parseCampaignMs(raw?: string): number {
  if (!raw) return NaN;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** Janela de disparo da campanha (início → agora ou última execução). */
export function resolveCampaignDispatchWindow(
  campaign: Campaign,
  nowMs = Date.now()
): { startMs: number; endMs: number } | null {
  const startMs =
    parseCampaignMs(campaign.prospecting?.campaignStartedAt) ||
    parseCampaignMs(campaign.createdAt);
  if (!Number.isFinite(startMs)) return null;

  let endMs = nowMs;
  if (
    campaign.status === CampaignStatus.COMPLETED ||
    campaign.status === CampaignStatus.FAILED ||
    campaign.status === CampaignStatus.WAITING_REPLY
  ) {
    const last =
      parseCampaignMs(campaign.reportSnapshotAt) ||
      parseCampaignMs(campaign.lastRunAt) ||
      nowMs;
    if (Number.isFinite(last) && last >= startMs) endMs = last;
  }

  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

export function computeCampaignDeliveriesPerHour(
  deliveryCount: number,
  window: { startMs: number; endMs: number } | null
): number | null {
  const n = Math.max(0, Math.floor(Number(deliveryCount) || 0));
  if (!window || n <= 0) return null;
  const hours = (window.endMs - window.startMs) / 3_600_000;
  if (hours < 1 / 120) return null;
  return Math.round((n / hours) * 10) / 10;
}

export function formatDeliveriesPerHour(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${rate.toLocaleString('pt-BR')}/h`;
}

/** Funil por campanha para cartões (ACK no relatório; não confundir successCount com entregue). */
export function getCampaignCardFunnelMetrics(campaign: Campaign): {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
} {
  const snap = campaign.reportSnapshot;
  if (snap?.totals && (snap.totals.sent > 0 || snap.totals.delivered > 0)) {
    return clampCampaignFunnelMetrics(
      snap.totals.sent,
      snap.totals.delivered,
      snap.totals.read,
      snap.totals.replied
    );
  }
  if (snap?.rows?.length) {
    return aggregateFunnelFromReportRows(snap.rows.map((r) => ({ status: r.status })));
  }
  const m = getCampaignProgressMetrics(campaign);
  const sent = Math.max(0, m.ok + m.fail);
  return clampCampaignFunnelMetrics(sent, 0, 0, 0);
}

export function computeCampaignThroughputPerHour(
  campaign: Campaign,
  funnel: { delivered: number; sentOk: number }
): number | null {
  const window = resolveCampaignDispatchWindow(campaign);
  const basis = funnel.delivered > 0 ? funnel.delivered : Math.max(0, funnel.sentOk);
  return computeCampaignDeliveriesPerHour(basis, window);
}
