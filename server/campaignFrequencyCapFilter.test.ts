import { describe, expect, it } from 'vitest';
import {
  applyFrequencyCapAllowList,
  normalizeFrequencyCapAllowKeys,
  phoneKeyForFrequencyCap,
} from './campaignFrequencyCapFilter.js';

describe('campaignFrequencyCapFilter', () => {
  it('applyFrequencyCapAllowList remove chaves autorizadas', () => {
    const keyA = phoneKeyForFrequencyCap('5547999127001');
    const blocked = new Set([keyA, '988776655']);
    const allow = normalizeFrequencyCapAllowKeys(['5547999127001']);
    const next = applyFrequencyCapAllowList(blocked, allow);
    expect(next.has(keyA)).toBe(false);
    expect(next.has('988776655')).toBe(true);
  });
});
