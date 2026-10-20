const LOCAL_FALLBACK = 'http://localhost:8000';

function cleanUrl(raw: string | undefined): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (!u.protocol.startsWith('http')) return null;
    return v.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h === '[::1]';
  } catch {
    return true;
  }
}

/**
 * URL pública do app para `back_urls`, `notification_url` (webhook) e links de e-mail.
 * Ordem: MERCADOPAGO_BACK_URL → PUBLIC_APP_URL → localhost (só desenvolvimento).
 */
export function resolveMercadoPagoBackUrl(env: NodeJS.ProcessEnv = process.env): string {
  return cleanUrl(env.MERCADOPAGO_BACK_URL) || cleanUrl(env.PUBLIC_APP_URL) || LOCAL_FALLBACK;
}

/**
 * Em produção, `localhost` como URL de retorno quebra o checkout (cliente volta para localhost) e,
 * pior, o webhook nunca chega — o cliente paga e o acesso não é liberado. Falha cedo e com mensagem clara.
 */
export function assertMercadoPagoBackUrlForCheckout(env: NodeJS.ProcessEnv = process.env): string {
  const url = resolveMercadoPagoBackUrl(env);
  if (env.NODE_ENV === 'production' && isLocalUrl(url)) {
    throw new Error(
      'MERCADOPAGO_BACK_URL (ou PUBLIC_APP_URL) não configurada no servidor: defina a URL pública https://… para o checkout e o webhook do Mercado Pago.'
    );
  }
  return url;
}
