import { normPhoneKey } from './brPhoneNormalize';

/** Agrega linhas de relatório por destinatário (evita 2+ linhas por multi-etapa / formatos de telefone diferentes). */
export type ReportRowLike = {
  phone: string;
  status: string;
  sentTimestampMs: number;
};

const STATUS_RANK: Record<string, number> = {
  REPLIED: 5,
  READ: 4,
  DELIVERED: 3,
  SENT: 2,
  PENDING: 1,
  FAILED: 0
};

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
    const ra = STATUS_RANK[row.status] ?? -1;
    const rb = STATUS_RANK[prev.status] ?? -1;
    if (ra > rb) {
      m.set(k, row);
    } else if (ra === rb && (row.sentTimestampMs || 0) >= (prev.sentTimestampMs || 0)) {
      m.set(k, row);
    }
  }
  return Array.from(m.values()).sort((a, b) => (b.sentTimestampMs || 0) - (a.sentTimestampMs || 0));
}
