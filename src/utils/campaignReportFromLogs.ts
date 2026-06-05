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

/** Reconhece logs de resposta mesmo com pequenas variações de texto (VPS/UI). */
export function isCampaignReplyLogMessage(msg: string): boolean {
  const m = String(msg || '').trim();
  if (REPLY_LOG_MESSAGES.has(m)) return true;
  if (m.includes('Resposta recebida no fluxo')) return true;
  if (m.includes('Resposta do contato')) return true;
  return false;
}

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
  replyFlowStep?: number;
  currentStep?: number;
  nonTextReply?: boolean;
};

/** Log de resposta no fluxo (message na coluna ou só replyPreview/currentStep no payload). */
export function isCampaignReplyLogPayload(p: CampaignLogPayloadLike): boolean {
  if (isCampaignReplyLogMessage(String(p.message || ''))) return true;
  const preview = String(p.replyPreview || '').trim();
  if (preview.length > 0) return true;
  if (p.nonTextReply && Number(p.currentStep) >= 1) return true;
  return false;
}

export function logPayloadPhoneKey(p: CampaignLogPayloadLike): string {
  const raw = p.to || p.phoneDigits || '';
  return recipientKeyForCampaignReport(String(raw));
}

/** Status exibido no relatório: logs de resposta prevalecem sobre SENT/ACK atrasado. */
export function effectiveCampaignReportStatus(
  row: { phone: string; status: string },
  replyHints: Map<string, ReplyHintFromLog>
): string {
  if (row.status === 'REPLIED') return 'REPLIED';
  const rk = recipientKeyForCampaignReport(row.phone);
  if (rk && replyHints.has(rk)) return 'REPLIED';
  return row.status;
}

/** Contatos com resposta confirmada nos logs (independente do status da linha). */
export function countRepliedFromLogsAndReport(
  rows: Array<{ phone: string; status: string }>,
  replyHints: Map<string, ReplyHintFromLog>
): number {
  const keys = new Set<string>();
  for (const row of rows) {
    const rk = recipientKeyForCampaignReport(row.phone);
    if (!rk) continue;
    if (effectiveCampaignReportStatus(row, replyHints) === 'REPLIED') keys.add(rk);
  }
  for (const rk of replyHints.keys()) keys.add(rk);
  return keys.size;
}

export type ReplyHintFromLog = {
  phone: string;
  replyTimestampMs: number;
  replyText?: string;
  connectionId?: string;
};

/** Índice de respostas confirmadas pelo fluxo por etapas (logs ao vivo ou persistidos). */
/** Logs já filtrados por campanha podem omitir campaignId no payload. */
export function campaignLogPayloadMatchesCampaign(
  p: CampaignLogPayloadLike,
  campaignId: string
): boolean {
  const cid = String(campaignId || '').trim();
  if (!cid) return false;
  if (!p.campaignId) return true;
  return p.campaignId === cid;
}

export function buildReplyHintsFromLogs(
  logs: Array<{ timestamp: string; payload?: unknown }>,
  campaignId: string,
  /** Só contabiliza resposta se houve envio nesta campanha para o telefone. */
  sentPhones?: Set<string>
): Map<string, ReplyHintFromLog> {
  const out = new Map<string, ReplyHintFromLog>();
  for (const log of logs) {
    if (!log.payload || typeof log.payload !== 'object') continue;
    const p = log.payload as CampaignLogPayloadLike;
    if (!campaignLogPayloadMatchesCampaign(p, campaignId)) continue;
    if (!isCampaignReplyLogPayload(p)) continue;
    const phone = logPayloadPhoneKey(p);
    if (!phone) continue;
    if (sentPhones && sentPhones.size > 0 && !sentPhones.has(phone)) continue;
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
  if (!inbound) return row as T & { status: string };
  const rank = CAMPAIGN_REPORT_STATUS_RANK;
  const hasBetterStatus = (rank[row.status] ?? -1) >= (rank.REPLIED ?? 5);
  const merged: T & {
    status: string;
    replyText?: string;
    replyTime?: string;
    replyTimestampMs?: number;
  } = {
    ...row,
    replyText: inbound.replyText || (row as { replyText?: string }).replyText,
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
