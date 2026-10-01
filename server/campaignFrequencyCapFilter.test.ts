import { describe, expect, it } from 'vitest';
import {
  buildFrequencyCapBlockSet,
  isPhoneBlockedByFrequencyCap,
} from './campaignFrequencyCapFilter.js';

describe('campaignFrequencyCapFilter', () => {
  it('monta set só com phoneKey capped', () => {
    const blocked = buildFrequencyCapBlockSet([
      { phoneKey: '99999999999', capped: true },
      { phoneKey: '88888888888', capped: false },
    ]);
    expect(blocked.size).toBe(1);
    expect(blocked.has('99999999999')).toBe(true);
  });

  it('detecta bloqueio pelos últimos 11 dígitos', () => {
    const blocked = buildFrequencyCapBlockSet([{ phoneKey: '47999827888', capped: true }]);
    expect(isPhoneBlockedByFrequencyCap('5547999827888', blocked)).toBe(true);
    expect(isPhoneBlockedByFrequencyCap('5547111111111', blocked)).toBe(false);
  });
});
