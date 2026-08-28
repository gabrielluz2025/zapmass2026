import { normPhoneKey } from './brPhoneNormalize';
export const CAMPAIGN_REPORT_STATUS_RANK = {
    REPLIED: 5,
    READ: 4,
    DELIVERED: 3,
    SENT: 2,
    PENDING: 1,
    SKIPPED: 0.5,
    FAILED: 0
};
function mergeReplyFields(base, other) {
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
export function pickBetterCampaignReportRow(a, b) {
    const ra = CAMPAIGN_REPORT_STATUS_RANK[a.status] ?? -1;
    const rb = CAMPAIGN_REPORT_STATUS_RANK[b.status] ?? -1;
    if (ra > rb)
        return mergeReplyFields(a, b);
    if (rb > ra)
        return mergeReplyFields(b, a);
    const newer = (a.sentTimestampMs || 0) >= (b.sentTimestampMs || 0) ? a : b;
    const older = newer === a ? b : a;
    return mergeReplyFields(newer, older);
}
export function recipientKeyForCampaignReport(phone) {
    return normPhoneKey(phone) || phone.replace(/\D/g, '');
}
/** Mantém uma linha por destinatário: prioriza melhor status (ex.: REPLIED > READ > SENT). */
export function dedupeCampaignReportRowsByRecipient(rows) {
    const m = new Map();
    for (const row of rows) {
        const k = recipientKeyForCampaignReport(row.phone);
        if (!k)
            continue;
        const prev = m.get(k);
        if (!prev) {
            m.set(k, row);
            continue;
        }
        m.set(k, pickBetterCampaignReportRow(prev, row));
    }
    return Array.from(m.values()).sort((a, b) => (b.sentTimestampMs || 0) - (a.sentTimestampMs || 0));
}
