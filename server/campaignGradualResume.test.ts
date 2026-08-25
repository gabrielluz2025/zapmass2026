import { describe, expect, it } from 'vitest';
import { computeGradualDelayMs, estimateJobRunAt } from '../server/campaignGradualResume.js';
import { ChipCircuitBreaker } from '../server/chipCircuitBreaker.js';
import { computeTierAdjustedDelay, resolveChipTier } from '../server/chipTrustScore.js';

describe('computeGradualDelayMs', () => {
  it('espalha jobs imediatos linearmente', () => {
    const now = 1_000_000;
    const d0 = computeGradualDelayMs({
      index: 0,
      nowMs: now,
      originalRunAtMs: now,
      spreadStepMs: 10_000,
      jitterMaxMs: 0,
      random: () => 0,
    });
    const d2 = computeGradualDelayMs({
      index: 2,
      nowMs: now,
      originalRunAtMs: now,
      spreadStepMs: 10_000,
      jitterMaxMs: 0,
      random: () => 0,
    });
    expect(d0).toBe(0);
    expect(d2).toBe(20_000);
  });

  it('preserva agendamento futuro', () => {
    const now = 1_000_000;
    const tomorrow = now + 86_400_000;
    const d = computeGradualDelayMs({
      index: 0,
      nowMs: now,
      originalRunAtMs: tomorrow,
      spreadStepMs: 10_000,
      jitterMaxMs: 0,
      random: () => 0,
    });
    expect(d).toBe(tomorrow - now);
  });
});

describe('estimateJobRunAt', () => {
  it('soma timestamp + delay', () => {
    expect(estimateJobRunAt({ timestamp: 1000, opts: { delay: 5000 } })).toBe(6000);
  });
});

describe('ChipCircuitBreaker.classifyCounts', () => {
  const cb = new ChipCircuitBreaker();

  it('CLOSED com poucas falhas', () => {
    expect(cb.classifyCounts(20, 18, 1).state).toBe('CLOSED');
  });

  it('OPEN com muitas falhas 4xx', () => {
    expect(cb.classifyCounts(2, 0, 5).state).toBe('OPEN');
  });

  it('HALF_OPEN com taxa moderada', () => {
    const score = cb.classifyCounts(10, 8, 2);
    expect(score.state).toBe('HALF_OPEN');
  });
});

describe('chipTrustScore', () => {
  it('tier 0 para chip novo', () => {
    const now = Date.now();
    const p = resolveChipTier(now - 2 * 86_400_000, now);
    expect(p.tier).toBe(0);
    expect(p.delayMultiplier).toBe(3);
  });

  it('multiplica delay base', () => {
    const p = resolveChipTier(Date.now() - 3 * 86_400_000);
    expect(computeTierAdjustedDelay(20_000, p)).toBe(60_000);
  });
});
