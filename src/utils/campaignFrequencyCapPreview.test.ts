import { describe, expect, it } from 'vitest';
import { computeDispatchableAfterFreqCap } from './campaignFrequencyCapPreview';

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
