import type { ChatMessage, Conversation } from '../types';
import { CAMPAIGN_REPORT_STATUS_RANK, recipientKeyForCampaignReport } from './campaignReportDedupe';
import {
  applyReplyHintsToReportRow,
  buildReplyHintsFromLogs,
  campaignLogPayloadMatchesCampaign,
  type CampaignLogPayloadLike,
  CAMPAIGN_SENT_LOG_MESSAGE,
  isCampaignReplyLogMessage,
  logPayloadPhoneKey,
  type ReplyHintFromLog
} from './campaignReportFromLogs';
import { firstReplyAfterCampaignSend, latestCampaignSendTimestampMs } from './campaignReplyScope';

export type ReportStatusLike = 'PENDING' | 'FAILED' | 'SENT' | 'DELIVERED' | 'READ' | 'REPLIED';

function statusRank(status: string): number {
  return CAMPAIGN_REPORT_STATUS_RANK[status] ?? -1;
}

function maxStatus(a: string, b: string): string {
  return statusRank(a) >= statusRank(b) ? a : b;
}

/** Melhor ACK entre todas as mensagens da campanha na conversa (não só a última). */
export function bestCampaignMessageStatus(
  messages: ChatMessage[] | undefined,
  campaignId: string
): ReportStatusLike {
  const cid = String(campaignId || '').trim();
  if (!cid) return 'SENT';
  let best: ReportStatusLike = 'SENT';
  for (const m of messages || []) {
    if (m.sender !== 'me' || !m.fromCampaign || m.campaignId !== cid) continue;
    if (m.status === 'read') return 'READ';
    if (m.status === 'delivered' && statusRank(best) < statusRank('DELIVERED')) best = 'DELIVERED';
    if (m.status === 'sent' && statusRank(best) < statusRank('SENT')) best = 'SENT';
  }
  return best;
}

/** Última resposta do contato após qualquer envio desta campanha. */
export function latestReplyAfterAnyCampaignSend(
  messages: ChatMessage[] | undefined,
  campaignId: string
): ChatMessage | null {
  const cid = String(campaignId || '').trim();
  if (!cid) return null;
  const sendTs = latestCampaignSendTimestampMs(messages, cid);
  if (!sendTs) return null;
  return firstReplyAfterCampaignSend(messages, sendTs);
}

/** Última resposta registrada nos logs da campanha (fluxo por etapas / contato). */
export function latestReplyHintFromLogs(
  logs: Array<{ timestamp: string; payload?: unknown }>,
  campaignId: string,
  phoneKey: string
): ReplyHintFromLog | undefined {
  const rk = recipientKeyForCampaignReport(phoneKey);
  if (!rk) return undefined;
  let best: ReplyHintFromLog | undefined;
  for (const log of logs) {
    if (!log.payload || typeof log.payload !== 'object') continue;
    const p = log.payload as CampaignLogPayloadLike;
    if (!campaignLogPayloadMatchesCampaign(p, campaignId)) continue;
    if (!isCampaignReplyLogMessage(String(p.message || ''))) continue;
    if (logPayloadPhoneKey(p) !== rk) continue;
    const ts = new Date(log.timestamp).getTime();
    const preview = p.replyPreview ? String(p.replyPreview).trim() : '';
    if (!best || ts >= best.replyTimestampMs) {
      best = {
        phone: rk,
        replyTimestampMs: ts,
        replyText: preview || undefined,
        connectionId: p.connectionId
      };
    }
  }
  return best;
}

export function hasReplyLogForPhone(
  logs: Array<{ timestamp: string; payload?: unknown }>,
  campaignId: string,
  phoneKey: string
): boolean {
  return Boolean(latestReplyHintFromLogs(logs, campaignId, phoneKey));
}

export type EnrichReportRowInput = {
  phone: string;
  status: string;
  replyText?: string;
  replyTime?: string;
  replyTimestampMs?: number;
  sentTimestampMs?: number;
  contactName?: string;
  connectionId?: string;
};

/**
 * Consolida status/resposta: logs de resposta > chat > ACK das mensagens da campanha.
 */
export function enrichCampaignReportRow<T extends EnrichReportRowInput>(
  row: T,
  opts: {
    campaignId: string;
    replyHint?: ReplyHintFromLog;
    scopedLogs: Array<{ timestamp: string; payload?: unknown }>;
    conversations: Conversation[];
    allowedConnectionIds: string[];
  }
): T & {
  status: ReportStatusLike;
  replyText?: string;
  replyTime?: string;
  replyTimestampMs?: number;
  connectionId?: string;
} {
  const rk = recipientKeyForCampaignReport(row.phone);
  const fromLogs = latestReplyHintFromLogs(opts.scopedLogs, opts.campaignId, row.phone);
  const mergedHint =
    opts.replyHint && fromLogs
      ? fromLogs.replyTimestampMs >= opts.replyHint.replyTimestampMs
        ? fromLogs
        : { ...opts.replyHint, replyText: opts.replyHint.replyText || fromLogs.replyText }
      : fromLogs || opts.replyHint;

  let out = applyReplyHintsToReportRow(row, mergedHint) as T & {
    status: ReportStatusLike;
    replyText?: string;
    replyTime?: string;
    replyTimestampMs?: number;
    connectionId?: string;
  };

  if (mergedHint?.connectionId && !out.connectionId) {
    out = { ...out, connectionId: mergedHint.connectionId };
  }

  const target = rk;
  const allowed = opts.allowedConnectionIds || [];
  for (const conv of opts.conversations) {
    if (allowed.length > 0 && !allowed.includes(conv.connectionId)) continue;
    const convKey = recipientKeyForCampaignReport(conv.contactPhone || '');
    const jidPart = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : '';
    const jidKey = recipientKeyForCampaignReport(jidPart.split('@')[0] || '');
    if (convKey !== target && jidKey !== target) continue;

    const ackStatus = bestCampaignMessageStatus(conv.messages, opts.campaignId);
    out = { ...out, status: maxStatus(out.status, ackStatus) as ReportStatusLike };

    const reply = latestReplyAfterAnyCampaignSend(conv.messages, opts.campaignId);
    if (reply) {
      const ts = reply.timestampMs || 0;
      out = {
        ...out,
        status: 'REPLIED',
        replyText: out.replyText || reply.text,
        replyTimestampMs: out.replyTimestampMs || ts,
        replyTime:
          out.replyTime ||
          (ts ? new Date(ts).toLocaleTimeString('pt-BR') : reply.timestamp)
      };
    }
  }

  if (mergedHint || fromLogs) {
    out = { ...out, status: 'REPLIED' };
    if (!out.replyText && (mergedHint?.replyText || fromLogs?.replyText)) {
      const hint = mergedHint || fromLogs!;
      out = {
        ...out,
        replyText: hint.replyText,
        replyTimestampMs: hint.replyTimestampMs,
        replyTime: new Date(hint.replyTimestampMs).toLocaleTimeString('pt-BR')
      };
    }
  }

  return out;
}

export { buildReplyHintsFromLogs };
