import type { Campaign, Contact, SystemMetrics, WarmupChipStats, WhatsAppConnection } from '../types';
import { CampaignStatus, ConnectionStatus } from '../types';
import { buildChannelDispatchInsights } from './channelDispatchInsights';

function sameLocalDay(isoOrStr: string): boolean {
  const d = new Date(isoOrStr);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export type ChannelSpotlightRow = {
  connection: WhatsAppConnection;
  sentToday: number;
  weekTotal: number;
  tempLabel: string;
  tempColor: string;
  tempBg: string;
  trendPct: number;
  spark: number[];
};

export function buildChannelSpotlightRows(
  connections: WhatsAppConnection[],
  warmupChipStats?: Record<string, WarmupChipStats>,
  limit = 4
): ChannelSpotlightRow[] {
  return [...connections]
    .map((connection) => {
      const insights = buildChannelDispatchInsights(connection, warmupChipStats?.[connection.id]);
      return {
        connection,
        sentToday: insights.sentToday,
        weekTotal: insights.weekTotal,
        tempLabel: insights.temp.label,
        tempColor: insights.temp.color,
        tempBg: insights.temp.bg,
        trendPct: insights.temp.trendPct,
        spark: insights.last7.map((d) => d.sent)
      };
    })
    .sort((a, b) => b.sentToday - a.sentToday)
    .slice(0, limit);
}

export type AccountDashboardSummary = {
  totalChannels: number;
  onlineChannels: number;
  offlineChannels: number;
  sentToday: number;
  queueTotal: number;
  pausedChannels: number;
  runningCampaigns: number;
  scheduledCampaigns: number;
  followUpsToday: number;
};

export function computeAccountDashboardSummary(
  connections: WhatsAppConnection[],
  campaigns: Campaign[],
  contacts: Contact[],
  circuitBreakerOpenIds: string[] = []
): AccountDashboardSummary {
  const breakers = new Set(circuitBreakerOpenIds);
  let onlineChannels = 0;
  let sentToday = 0;
  let queueTotal = 0;
  let pausedChannels = 0;

  for (const conn of connections) {
    if (conn.status === ConnectionStatus.CONNECTED) onlineChannels++;
    sentToday += conn.messagesSentToday || 0;
    queueTotal += conn.queueSize || 0;
    if (breakers.has(conn.id)) pausedChannels++;
  }

  let runningCampaigns = 0;
  let scheduledCampaigns = 0;
  for (const c of campaigns) {
    if (c.status === CampaignStatus.RUNNING) runningCampaigns++;
    else if (c.status === CampaignStatus.SCHEDULED) scheduledCampaigns++;
  }

  const followUpsToday = contacts.filter((c) => c.followUpAt && sameLocalDay(c.followUpAt)).length;

  return {
    totalChannels: connections.length,
    onlineChannels,
    offlineChannels: Math.max(0, connections.length - onlineChannels),
    sentToday,
    queueTotal,
    pausedChannels,
    runningCampaigns,
    scheduledCampaigns,
    followUpsToday
  };
}

export type AdminOpsSnapshot = {
  offlineChannels: number;
  queueTotal: number;
  ramPct: number | null;
  ramTotalGb: number | null;
  latencyMs: number | null;
};

export function computeAdminOpsSnapshot(
  connections: WhatsAppConnection[],
  systemMetrics?: SystemMetrics | null
): AdminOpsSnapshot {
  const offlineChannels = connections.filter((c) => c.status !== ConnectionStatus.CONNECTED).length;
  const queueTotal = connections.reduce((n, c) => n + (c.queueSize || 0), 0);
  return {
    offlineChannels,
    queueTotal,
    ramPct: systemMetrics?.ram != null ? Math.round(systemMetrics.ram) : null,
    ramTotalGb: systemMetrics?.ramTotalGb ?? null,
    latencyMs: systemMetrics?.latency != null ? Math.round(systemMetrics.latency) : null
  };
}
