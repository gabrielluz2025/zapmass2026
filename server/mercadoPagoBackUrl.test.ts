import { describe, expect, it } from 'vitest';
import { assertMercadoPagoBackUrlForCheckout, isLocalUrl, resolveMercadoPagoBackUrl } from './mercadoPagoBackUrl.js';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('resolveMercadoPagoBackUrl', () => {
  it('prefers MERCADOPAGO_BACK_URL, then PUBLIC_APP_URL, then localhost', () => {
    expect(
      resolveMercadoPagoBackUrl(env({ MERCADOPAGO_BACK_URL: 'https://a.com/', PUBLIC_APP_URL: 'https://b.com' }))
    ).toBe('https://a.com');
    expect(resolveMercadoPagoBackUrl(env({ PUBLIC_APP_URL: 'https://b.com' }))).toBe('https://b.com');
    expect(resolveMercadoPagoBackUrl(env({}))).toBe('http://localhost:8000');
    expect(resolveMercadoPagoBackUrl(env({ MERCADOPAGO_BACK_URL: 'not a url' }))).toBe('http://localhost:8000');
  });
});

describe('assertMercadoPagoBackUrlForCheckout', () => {
  it('throws in production when only localhost is available', () => {
    expect(() => assertMercadoPagoBackUrlForCheckout(env({ NODE_ENV: 'production' }))).toThrow(/MERCADOPAGO_BACK_URL/);
  });

  it('accepts a public URL in production and localhost in development', () => {
    expect(
      assertMercadoPagoBackUrlForCheckout(env({ NODE_ENV: 'production', PUBLIC_APP_URL: 'https://zap-mass.com' }))
    ).toBe('https://zap-mass.com');
    expect(assertMercadoPagoBackUrlForCheckout(env({ NODE_ENV: 'development' }))).toBe('http://localhost:8000');
  });

  it('detects local hosts', () => {
    expect(isLocalUrl('http://127.0.0.1:3001')).toBe(true);
    expect(isLocalUrl('https://zap-mass.com')).toBe(false);
  });
});
