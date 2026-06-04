import { normPhoneKey } from './brPhoneNormalize';

/** Agrega linhas de relatório por destinatário (evita 2+ linhas por multi-etapa / formatos de telefone diferentes). */
export type ReportRowLike = {
  phone: string;
  status: string;
  sentTimestampMs: number;
};

export const CAMPAIGN_REPORT_STATUS_RANK: Record<string, number> = {
  REPLIED: 5,
  READ: 4,
  DELIVERED: 3,
  SENT: 2,
  PENDING: 1,
  FAILED: 0
};

type RowWithReply = ReportRowLike & {
  replyText?: string;
  replyTime?: string;
  replyTimestampMs?: number;
  contactName?: string;
  connectionId?: string;
};

function mergeReplyFields<T extends RowWithReply>(base: T, other: T): T {
  return {
    ...base,
    replyText: base.replyText || other.replyText,
    replyTime: base.replyTime || other.replyTime,
    replyTimestampMs: base.replyTimestampMs || other.replyTimestampMs,
    contactName: base.contactName || other.contactName,
    connectionId: base.connectionId || other.connectionId
  };
}

/** Mantém a linha com melhor status; empate → mais recente, preservando texto de resposta. */
export function pickBetterCampaignReportRow<T extends RowWithReply>(a: T, b: T): T {
  const ra = CAMPAIGN_REPORT_STATUS_RANK[a.status] ?? -1;
  const rb = CAMPAIGN_REPORT_STATUS_RANK[b.status] ?? -1;
  if (ra > rb) return mergeReplyFields(a, b);
  if (rb > ra) return mergeReplyFields(b, a);
  const newer = (a.sentTimestampMs || 0) >= (b.sentTimestampMs || 0) ? a : b;
  const older = newer === a ? b : a;
  return mergeReplyFields(newer, older);
}

export function recipientKeyForCampaignReport(phone: string): string {
  return normPhoneKey(phone) || phone.replace(/\D/g, '');
}

/** Mantém uma linha por destinatário: prioriza melhor status (ex.: REPLIED > READ > SENT). */
export function dedupeCampaignReportRowsByRecipient<T extends ReportRowLike>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const row of rows) {
    const k = recipientKeyForCampaignReport(row.phone);
    if (!k) continue;
    const prev = m.get(k);
    if (!prev) {
      m.set(k, row);
      continue;
    }
    m.set(k, pickBetterCampaignReportRow(prev, row));
  }
  return Array.from(m.values()).sort((a, b) => (b.sentTimestampMs || 0) - (a.sentTimestampMs || 0));
}
