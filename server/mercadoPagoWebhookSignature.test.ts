import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import {
  buildMercadoPagoSignatureManifest,
  verifyMercadoPagoWebhookSignature
} from './mercadoPagoWebhookSignature.js';

describe('Mercado Pago webhook signature', () => {
  it('hmac válido coincide com manifest oficial', () => {
    const secret = 'sekret-de-testes';
    const ts = '1700000000';
    const requestId = 'req-abc';
    const dataId = '12345678';
    const manifest = buildMercadoPagoSignatureManifest({
      dataId,
      requestId,
      ts
    });
    const v1 = crypto.createHmac('sha256', secret).update(manifest, 'utf8').digest('hex');

    const req = {
      headers: {
        'x-signature': `ts=${ts},v1=${v1}`,
        'x-request-id': requestId
      },
      query: {}
    } as any;

    const body = {
      type: 'payment',
      data: { id: dataId }
    };

    expect(verifyMercadoPagoWebhookSignature(req, body, secret)).toEqual({ ok: true });
  });

  it('rejeita assinatura adulterada', () => {
    const secret = 'sekret-de-testes';
    const ts = '1700000000';
    const requestId = 'req-abc';
    const manifest = buildMercadoPagoSignatureManifest({
      dataId: '999',
      requestId,
      ts
    });
    const v1wrong = crypto
      .createHmac('sha256', secret + 'x')
      .update(manifest, 'utf8')
      .digest('hex');

    const req = {
      headers: {
        'x-signature': `ts=${ts},v1=${v1wrong}`,
        'x-request-id': requestId
      },
      query: {}
    } as any;

    const body = { data: { id: '999' } };

    expect(verifyMercadoPagoWebhookSignature(req, body, secret).ok).toBe(false);
  });
});
