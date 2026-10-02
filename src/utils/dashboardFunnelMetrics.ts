import type { DashboardMetrics, FunnelStats } from '../types';
import { clampCampaignFunnelMetrics } from './campaignFunnelMetrics';

/** Funil global do painel — só contadores persistidos (PG/arquivo), sem geo de uma campanha aberta. */
export function mergePersistedFunnelStats(
  funnel: Pick<FunnelStats, 'totalSent' | 'totalDelivered' | 'totalRead' | 'totalReplied'>
): DashboardMetrics {
  const sent = Math.max(0, Number(funnel.totalSent) || 0);
  const replied = Math.max(0, Number(funnel.totalReplied) || 0);
  const read = Math.max(0, Number(funnel.totalRead) || 0, replied);
  const delivered = Math.max(0, Number(funnel.totalDelivered) || 0, read);
  const clamped = clampCampaignFunnelMetrics(sent, delivered, read, replied);
  return {
    totalSent: clamped.sent,
    totalDelivered: clamped.delivered,
    totalRead: clamped.read,
    totalReplied: clamped.replied
  };
}
