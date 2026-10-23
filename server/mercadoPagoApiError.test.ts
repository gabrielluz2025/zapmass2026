import { describe, expect, it } from 'vitest';
import { MercadoPagoApiError, billingRouteErrorPayload } from './mercadoPagoApiError.js';
import { MP_CHECKOUT_UNAVAILABLE_MSG, MP_TOKEN_INVALID_MSG } from '../shared/mercadoPagoErrors.js';

describe('billingRouteErrorPayload', () => {
  it('marca token ausente como mpIssue token_missing', () => {
    const r = billingRouteErrorPayload(new Error('MERCADOPAGO_ACCESS_TOKEN nao configurado no servidor.'));
    expect(r.status).toBe(503);
    expect(r.error).toBe(MP_CHECKOUT_UNAVAILABLE_MSG);
    expect(r.mpIssue).toBe('token_missing');
  });

  it('marca token malformado', () => {
    const r = billingRouteErrorPayload(
      new Error('MERCADOPAGO_ACCESS_TOKEN invalido: deve começar com APP_USR- (produção) ou TEST- (sandbox)')
    );
    expect(r.mpIssue).toBe('token_malformed');
    expect(r.error).toBe(MP_TOKEN_INVALID_MSG);
  });

  it('marca back_url em produção', () => {
    const r = billingRouteErrorPayload(
      new Error(
        'MERCADOPAGO_BACK_URL (ou PUBLIC_APP_URL) não configurada no servidor: defina a URL pública https://… para o checkout e o webhook do Mercado Pago.'
      )
    );
    expect(r.mpIssue).toBe('back_url');
    expect(r.error).toBe(MP_CHECKOUT_UNAVAILABLE_MSG);
  });

  it('marca 401 do MP como token_invalid', () => {
    const r = billingRouteErrorPayload(new MercadoPagoApiError(401, { message: 'invalid access token' }));
    expect(r.mpIssue).toBe('token_invalid');
    expect(r.error).toBe(MP_TOKEN_INVALID_MSG);
  });

  it('marca fetch failed como mp_unreachable', () => {
    const r = billingRouteErrorPayload(new Error('fetch failed calling Mercado Pago'));
    expect(r.status).toBe(503);
    expect(r.error).toBe(MP_CHECKOUT_UNAVAILABLE_MSG);
    expect(r.mpIssue).toBe('mp_unreachable');
  });
});
