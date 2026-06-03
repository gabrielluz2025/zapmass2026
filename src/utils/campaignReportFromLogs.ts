import type { CampaignGeoUfStats } from '../types';
import {
  CAMPAIGN_REPORT_STATUS_RANK,
  pickBetterCampaignReportRow,
  recipientKeyForCampaignReport
} from './campaignReportDedupe';

export const CAMPAIGN_SENT_LOG_MESSAGE = 'Mensagem enviada';
export const CAMPAIGN_REPLY_LOG_MESSAGE = 'Resposta recebida no fluxo por etapas';

export function sumCampaignGeoStats(byUf: Record<string, CampaignGeoUfStats>): {
  delivered: number;
  read: number;
  replied: number;
} {
  let delivered = 0;
  let read = 0;
  let replied = 0;
  for (const s of Object.values(byUf || {})) {
    delivered += Number(s.delivered) || 0;
    read += Number(s.read) || 0;
    replied += Number(s.replied) || 0;
  }
  return { delivered, read, replied };
}

export type CampaignLogPayloadLike = {
  campaignId?: string;
  to?: string;
  phoneDigits?: string;
  message?: string;
  error?: string;
  connectionId?: string;
  replyPreview?: string;
};

export function logPayloadPhoneKey(p: CampaignLogPayloadLike): string {
  const raw = p.to || p.phoneDigits || '';
  return recipientKeyForCampaignReport(String(raw));
}

export type ReplyHintFromLog = {
  phone: string;
  replyTimestampMs: number;
  replyText?: string;
  connectionId?: string;
};

/** Índice de respostas confirmadas pelo fluxo por etapas (logs ao vivo ou persistidos). */
export function buildReplyHintsFromLogs(
  logs: Array<{ timestamp: string; payload?: unknown }>,
  campaignId: string
): Map<string, ReplyHintFromLog> {
  const out = new Map<string, ReplyHintFromLog>();
  for (const log of logs) {
    if (!log.payload || typeof log.payload !== 'object') continue;
    const p = log.payload as CampaignLogPayloadLike;
    if (p.campaignId !== campaignId) continue;
    if (p.message !== CAMPAIGN_REPLY_LOG_MESSAGE) continue;
    const phone = logPayloadPhoneKey(p);
    if (!phone) continue;
    const ts = new Date(log.timestamp).getTime();
    const prev = out.get(phone);
    if (!prev || ts >= prev.replyTimestampMs) {
      out.set(phone, {
        phone,
        replyTimestampMs: ts,
        replyText: p.replyPreview ? String(p.replyPreview) : undefined,
        connectionId: p.connectionId
      });
    }
  }
  return out;
}

export function applyReplyHintsToReportRow<T extends { phone: string; status: string }>(
  row: T,
  hint: ReplyHintFromLog | undefined
): T & {
  status: string;
  replyText?: string;
  replyTime?: string;
  replyTimestampMs?: number;
  connectionId?: string;
} {
  if (!hint) return row as T & { status: string };
  const rank = CAMPAIGN_REPORT_STATUS_RANK;
  if ((rank[row.status] ?? -1) >= (rank.REPLIED ?? 5)) return row as T & { status: string };
  return {
    ...row,
    status: 'REPLIED',
    replyText: hint.replyText,
    replyTime: new Date(hint.replyTimestampMs).toLocaleTimeString('pt-BR'),
    replyTimestampMs: hint.replyTimestampMs,
    connectionId: (row as { connectionId?: string }).connectionId || hint.connectionId
  };
}

export { pickBetterCampaignReportRow };
