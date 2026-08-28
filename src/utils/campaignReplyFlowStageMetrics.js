import { clampCampaignFunnelMetrics, funnelPct } from './campaignFunnelMetrics';
import { CAMPAIGN_SENT_LOG_MESSAGE, campaignLogPayloadMatchesCampaign, isCampaignReplyLogPayload, logPayloadPhoneKey } from './campaignReportFromLogs';
function logPayload(p) {
    return (p && typeof p === 'object' ? p : {});
}
function sentStepFromLog(p) {
    const explicit = Number(p.replyFlowStep);
    if (Number.isFinite(explicit) && explicit >= 1)
        return Math.floor(explicit);
    return null;
}
function replyStepFromLog(p) {
    const step = Number(p.currentStep ?? p.replyFlowStep);
    if (Number.isFinite(step) && step >= 1)
        return Math.floor(step);
    return null;
}
/** Etapa do envio imediatamente anterior à resposta (maior sendTs <= replyTs). */
export function inferReplyStageIndex(phone, replyTs, stageCount, sendTsByStage, sentByStage) {
    let bestIdx = -1;
    let bestSendTs = -1;
    for (let i = 0; i < stageCount; i++) {
        const sendTs = sendTsByStage[i]?.get(phone);
        if (sendTs != null && sendTs <= replyTs && sendTs >= bestSendTs) {
            bestSendTs = sendTs;
            bestIdx = i;
        }
    }
    if (bestIdx >= 0)
        return bestIdx;
    for (let i = stageCount - 1; i >= 0; i--) {
        if (sentByStage[i]?.has(phone))
            return i;
    }
    return -1;
}
function metricsForStagePhones(phones, repliedPhones) {
    const sent = phones.size;
    let replied = 0;
    for (const phone of phones) {
        if (repliedPhones.has(phone))
            replied++;
    }
    // Envio da etapa = entregue; resposta na etapa = lida + respondida.
    return clampCampaignFunnelMetrics(sent, sent, replied, replied);
}
function createStagePhoneState(stageCount) {
    return {
        sentByStage: Array.from({ length: stageCount }, () => new Set()),
        repliedByStage: Array.from({ length: stageCount }, () => new Set()),
        sendTsByStage: Array.from({ length: stageCount }, () => new Map())
    };
}
function recordSent(state, stageCount, phone, ts, p, sendCountByPhone) {
    let sentStep = sentStepFromLog(p);
    if (sentStep == null) {
        const n = (sendCountByPhone.get(phone) || 0) + 1;
        sendCountByPhone.set(phone, n);
        sentStep = Math.min(n, stageCount);
    }
    if (sentStep < 1 || sentStep > stageCount)
        return;
    const idx = sentStep - 1;
    state.sentByStage[idx].add(phone);
    const prev = state.sendTsByStage[idx].get(phone);
    if (prev == null || ts < prev)
        state.sendTsByStage[idx].set(phone, ts);
}
function recordReply(state, stageCount, phone, ts, p, phonesEverSent) {
    if (!phonesEverSent.has(phone))
        return;
    const explicit = replyStepFromLog(p);
    let stageIdx = -1;
    if (explicit != null && explicit >= 1 && explicit <= stageCount) {
        stageIdx = explicit - 1;
    }
    else {
        stageIdx = inferReplyStageIndex(phone, ts, stageCount, state.sendTsByStage, state.sentByStage);
    }
    if (stageIdx < 0)
        return;
    state.sentByStage[stageIdx].add(phone);
    state.repliedByStage[stageIdx].add(phone);
}
export function collectStagePhoneState(campaignId, stageCount, logs) {
    const sendCountByPhone = new Map();
    const phonesEverSent = new Set();
    const state = createStagePhoneState(stageCount);
    const sortedLogs = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    for (const log of sortedLogs) {
        const p = logPayload(log.payload);
        if (!campaignLogPayloadMatchesCampaign(p, campaignId))
            continue;
        const msg = String(p.message || '');
        const phone = logPayloadPhoneKey(p);
        if (!phone)
            continue;
        const ts = new Date(log.timestamp).getTime();
        if (msg === CAMPAIGN_SENT_LOG_MESSAGE) {
            recordSent(state, stageCount, phone, ts, p, sendCountByPhone);
            phonesEverSent.add(phone);
        }
    }
    for (const log of sortedLogs) {
        const p = logPayload(log.payload);
        if (!campaignLogPayloadMatchesCampaign(p, campaignId))
            continue;
        const phone = logPayloadPhoneKey(p);
        if (!phone)
            continue;
        const ts = new Date(log.timestamp).getTime();
        if (isCampaignReplyLogPayload(p)) {
            recordReply(state, stageCount, phone, ts, p, phonesEverSent);
        }
    }
    return { state, phonesEverSent };
}
/** Eventos de resposta extraídos dos logs (todas as interações, não só a última por telefone). */
export function collectReplyEventsFromLogs(campaignId, logs) {
    const events = [];
    for (const log of logs) {
        const p = logPayload(log.payload);
        if (!campaignLogPayloadMatchesCampaign(p, campaignId))
            continue;
        if (!isCampaignReplyLogPayload(p))
            continue;
        const phone = logPayloadPhoneKey(p);
        if (!phone)
            continue;
        const ts = new Date(log.timestamp).getTime();
        if (!Number.isFinite(ts))
            continue;
        events.push({ phone, ts, p });
    }
    return events.sort((a, b) => a.ts - b.ts);
}
/** Hints extras quando o relatório já tem resposta mas o log de etapa não veio no payload. */
export function mergeReplyHintsIntoStageState(state, stageCount, replyHints, phonesEverSent, existingReplyKeys) {
    for (const [phone, hint] of replyHints) {
        const ts = hint.replyTimestampMs;
        if (!Number.isFinite(ts) || ts <= 0)
            continue;
        if (!phonesEverSent.has(phone))
            continue;
        const key = `${phone}|${ts}`;
        if (existingReplyKeys.has(key))
            continue;
        const idx = inferReplyStageIndex(phone, ts, stageCount, state.sendTsByStage, state.sentByStage);
        if (idx < 0)
            continue;
        state.sentByStage[idx].add(phone);
        state.repliedByStage[idx].add(phone);
        existingReplyKeys.add(key);
    }
}
function stageFunnelsFromState(steps, state) {
    return steps.map((step, idx) => {
        const stageNumber = idx + 1;
        const clamped = metricsForStagePhones(state.sentByStage[idx], state.repliedByStage[idx]);
        const bodyPreview = String(step.body || '').trim();
        const label = bodyPreview.length > 28 ? `Etapa ${stageNumber} · ${bodyPreview.slice(0, 28)}…` : `Etapa ${stageNumber}`;
        return {
            stageNumber,
            label,
            sent: clamped.sent,
            delivered: clamped.delivered,
            read: clamped.read,
            replied: clamped.replied,
            deliveryPct: funnelPct(clamped.delivered, clamped.sent),
            readPct: funnelPct(clamped.read, clamped.sent),
            replyPct: funnelPct(clamped.replied, clamped.sent)
        };
    });
}
/**
 * Métricas por etapa do fluxo por resposta (contatos únicos por etapa).
 * Cada resposta vai para a etapa do envio anterior (currentStep ou timestamp).
 */
