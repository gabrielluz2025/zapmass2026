import { describe, expect, it } from 'vitest';
import { classifyMercadoPagoHealth } from './mercadoPagoErrors.js';

describe('classifyMercadoPagoHealth', () => {
  it('token ausente', () => {
    expect(classifyMercadoPagoHealth({ configured: false, valid: false })).toBe('token_missing');
  });

  it('401 live', () => {
    expect(
      classifyMercadoPagoHealth({
        configured: true,
        valid: false,
        error: 'invalid access token'
      })
    ).toBe('token_invalid');
  });

  it('ok', () => {
    expect(classifyMercadoPagoHealth({ configured: true, valid: true })).toBe(null);
  });
});
