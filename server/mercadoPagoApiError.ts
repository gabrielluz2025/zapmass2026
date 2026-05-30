import {
  MP_CHECKOUT_UNAVAILABLE_MSG,
  MP_TOKEN_INVALID_MSG,
  isMercadoPagoTokenErrorMessage
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

export function billingRouteErrorPayload(e: unknown): { status: number; error: string } {
  if (e instanceof MercadoPagoApiError) {
    const status = e.httpStatus === 401 || e.httpStatus === 403 ? 503 : e.httpStatus >= 500 ? 502 : 503;
    return { status, error: e.userMessage };
  }
  if (e instanceof Error) {
    if (e.message.includes('MERCADOPAGO_ACCESS_TOKEN nao configurado')) {
      return { status: 503, error: MP_CHECKOUT_UNAVAILABLE_MSG };
    }
    if (
      isMercadoPagoTokenErrorMessage(e.message) ||
      e.message.startsWith('MERCADOPAGO_ACCESS_TOKEN invalido')
    ) {
      return { status: 503, error: MP_TOKEN_INVALID_MSG };
    }
    return { status: 500, error: e.message };
  }
  return { status: 500, error: MP_CHECKOUT_UNAVAILABLE_MSG };
}
