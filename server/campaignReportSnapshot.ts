import type { Campaign } from '../src/types.js';
import { buildPrimaryReportRowsFromLogs } from '../src/utils/campaignReportBuilder.js';
import {
  buildReplyHintsFromLogs,
  type CampaignLogPayloadLike
} from '../src/utils/campaignReportFromLogs.js';
import {
  buildReplyFlowStageFunnels,
  type ReplyFlowStageFunnel
} from '../src/utils/campaignReplyFlowStageMetrics.js';
import { recipientKeyForCampaignReport } from '../src/utils/campaignReportDedupe.js';
import { clampCampaignFunnelMetrics } from '../src/utils/campaignFunnelMetrics.js';
import type { CampaignLogRow } from './repositories/campaignsRepository.js';
import { listCampaignLogs } from './repositories/campaignsRepository.js';
import { getCampaign } from './repositories/campaignsRepository.js';
import { mergeUpdateCampaign } from './repositories/campaignsRepository.js';

export type CampaignReportSnapshotRow = {
  phone: string;
  contactName: string;
  status: string;
  sentTime: string;
  sentTimestampMs: number;
  replyText?: string;
  replyTime?: string;
  replyTimestampMs?: number;
  connectionId?: string;
  errorMessage?: string;
};

export type CampaignReportSnapshot = {
  builtAt: string;
  logCount: number;
  rows: CampaignReportSnapshotRow[];
  replyPhones: Record<string, { replyText?: string; replyTimestampMs: number }>;
  stageFunnels: ReplyFlowStageFunnel[];
  totals: { sent: number; delivered: number; read: number; replied: number };
};

function logRowsToScoped(logRows: CampaignLogRow[], campaignId: string) {
  const scoped = logRows.map((r) => {
    const p = (r.payload || {}) as Record<string, unknown>;
    return {
      timestamp: r.created_at.toISOString(),
      payload: {
        ...p,
        campaignId: String(p.campaignId || campaignId),
        message: String(r.message || p.message || ''),
        to: String(p.to || p.phoneDigits || ''),
        phoneDigits: String(p.phoneDigits || p.to || '')
      } as CampaignLogPayloadLike
    };
  });
  return scoped.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export async function buildCampaignReportSnapshot(
  tenantId: string,
  campaignId: string
): Promise<CampaignReportSnapshot | null> {
  const campaign = await getCampaign(tenantId, campaignId);
  if (!campaign) return null;

  const logRows = await listCampaignLogs(tenantId, campaignId, { limit: 500, offset: 0 });
  const scoped = logRowsToScoped(logRows, campaignId);
  const replyHints = buildReplyHintsFromLogs(scoped, campaignId);

  const primary = buildPrimaryReportRowsFromLogs(
    scoped,
    campaignId,
    [],
    campaign,
    []
  );

  const rowByPhone = new Map<string, CampaignReportSnapshotRow>();
  for (const r of primary) {
    const rk = recipientKeyForCampaignReport(r.phone);
    if (!rk) continue;
    const hint = replyHints.get(rk);
    const status = hint ? 'REPLIED' : r.status;
    const next: CampaignReportSnapshotRow = {
      phone: r.phone,
      contactName: r.contactName,
      status,
      sentTime: r.sentTime,
      sentTimestampMs: r.sentTimestampMs,
      replyText: r.replyText || hint?.replyText,
      replyTime: r.replyTime || (hint ? new Date(hint.replyTimestampMs).toLocaleTimeString('pt-BR') : undefined),
      replyTimestampMs: r.replyTimestampMs || hint?.replyTimestampMs,
      connectionId: r.connectionId || hint?.connectionId,
      errorMessage: r.errorMessage
    };
    const prev = rowByPhone.get(rk);
    if (!prev || (next.status === 'REPLIED' && prev.status !== 'REPLIED')) {
      rowByPhone.set(rk, next);
    }
  }
  const rows: CampaignReportSnapshotRow[] = Array.from(rowByPhone.values());

  const replyPhones: CampaignReportSnapshot['replyPhones'] = {};
  for (const [rk, hint] of replyHints) {
    replyPhones[rk] = {
      replyText: hint.replyText,
      replyTimestampMs: hint.replyTimestampMs
    };
  }

  const stageFunnels =
    campaign.replyFlow?.enabled && (campaign.replyFlow.steps?.length ?? 0) > 0
      ? buildReplyFlowStageFunnels(campaignId, campaign, scoped, replyHints)
      : [];

  let replied = 0;
  let delivered = 0;
  for (const row of rows) {
    if (row.status === 'REPLIED') {
      replied++;
      delivered++;
    } else if (['DELIVERED', 'READ'].includes(row.status)) {
      delivered++;
    }
  }
  const sent = Math.max(rows.length, campaign.totalContacts || 0, stageFunnels[0]?.sent || 0);
  const totals = clampCampaignFunnelMetrics(sent, Math.max(delivered, replied), replied, replied);

  return {
    builtAt: new Date().toISOString(),
    logCount: logRows.length,
    rows,
    replyPhones,
    stageFunnels,
    totals
  };
}

export async function persistCampaignReportSnapshot(
  tenantId: string,
  campaignId: string
): Promise<void> {
  try {
    const snapshot = await buildCampaignReportSnapshot(tenantId, campaignId);
    if (!snapshot) return;
    await mergeUpdateCampaign(tenantId, campaignId, {
      reportSnapshot: snapshot,
      reportSnapshotAt: snapshot.builtAt
    });
  } catch (e) {
    console.warn('[campaignReportSnapshot] persist:', campaignId, e);
  }
}
