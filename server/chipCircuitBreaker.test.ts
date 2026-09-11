import { describe, expect, it } from 'vitest';
import { ChipCircuitBreaker } from './chipCircuitBreaker.js';

describe('ChipCircuitBreaker.classifyCounts', () => {
  const cb = new ChipCircuitBreaker();

  it('CLOSED com poucas falhas e boa entrega', () => {
    const score = cb.classifyCounts(20, 18, 1);
    expect(score.state).toBe('CLOSED');
    expect(score.deliveryRatio).toBeCloseTo(0.9);
  });

  it('OPEN com muitas falhas 4xx', () => {
    expect(cb.classifyCounts(2, 0, 5).state).toBe('OPEN');
  });

  it('HALF_OPEN com taxa moderada de 4xx', () => {
    const score = cb.classifyCounts(10, 8, 2);
    expect(score.state).toBe('HALF_OPEN');
  });

  it('THROTTLED quando entrega cai sem muitos 4xx (soft-ban)', () => {
    const score = cb.classifyCounts(20, 8, 1);
    expect(score.state).toBe('THROTTLED');
    expect(score.deliveryRatio).toBeCloseTo(0.4);
  });

  it('OPEN tem prioridade sobre THROTTLED', () => {
    expect(cb.classifyCounts(20, 4, 6).state).toBe('OPEN');
  });

  it('delayMultiplier reflete THROTTLED e HALF_OPEN', () => {
    expect(cb.delayMultiplier(cb.classifyCounts(20, 8, 0))).toBeGreaterThan(2);
    expect(cb.delayMultiplier(cb.classifyCounts(10, 8, 2))).toBe(1.6);
    expect(cb.delayMultiplier(cb.classifyCounts(5, 5, 0))).toBe(1);
  });

  it('THROTTLED permanece utilizável; OPEN não', () => {
    const throttled = cb.classifyCounts(20, 8, 0);
    const open = cb.classifyCounts(2, 0, 5);
    expect(cb.isUsable(throttled)).toBe(true);
    expect(cb.isUsable(open)).toBe(false);
  });
});
