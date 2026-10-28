import { describe, expect, it } from 'vitest';
import { validateBillingPricingPut } from './billingPricingConfig';

describe('billingPricingConfig', () => {
  it('aceita matriz completa de tiers', () => {
    const r = validateBillingPricingPut({
      channelTiersMonthly: { 1: 149.9, 2: 249.9, 3: 329.9, 4: 399.9, 5: 459.9 },
      channelTiersAnnual: { 1: 1529, 2: 2549, 3: 3365, 4: 4079, 5: 4691 },
      channelAddonMonthly: 100
    });
    expect(r.ok).toBe(true);
  });

  it('rejeita valor fora do intervalo', () => {
    const r = validateBillingPricingPut({
      channelTiersMonthly: { 1: 0 },
      channelAddonMonthly: 50
    });
    expect(r.ok).toBe(false);
  });
});
