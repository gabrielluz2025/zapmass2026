import {
  MP_CHECKOUT_UNAVAILABLE_MSG,
  MP_TOKEN_INVALID_MSG,
  classifyMercadoPagoConfigErrorMessage,
  isMercadoPagoTokenErrorMessage,
  type MpCheckoutIssue
} from '../shared/mercadoPagoErrors.js';

export class MercadoPagoApiError extends Error {
  readonly httpStatus: number;
  readonly logMessage: string;
  readonly userMessage: string;

  constructor(httpStatus: number, data: Record<string, unknown>) {
    const mpMsg = typeof data.message === 'string' ? data.message : '';
    const mpError = typeof data.error === 'string' ? data.error : '';
    const logMessage = `Mercado Pago: ${httpStatus} - ${mpMsg || mpError || JSON.stringify(data).slice(0, 400)}`;
    const userMessage = resolveUserMessage(httpStatus, mpMsg, mpError);
    super(userMessage);
    this.name = 'MercadoPagoApiError';
    this.httpStatus = httpStatus;
    this.logMessage = logMessage;
    this.userMessage = userMessage;
  }
}

function resolveUserMessage(httpStatus: number, mpMsg: string, mpError: string): string {
  const combined = `${mpMsg} ${mpError}`.toLowerCase();
  if (
    httpStatus === 401 ||
    combined.includes('invalid access token') ||
    combined.includes('unauthorized')
  ) {
    return MP_TOKEN_INVALID_MSG;
  }
  if (httpStatus === 403) return MP_CHECKOUT_UNAVAILABLE_MSG;
  if (mpMsg && mpMsg.length <= 120 && !isMercadoPagoTokenErrorMessage(mpMsg)) {
    return `Mercado Pago: ${mpMsg}`;
  }
  return MP_CHECKOUT_UNAVAILABLE_MSG;
}

export function throwIfMercadoPagoHttpError(res: Response, data: Record<string, unknown>): void {
  if (!res.ok) {
    const err = new MercadoPagoApiError(res.status, data);
    console.error('[mercadopago]', err.logMessage);
    throw err;
  }
}

export function billingRouteErrorPayload(e: unknown): {
  status: number;
  error: string;
  mpIssue?: MpCheckoutIssue;
} {
  if (e instanceof MercadoPagoApiError) {
    const status = e.httpStatus === 401 || e.httpStatus === 403 ? 503 : e.httpStatus >= 500 ? 502 : 503;
    const mpIssue: MpCheckoutIssue | undefined =
      e.httpStatus === 401 || e.httpStatus === 403 ? 'token_invalid' : undefined;
    return { status, error: e.userMessage, ...(mpIssue ? { mpIssue } : {}) };
  }
  if (e instanceof Error) {
    const fromMsg = classifyMercadoPagoConfigErrorMessage(e.message);
    if (e.message.includes('MERCADOPAGO_ACCESS_TOKEN nao configurado')) {
      return { status: 503, error: MP_CHECKOUT_UNAVAILABLE_MSG, mpIssue: 'token_missing' };
    }
    if (
      isMercadoPagoTokenErrorMessage(e.message) ||
      e.message.startsWith('MERCADOPAGO_ACCESS_TOKEN invalido')
    ) {
      return {
        status: 503,
        error: MP_TOKEN_INVALID_MSG,
        mpIssue: fromMsg ?? 'token_invalid'
      };
    }
    if (fromMsg === 'back_url') {
      console.error('[billing] erro interno de checkout:', e.message);
      return { status: 503, error: MP_CHECKOUT_UNAVAILABLE_MSG, mpIssue: 'back_url' };
    }
    // Erros internos de configuração/parse não devem vazar para o cliente pagante.
    if (/MERCADOPAGO_|PUBLIC_APP_URL|JSON|Unexpected token|fetch failed/i.test(e.message)) {
      console.error('[billing] erro interno de checkout:', e.message);
      const mpIssue =
        fromMsg ?? (/fetch failed/i.test(e.message) ? ('mp_unreachable' as const) : undefined);
      return { status: 503, error: MP_CHECKOUT_UNAVAILABLE_MSG, ...(mpIssue ? { mpIssue } : {}) };
    }
    return { status: 500, error: e.message };
  }
  return { status: 500, error: MP_CHECKOUT_UNAVAILABLE_MSG };
}
