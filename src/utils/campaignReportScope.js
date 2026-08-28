import { recipientKeyForCampaignReport } from './campaignReportDedupe';
import { CAMPAIGN_SENT_LOG_MESSAGE, campaignLogPayloadMatchesCampaign, logPayloadPhoneKey } from './campaignReportFromLogs';
/** Telefones com log "Mensagem enviada" nesta campanha. */
export function collectSentPhonesFromCampaignLogs(logs, campaignId) {
    const cid = String(campaignId || '').trim();
    const out = new Set();
    if (!cid)
        return out;
    for (const log of logs) {
        if (!log.payload || typeof log.payload !== 'object')
            continue;
        const p = log.payload;
        if (!campaignLogPayloadMatchesCampaign(p, cid))
            continue;
        if (String(p.message || '') !== CAMPAIGN_SENT_LOG_MESSAGE)
            continue;
        const rk = logPayloadPhoneKey(p);
        if (rk)
            out.add(rk);
    }
    return out;
}
/** Destinatários planejados (lista / snapshot) — limite superior do relatório. */
export function collectPlannedRecipientPhones(campaign, contacts, contactLists) {
    const out = new Set();
    const snap = campaign.scheduleStartSnapshot;
    if (snap?.recipients?.length) {
        for (const r of snap.recipients) {
            const rk = recipientKeyForCampaignReport(r.phone);
            if (rk)
                out.add(rk);
        }
        return out;
    }
    if (snap?.numbers?.length) {
        for (const n of snap.numbers) {
            const rk = recipientKeyForCampaignReport(n);
            if (rk)
                out.add(rk);
        }
        return out;
    }
    const listId = campaign.contactListId?.trim();
    if (listId) {
        const list = contactLists.find((l) => l.id === listId);
        if (list?.contactIds?.length) {
            for (const cid of list.contactIds) {
                const c = contacts.find((x) => x.id === cid);
                const rk = recipientKeyForCampaignReport(c?.phone || '');
                if (rk)
                    out.add(rk);
            }
        }
    }
    return out;
}
export function campaignCreatedAtMs(campaign) {
    const t = Date.parse(String(campaign.createdAt || ''));
    return Number.isFinite(t) ? t : 0;
}
/** Início da janela de logs: última execução ou criação (evita cortar logs após reagendar). */
export function campaignRunWindowStartMs(campaign) {
    const candidates = [campaign.lastRunAt, campaign.createdAt];
    let min = Number.MAX_SAFE_INTEGER;
    for (const raw of candidates) {
        if (!raw)
            continue;
        const t = Date.parse(String(raw));
        if (Number.isFinite(t) && t < min)
            min = t;
    }
    return min === Number.MAX_SAFE_INTEGER ? 0 : min;
}
/** Mantém só contatos desta campanha (envio real ou planejados, nunca inbox inteiro). */
export function isPhoneInCampaignReportScope(phoneKey, sentPhones, plannedPhones) {
    const rk = recipientKeyForCampaignReport(phoneKey);
    if (!rk)
        return false;
    if (sentPhones.has(rk))
        return true;
    if (plannedPhones.has(rk))
        return true;
    return false;
}
export function filterLogsForCampaignView(logs, campaignId, minTimestampMs = 0) {
    const cid = String(campaignId || '').trim();
    return logs.filter((log) => {
        if (!log.payload || typeof log.payload !== 'object')
            return false;
        const p = log.payload;
        if (!campaignLogPayloadMatchesCampaign(p, cid))
            return false;
        if (minTimestampMs > 0) {
            const ts = Date.parse(log.timestamp);
            if (Number.isFinite(ts) && ts < minTimestampMs - 60_000)
                return false;
        }
        return true;
    });
}
