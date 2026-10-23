import { describe, expect, it } from 'vitest';
import {
  sanitizeMarketingPriceLabel,
  validateCommercialConfigPartial,
  parseTrialHoursInput
} from './commercialConfigValidation';

describe('commercialConfigValidation', () => {
  it('sanitiza preço de marketing', () => {
    expect(sanitizeMarketingPriceLabel('  R$ 49,90 \n / mês  ')).toBe('R$ 49,90 / mês');
  });

  it('valida trial 1–168', () => {
    expect(parseTrialHoursInput('0')).toBe(1);
    expect(parseTrialHoursInput('169')).toBe(168);
    expect(parseTrialHoursInput('abc')).toBeNull();
  });

  it('rejeita corpo vazio', () => {
    const r = validateCommercialConfigPartial({});
    expect(r.ok).toBe(false);
  });

  it('aceita payload parcial válido', () => {
    const r = validateCommercialConfigPartial({ trialHours: 24 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.trialHours).toBe(24);
  });
});
