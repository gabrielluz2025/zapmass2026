import { describe, expect, it } from 'vitest';
import {
  applyFrequencyCapAllowList,
  normalizeFrequencyCapAllowKeys,
  phoneKeyForFrequencyCap,
  shouldBypassFrequencyCap,
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

  it('shouldBypassFrequencyCap respeita skip global e allow list', () => {
    const allow = normalizeFrequencyCapAllowKeys(['5547999127001']);
    expect(shouldBypassFrequencyCap('5547999127001', { skipFrequencyCap: false, allowKeys: allow })).toBe(
      true
    );
    expect(shouldBypassFrequencyCap('5547999887766', { skipFrequencyCap: false, allowKeys: allow })).toBe(
      false
    );
    expect(shouldBypassFrequencyCap('5547999887766', { skipFrequencyCap: true, allowKeys: allow })).toBe(
      true
    );
  });
});
