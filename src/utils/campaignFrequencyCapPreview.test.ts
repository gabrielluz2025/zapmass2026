import { describe, expect, it } from 'vitest';
import {
  computeDispatchableAfterFreqCap,
  triageRecipientsForFreqCap,
  frequencyCapAllowPhonesFromTriaged,
  phoneKeyForFreqPreview,
} from './campaignFrequencyCapPreview';

describe('computeDispatchableAfterFreqCap', () => {
  it('soma liberados + capped marcados para reenvio', () => {
    const n = computeDispatchableAfterFreqCap({
      contactCount: 5,
      cappedCount: 2,
      selectedCappedKeys: new Set(['999111111']),
      largeBaseSkipClientCap: false,
    });
    expect(n).toBe(4);
  });

  it('base grande ignora triagem no cliente', () => {
    expect(
      computeDispatchableAfterFreqCap({
        contactCount: 2000,
        cappedCount: 0,
        selectedCappedKeys: new Set(),
        largeBaseSkipClientCap: true,
      })
    ).toBe(2000);
  });
});

describe('triageRecipientsForFreqCap', () => {
  it('marca capped pelo phoneKey de 11 dígitos', () => {
    const { triaged, cappedCount } = triageRecipientsForFreqCap(
      [{ phone: '5547999127001', name: 'Gabriel', vars: {} }],
      [{ phoneKey: '47999127001', capped: true, lastSentAt: '2026-10-02T10:00:00.000Z' }]
    );
    expect(cappedCount).toBe(1);
    expect(triaged[0].capped).toBe(true);
  });
});

describe('frequencyCapAllowPhonesFromTriaged', () => {
  it('só inclui capped marcados para reenvio', () => {
    const key = phoneKeyForFreqPreview('5547999907319');
    const phones = frequencyCapAllowPhonesFromTriaged(
      [
        { phone: '5547999127001', capped: true },
        { phone: '5547999907319', capped: true },
      ],
      new Set([key])
    );
    expect(phones).toEqual(['5547999907319']);
  });
});
