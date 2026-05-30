import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMercadoPagoAccessTokenCacheForTests,
  getMercadoPagoAccessToken,
  normalizeMercadoPagoAccessToken,
  validateMercadoPagoAccessTokenShape
} from './mercadoPagoAccess.js';

describe('normalizeMercadoPagoAccessToken', () => {
  it('remove aspas, Bearer, BOM e quebras de linha', () => {
    const raw = '\uFEFF"Bearer APP_USR-1234567890123456789012345678901234567890"\r\n';
    expect(normalizeMercadoPagoAccessToken(raw)).toBe(
      'APP_USR-1234567890123456789012345678901234567890'
    );
  });

  it('aceita token TEST- sem aspas', () => {
    const t = 'TEST-1234567890123456789012345678901234567890';
    expect(normalizeMercadoPagoAccessToken(t)).toBe(t);
  });
});

describe('validateMercadoPagoAccessTokenShape', () => {
  it('rejeita prefixo inválido', () => {
    const r = validateMercadoPagoAccessTokenShape('PUBLIC_KEY-abc');
    expect(r.ok).toBe(false);
  });

  it('aceita APP_USR longo', () => {
    const t = 'APP_USR-' + 'x'.repeat(60);
    expect(validateMercadoPagoAccessTokenShape(t).ok).toBe(true);
  });
});

describe('getMercadoPagoAccessToken', () => {
  afterEach(() => {
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    clearMercadoPagoAccessTokenCacheForTests();
  });

  it('lê token da env já normalizado', () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN =
      '"APP_USR-' + 'y'.repeat(60) + '"';
    expect(getMercadoPagoAccessToken()?.startsWith('APP_USR-')).toBe(true);
    expect(getMercadoPagoAccessToken()?.includes('"')).toBe(false);
  });
});
