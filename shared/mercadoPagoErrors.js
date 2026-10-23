/** Mensagem genérica quando checkout MP não pode abrir (config ou indisponibilidade). */
export const MP_CHECKOUT_UNAVAILABLE_MSG = 'Pagamento temporariamente indisponível. Tente novamente mais tarde ou fale com o suporte.';
/** Token inválido/revogado ou credencial errada no servidor. */
export const MP_TOKEN_INVALID_MSG = 'Pagamento indisponível no momento. As credenciais Mercado Pago do servidor precisam ser renovadas — entre em contato com o suporte.';
export function isMercadoPagoTokenErrorMessage(msg) {
    const m = msg.toLowerCase();
    return (m.includes('invalid access token') ||
        m.includes('mercadopago_access_token') ||
        m.includes('access token invalido') ||
        (m.includes('401') && m.includes('mercado pago')));
}
export function classifyMercadoPagoHealth(health) {
    if (health.valid)
        return null;
    if (!health.configured)
        return 'token_missing';
    const err = (health.error || '').trim();
    const lower = err.toLowerCase();
    if (lower.includes('invalid access token') ||
        lower.includes('unauthorized') ||
        /\b401\b/.test(lower)) {
        return 'token_invalid';
    }
    if (err.includes('deve começar') ||
        err.includes('Public Key') ||
        err.includes('curto demais') ||
        err.includes('parece Public Key')) {
        return 'token_malformed';
    }
    if (lower.includes('fetch failed') ||
        lower.includes('timeout') ||
        lower.includes('abort') ||
        lower.includes('econnrefused') ||
        lower.includes('network')) {
        return 'mp_unreachable';
    }
    if (err)
        return 'token_invalid';
    return 'token_missing';
}
export function classifyMercadoPagoConfigErrorMessage(message) {
    const m = message.trim();
    if (!m)
        return null;
    if (m.includes('MERCADOPAGO_ACCESS_TOKEN nao configurado'))
        return 'token_missing';
    if (m.startsWith('MERCADOPAGO_ACCESS_TOKEN invalido'))
        return 'token_malformed';
    if (m.includes('MERCADOPAGO_BACK_URL') ||
        (m.includes('PUBLIC_APP_URL') && m.includes('checkout'))) {
        return 'back_url';
    }
    if (isMercadoPagoTokenErrorMessage(m))
        return 'token_invalid';
    return null;
}
export function mercadoPagoAdminSetupHint(issue) {
    switch (issue) {
        case 'token_missing':
            return 'MERCADOPAGO_ACCESS_TOKEN ausente no container. Na VPS: MERCADOPAGO_ACCESS_TOKEN=\'APP_USR-…\' bash deployment/vps-env-secrets.sh && bash deployment/vps-deploy.sh (Swarm não lê .env sozinho).';
        case 'token_invalid':
            return 'Token presente mas rejeitado pelo Mercado Pago (401). Regenere APP_USR- em developers/panel → Credenciais de produção e rode deployment/set-mercadopago-token.sh ou vps-env-secrets.sh + redeploy.';
        case 'token_malformed':
            return 'Valor em MERCADOPAGO_ACCESS_TOKEN não é Access Token (use APP_USR-… longo, não Public Key). Corrija o .env e sincronize secrets/mercadopago_access_token.';
        case 'back_url':
            return 'Defina MERCADOPAGO_BACK_URL=https://zap-mass.com (e PUBLIC_APP_URL) — localhost em produção bloqueia checkout e webhook.';
        case 'mp_unreachable':
            return 'Servidor não alcançou api.mercadopago.com (rede/firewall/DNS). Token pode estar ok; tente de novo ou confira conectividade na VPS.';
        default:
            return 'Checkout MP indisponível. Rode bash deployment/vps-check-env.sh e curl /api/billing/mercadopago/status na VPS.';
    }
}
/** Converte erro bruto da API (ou rede) em texto seguro para o utilizador. */
export function formatMercadoPagoCheckoutError(apiError) {
    if (!apiError || !apiError.trim())
        return MP_CHECKOUT_UNAVAILABLE_MSG;
    const trimmed = apiError.trim();
    if (isMercadoPagoTokenErrorMessage(trimmed))
        return MP_TOKEN_INVALID_MSG;
    if (trimmed.includes('MERCADOPAGO_ACCESS_TOKEN nao configurado'))
        return MP_CHECKOUT_UNAVAILABLE_MSG;
    if (trimmed.startsWith('MERCADOPAGO_ACCESS_TOKEN invalido'))
        return MP_TOKEN_INVALID_MSG;
    if (trimmed.includes('MERCADOPAGO_BACK_URL') && trimmed.includes('checkout')) {
        return MP_CHECKOUT_UNAVAILABLE_MSG;
    }
    return trimmed;
}
