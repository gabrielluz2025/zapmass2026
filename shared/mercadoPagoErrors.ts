/** Mensagem genérica quando checkout MP não pode abrir (config ou indisponibilidade). */
export const MP_CHECKOUT_UNAVAILABLE_MSG =
  'Pagamento temporariamente indisponível. Tente novamente mais tarde ou fale com o suporte.';

/** Token inválido/revogado ou credencial errada no servidor. */
export const MP_TOKEN_INVALID_MSG =
  'Pagamento indisponível no momento. As credenciais Mercado Pago do servidor precisam ser renovadas — entre em contato com o suporte.';

export function isMercadoPagoTokenErrorMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('invalid access token') ||
    m.includes('mercadopago_access_token') ||
    m.includes('access token invalido') ||
    (m.includes('401') && m.includes('mercado pago'))
  );
}

/** Converte erro bruto da API (ou rede) em texto seguro para o utilizador. */
export function formatMercadoPagoCheckoutError(apiError: string | undefined | null): string {
  if (!apiError || !apiError.trim()) return MP_CHECKOUT_UNAVAILABLE_MSG;
  const trimmed = apiError.trim();
  if (isMercadoPagoTokenErrorMessage(trimmed)) return MP_TOKEN_INVALID_MSG;
  if (trimmed.includes('MERCADOPAGO_ACCESS_TOKEN nao configurado')) return MP_CHECKOUT_UNAVAILABLE_MSG;
  if (trimmed.startsWith('MERCADOPAGO_ACCESS_TOKEN invalido')) return MP_TOKEN_INVALID_MSG;
  return trimmed;
}
