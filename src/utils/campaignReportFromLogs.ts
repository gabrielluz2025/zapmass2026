import type { CampaignGeoUfStats } from '../types';
import {
  CAMPAIGN_REPORT_STATUS_RANK,
  pickBetterCampaignReportRow,
  recipientKeyForCampaignReport
} from './campaignReportDedupe';

export const CAMPAIGN_SENT_LOG_MESSAGE = 'Mensagem enviada';
export const CAMPAIGN_REPLY_LOG_MESSAGE = 'Resposta recebida no fluxo por etapas';
export const CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE = 'Resposta do contato';

const REPLY_LOG_MESSAGES = new Set([
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE
]);

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
    if (!REPLY_LOG_MESSAGES.has(String(p.message || ''))) continue;
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

export type ServerInboundReply = { replyText: string; replyTimestampMs: number };

export function applyServerInboundReplyToRow<T extends { phone: string; status: string }>(
  row: T,
  inbound: ServerInboundReply | undefined
): T & {
  status: string;
  replyText?: string;
  replyTime?: string;
  replyTimestampMs?: number;
} {
  if (!inbound?.replyText) return row as T & { status: string };
  const rank = CAMPAIGN_REPORT_STATUS_RANK;
  const hasBetterStatus = (rank[row.status] ?? -1) >= (rank.REPLIED ?? 5);
  const merged: T & {
    status: string;
    replyText?: string;
    replyTime?: string;
    replyTimestampMs?: number;
  } = {
    ...row,
    replyText: inbound.replyText,
    replyTime: new Date(inbound.replyTimestampMs).toLocaleTimeString('pt-BR'),
    replyTimestampMs: inbound.replyTimestampMs
  };
  if (!hasBetterStatus) merged.status = 'REPLIED';
  return merged;
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
  const rowRank = rank[row.status] ?? -1;
  const withText = {
    ...row,
    replyText: hint.replyText || (row as { replyText?: string }).replyText,
    replyTime: new Date(hint.replyTimestampMs).toLocaleTimeString('pt-BR'),
    replyTimestampMs: hint.replyTimestampMs,
    connectionId: (row as { connectionId?: string }).connectionId || hint.connectionId
  };
  if (rowRank >= (rank.REPLIED ?? 5)) return withText as T & { status: string };
  return {
    ...withText,
    status: 'REPLIED'
  };
}

/** Texto da coluna RESPOSTA / DETALHE quando não há mensagem capturada. */
export function campaignReportReplyDetailLabel(
  status: string,
  replyText?: string
): string | null {
  if (replyText?.trim()) return null;
  if (status === 'REPLIED') return 'Resposta recebida (sem texto legível — mídia ou reação)';
  if (status === 'READ') {
    return 'Lida no WhatsApp — o contato não mandou mensagem de volta (só confirmação de leitura)';
  }
  if (status === 'DELIVERED') return 'Entregue — aguardando leitura ou resposta';
  return null;
}

export { pickBetterCampaignReportRow };
