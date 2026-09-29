import { describe, expect, it } from 'vitest';
import {
  computeHumanizeGapMs,
  computeHumanizePresenceDelayMs,
  getGaussianDelayMs,
  getMicroRestDelayMs,
} from './campaignHumanizePipeline.js';

describe('campaignHumanizePipeline', () => {
  it('getGaussianDelayMs respeita intervalo min/max', () => {
    for (let i = 0; i < 200; i++) {
      const v = getGaussianDelayMs(3000, 9000, 1);
      expect(v).toBeGreaterThanOrEqual(3000);
      expect(v).toBeLessThanOrEqual(9000);
    }
  });

  it('getGaussianDelayMs aplica multiplicador de tier/circuit breaker', () => {
    const base = getGaussianDelayMs(1000, 1000, 1);
    const scaled = getGaussianDelayMs(1000, 1000, 2.5);
    expect(base).toBe(1000);
    expect(scaled).toBe(2500);
  });

  it('computeHumanizePresenceDelayMs limita texto e mídia', () => {
    expect(computeHumanizePresenceDelayMs('text', 0)).toBe(1500);
    expect(computeHumanizePresenceDelayMs('text', 500)).toBe(12000);
    expect(computeHumanizePresenceDelayMs('media', 0)).toBe(2000);
    expect(computeHumanizePresenceDelayMs('media', 500)).toBe(8000);
  });

  it('computeHumanizeGapMs soma composing e gaussiana sem dormir', () => {
    const gap = computeHumanizeGapMs({
      chipId: 'c1',
      phone: '5511999999999',
      messageType: 'text',
      contentLength: 0,
      minDelayMs: 15000,
      maxDelayMs: 45000,
      tierMultiplier: 1,
    });
    expect(gap.presenceMs).toBe(1500);
    expect(gap.waitMs).toBeGreaterThanOrEqual(1500 + 15000);
    expect(gap.waitMs).toBeLessThanOrEqual(1500 + 45000);
  });

  it('getMicroRestDelayMs fica entre 10 e 20 minutos', () => {
    for (let i = 0; i < 50; i++) {
      const ms = getMicroRestDelayMs();
      expect(ms).toBeGreaterThanOrEqual(10 * 60_000);
      expect(ms).toBeLessThanOrEqual(20 * 60_000);
    }
  });
});
