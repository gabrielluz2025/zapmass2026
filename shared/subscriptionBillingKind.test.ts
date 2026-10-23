import { describe, expect, it } from 'vitest';
import {
  classifySubscriptionBilling,
  hasMercadoPagoSubscription,
  resolveManualGrantKind
} from './subscriptionBillingKind.js';

describe('subscriptionBillingKind', () => {
  it('identifica assinatura MP ativa', () => {
    const doc = {
      status: 'active',
      provider: 'mercadopago',
      mercadoPagoPreapprovalId: 'pre_1',
      manualGrant: false
    };
    expect(hasMercadoPagoSubscription(doc)).toBe(true);
    expect(classifySubscriptionBilling(doc)).toBe('mercadopago');
  });

  it('manual grant com MP id não conta como MP se manualGrant=true', () => {
    const doc = {
      status: 'active',
      provider: 'mercadopago',
      mercadoPagoPreapprovalId: 'pre_1',
      manualGrant: true,
      adminNote: 'cortesia parceiro'
    };
    expect(classifySubscriptionBilling(doc)).toBe('manual_bonus');
  });

  it('manual cobrado via manualGrantKind', () => {
    expect(
      classifySubscriptionBilling({
        status: 'active',
        manualGrant: true,
        manualGrantKind: 'paid_external'
      })
    ).toBe('manual_paid');
  });

  it('heurística de nota para cobrado externo', () => {
    expect(resolveManualGrantKind({ adminNote: 'Cliente pagou via PIX' })).toBe('paid_external');
    expect(resolveManualGrantKind({ adminNote: 'Cortesia degustação' })).toBe('bonus');
    expect(resolveManualGrantKind({ adminNote: '' })).toBe('bonus');
  });
});
