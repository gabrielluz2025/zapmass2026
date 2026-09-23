import { describe, expect, it } from 'vitest';
import { leadBandFromScore, scoreDeltaForEvent } from './contactLeadScore.js';

describe('contactLeadScore', () => {
  it('soma deltas conhecidos', () => {
    expect(scoreDeltaForEvent('inbound_reply')).toBe(15);
    expect(scoreDeltaForEvent('opt_out')).toBe(-100);
  });

  it('classifica bandas', () => {
    expect(leadBandFromScore(0, false)).toBe('cold');
    expect(leadBandFromScore(30, false)).toBe('warm');
    expect(leadBandFromScore(60, false)).toBe('hot');
    expect(leadBandFromScore(99, true)).toBe('blocked');
  });
});