export function buildReplyFlowStageFunnels(campaignId, campaign, logs, replyHints) {
    const steps = campaign.replyFlow?.enabled ? campaign.replyFlow.steps || [] : [];
    if (steps.length === 0)
        return [];
    const stageCount = steps.length;
    const { state, phonesEverSent } = collectStagePhoneState(campaignId, stageCount, logs);
    const replyKeys = new Set(collectReplyEventsFromLogs(campaignId, logs).map((e) => `${e.phone}|${e.ts}`));
    if (replyHints && replyHints.size > 0) {
        mergeReplyHintsIntoStageState(state, stageCount, replyHints, phonesEverSent, replyKeys);
    }
    return stageFunnelsFromState(steps, state);
}
export function isReplyFlowCampaign(campaign) {
    return Boolean(campaign.replyFlow?.enabled && (campaign.replyFlow.steps?.length ?? 0) > 0);
}
/** Funil principal = etapa 1 por contato (evita 2 envios / 1 pessoa parecer 50% entrega). */
export function primaryFunnelFromReplyFlowStages(stages) {
    const s1 = stages[0];
    if (!s1)
        return clampCampaignFunnelMetrics(0, 0, 0, 0);
    return clampCampaignFunnelMetrics(s1.sent, s1.delivered, s1.read, s1.replied);
}
