/**
 * Classifica erros de envio de campanha (Evolution/Baileys/WhatsApp).
 * Usado no worker (failover) e na UI (reenvio seletivo).
 */
export function isRecipientPolicyOutboundError(detail) {
    if (!detail)
        return false;
    return (/\b463\b/i.test(detail) ||
        /reachout|timelock|NackCallerReachout/i.test(detail) ||
        /not registered|exists:\s*false|não encontrado no WhatsApp|Contato não encontrado/i.test(detail) ||
        /Número inválido|mensagem vazia/i.test(detail));
}
export function isUnrecoverableCampaignOutboundError(detail) {
    if (!detail)
        return false;
    if (isRecipientPolicyOutboundError(detail))
        return true;
    return /HTTP 400|status code 400|recusou o envio \(400\)|não foi possível obter o número/i.test(detail);
}
export function isChipHealthOutbound4xx(detail) {
    if (!detail)
        return false;
    if (/\b463\b/i.test(detail) || /reachout|timelock/i.test(detail))
        return false;
    if (isRecipientPolicyOutboundError(detail) && /not registered|exists:\s*false/i.test(detail)) {
        return false;
    }
    return /\b401\b|\b403\b|\b429\b|not authorized|device JID/i.test(detail);
}
export function classifyCampaignOutboundError(detail) {
    const d = String(detail || '');
    if (!d.trim())
        return 'other';
    if (/\b463\b/i.test(d) || /reachout|timelock|NackCallerReachout/i.test(d)) {
        return 'reachout_timelock';
    }
    if (/not registered|exists:\s*false|não encontrado no WhatsApp|Contato não encontrado/i.test(d)) {
        return 'not_registered';
    }
    if (/duplica(ç|c)ão de (texto|mídia)|PAUSED_BY_HIGH_DUPLICATION|conteúdo idêntico/i.test(d)) {
        return 'content_dup';
    }
    if (/not authorized|device JID|HTTP 401|status code 401|logged.?out|session/i.test(d)) {
        return 'chip_auth';
    }
    return 'other';
}
export function campaignOutboundErrorKindLabel(kind) {
    const labels = {
        not_registered: 'Sem WhatsApp',
        reachout_timelock: 'Restrição Meta (463)',
        chip_auth: 'Chip / sessão',
        content_dup: 'Pausa por texto igual',
        other: 'Outro',
    };
    return labels[kind] || kind;
}
export function humanizeCampaignOutboundError(detail) {
    const d = String(detail || '').trim();
    if (!d)
        return '';
    const kind = classifyCampaignOutboundError(d);
    if (kind === 'reachout_timelock') {
        return 'Restrição Meta (463 / reachout) — chip não pode falar com este contato frio. Não reenvie em lote.';
    }
    if (kind === 'not_registered') {
        return 'Número sem WhatsApp (ou formato inválido). Valide a base antes de reenviar.';
    }
    if (kind === 'chip_auth') {
        return `Problema de sessão/auth do chip — reconecte e reenvie só estes. (${d.slice(0, 120)})`;
    }
    if (kind === 'content_dup') {
        return 'Pausa anti-spam por texto igual — jobs adiados. Ao retomar, o envio continua (varie Spintax para evitar nova pausa).';
    }
    return d;
}
export function isRetryableCampaignOutboundKind(kind) {
    return kind === 'chip_auth' || kind === 'other' || kind === 'content_dup';
}
