import { recipientKeyForCampaignReport } from './campaignReportDedupe';
import { buildReplyHintsFromLogs, CAMPAIGN_SENT_LOG_MESSAGE, isCampaignFrequencyCapSkipLog, isCampaignReplyLogPayload, campaignLogPayloadMatchesCampaign, logPayloadPhoneKey } from './campaignReportFromLogs';
import { collectPlannedRecipientPhones, collectSentPhonesFromCampaignLogs } from './campaignReportScope';
function findContactName(phone, contacts) {
    const target = recipientKeyForCampaignReport(phone);
    for (const c of contacts) {
        if (recipientKeyForCampaignReport(c.phone) === target)
            return c.name;
    }
    return '';
}
/**
 * Relatório por contato derivado dos logs da campanha (fonte principal).
 * Garante REPLIED quando há log de resposta, independente do estado do chat.
 */
export function buildPrimaryReportRowsFromLogs(scopedLogs, campaignId, contacts, campaign, contactLists) {
    const cid = String(campaignId || '').trim();
    if (!cid)
        return [];
    const sentPhones = collectSentPhonesFromCampaignLogs(scopedLogs, cid);
    const plannedPhones = collectPlannedRecipientPhones(campaign, contacts, contactLists);
    const replyHints = buildReplyHintsFromLogs(scopedLogs, cid);
    const phones = new Set();
    for (const p of plannedPhones)
        phones.add(p);
    for (const p of sentPhones)
        phones.add(p);
    for (const rk of replyHints.keys())
        phones.add(rk);
    const byPhone = new Map();
    const ensure = (phone) => {
        let acc = byPhone.get(phone);
        if (!acc) {
            acc = {
                phone,
                firstSentMs: Number.MAX_SAFE_INTEGER,
                lastSentMs: 0,
                sentTime: '—',
                status: 'PENDING',
                id: `log-${phone}`
            };
            byPhone.set(phone, acc);
        }
        return acc;
    };
    for (const phone of phones)
        ensure(phone);
    const sorted = [...scopedLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    for (const log of sorted) {
        if (!log.payload || typeof log.payload !== 'object')
            continue;
        const p = log.payload;
        if (!campaignLogPayloadMatchesCampaign(p, cid))
            continue;
        const msg = String(p.message || '');
        const phone = logPayloadPhoneKey(p);
        if (!phone)
            continue;
        const ts = new Date(log.timestamp).getTime();
        const acc = ensure(phone);
        if (msg === CAMPAIGN_SENT_LOG_MESSAGE) {
            if (ts < acc.firstSentMs) {
                acc.firstSentMs = ts;
                acc.sentTime = new Date(ts).toLocaleTimeString('pt-BR');
            }
            if (ts > acc.lastSentMs)
                acc.lastSentMs = ts;
            if (p.connectionId)
                acc.connectionId = p.connectionId;
            if (acc.status !== 'FAILED' && acc.status !== 'REPLIED')
                acc.status = 'SENT';
            continue;
        }
        if (isCampaignFrequencyCapSkipLog(msg, p.skipReason)) {
            if (acc.status === 'PENDING') {
                acc.status = 'SKIPPED';
                acc.errorMessage = 'Já recebeu mensagem nas últimas 24 h';
            }
            continue;
        }
        if (isCampaignReplyLogPayload(p)) {
            acc.status = 'REPLIED';
            const preview = p.replyPreview ? String(p.replyPreview).trim() : '';
            if (!acc.replyTimestampMs || ts >= acc.replyTimestampMs) {
                acc.replyTimestampMs = ts;
                acc.replyTime = new Date(ts).toLocaleTimeString('pt-BR');
                if (preview)
                    acc.replyText = preview;
            }
            if (p.connectionId)
                acc.connectionId = p.connectionId;
            continue;
        }
        if (log && String(log.event || '').includes('error')) {
            acc.status = 'FAILED';
            acc.errorMessage = p.error || msg || 'Erro desconhecido';
        }
    }
    for (const [rk, hint] of replyHints) {
        const acc = ensure(rk);
        acc.status = 'REPLIED';
        if (hint.replyText)
            acc.replyText = hint.replyText;
        if (hint.replyTimestampMs) {
            acc.replyTimestampMs = hint.replyTimestampMs;
            acc.replyTime = new Date(hint.replyTimestampMs).toLocaleTimeString('pt-BR');
        }
        if (hint.connectionId)
            acc.connectionId = hint.connectionId;
    }
    const scopeOk = (phone) => {
        const rk = recipientKeyForCampaignReport(phone);
        if (sentPhones.has(rk))
            return true;
        if (plannedPhones.has(rk))
            return true;
        return replyHints.has(rk);
    };
    return Array.from(byPhone.values())
        .filter((a) => scopeOk(a.phone) || a.status === 'FAILED')
        .map((a) => {
        const firstSent = a.firstSentMs !== Number.MAX_SAFE_INTEGER ? a.firstSentMs : a.lastSentMs || 0;
        return {
            id: a.id,
            phone: a.phone,
            contactName: findContactName(a.phone, contacts) || `+${a.phone}`,
            status: a.status,
            sentTime: a.sentTime !== '—' ? a.sentTime : firstSent ? new Date(firstSent).toLocaleTimeString('pt-BR') : '—',
            sentTimestampMs: firstSent || a.replyTimestampMs || 0,
            replyText: a.replyText,
            replyTime: a.replyTime,
            replyTimestampMs: a.replyTimestampMs,
            connectionId: a.connectionId,
            errorMessage: a.errorMessage
        };
    })
        .sort((a, b) => b.sentTimestampMs - a.sentTimestampMs);
}
