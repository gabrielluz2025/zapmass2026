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
import { buildCampaignInboundRepliesMap } from './campaignInboundReplies.js';
import { enrichCampaignReportRow } from '../src/utils/campaignReportRowEnrichment.js';

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

  const allowed = Array.isArray(campaign.selectedConnectionIds)
    ? campaign.selectedConnectionIds.filter(Boolean)
    : [];
  try {
    const { getConversations } = await import('./evolutionService.js');
    const fromChat = buildCampaignInboundRepliesMap(campaignId, getConversations(), allowed, scoped);
    for (const [rk, inbound] of Object.entries(fromChat)) {
      const prev = replyHints.get(rk);
      if (!prev || inbound.replyTimestampMs >= prev.replyTimestampMs) {
        replyHints.set(rk, {
          phone: rk,
          replyTimestampMs: inbound.replyTimestampMs,
          replyText: inbound.replyText
        });
      }
    }
  } catch (e) {
    console.warn('[campaignReportSnapshot] inbound chat merge:', (e as Error)?.message || e);
  }

  const primary = buildPrimaryReportRowsFromLogs(
    scoped,
    campaignId,
    [],
    campaign,
    []
  );

  let conversations: Awaited<ReturnType<typeof import('./evolutionService.js')['getConversations']>> = [];
  try {
    const { getConversations } = await import('./evolutionService.js');
    conversations = getConversations();
  } catch {
    /* chat indisponível */
  }

  const rowByPhone = new Map<string, CampaignReportSnapshotRow>();
  for (const r of primary) {
    const rk = recipientKeyForCampaignReport(r.phone);
    if (!rk) continue;
    const hint = replyHints.get(rk);
    const enriched = enrichCampaignReportRow(
      {
        phone: r.phone,
        status: hint ? 'REPLIED' : r.status,
        sentTimestampMs: r.sentTimestampMs,
        contactName: r.contactName,
        connectionId: r.connectionId,
        replyText: r.replyText || hint?.replyText,
        replyTime: r.replyTime,
        replyTimestampMs: r.replyTimestampMs || hint?.replyTimestampMs
      },
      {
        campaignId,
        replyHint: hint,
        scopedLogs: scoped,
        conversations,
        allowedConnectionIds: allowed
      }
    );
    const status = enriched.status;
    const next: CampaignReportSnapshotRow = {
      phone: r.phone,
      contactName: enriched.contactName || r.contactName,
      status,
      sentTime: r.sentTime,
      sentTimestampMs: r.sentTimestampMs,
      replyText: enriched.replyText || hint?.replyText,
      replyTime: enriched.replyTime || (hint ? new Date(hint.replyTimestampMs).toLocaleTimeString('pt-BR') : undefined),
      replyTimestampMs: enriched.replyTimestampMs || hint?.replyTimestampMs,
      connectionId: enriched.connectionId || r.connectionId || hint?.connectionId,
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
  let read = 0;
  for (const row of rows) {
    if (row.status === 'REPLIED') {
      replied++;
      read++;
      delivered++;
    } else if (row.status === 'READ') {
      read++;
      delivered++;
    } else if (row.status === 'DELIVERED') {
      delivered++;
    }
  }
  const sent = Math.max(rows.length, campaign.totalContacts || 0, stageFunnels[0]?.sent || 0);
  const totals = clampCampaignFunnelMetrics(sent, delivered, read, replied);

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
