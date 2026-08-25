import { describe, expect, it } from 'vitest';
import {
  computeGradualDelayMs,
  computeGradualRunAtMs,
  estimateJobRunAt,
  clampRunAtToAllowedWindow,
} from '../server/campaignGradualResume.js';
import { ChipCircuitBreaker } from '../server/chipCircuitBreaker.js';
import {
  applyCircuitWeightPenalty,
  pickPoolChannelByStrategy,
} from '../server/campaignPoolDispatch.js';
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
      respectNightWindow: false,
    });
    const d2 = computeGradualDelayMs({
      index: 2,
      nowMs: now,
      originalRunAtMs: now,
      spreadStepMs: 10_000,
      jitterMaxMs: 0,
      random: () => 0,
      respectNightWindow: false,
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
      respectNightWindow: false,
    });
    expect(d).toBe(tomorrow - now);
  });

  it('empurra jobs noturnos para após 8h BRT', () => {
    const MS_BR = 3 * 60 * 60 * 1000;
    const br = new Date(Date.UTC(2026, 0, 15, 23, 30, 0));
    const now = br.getTime() + MS_BR;
    const runAt = computeGradualRunAtMs({
      index: 0,
      nowMs: now,
      originalRunAtMs: now,
      spreadStepMs: 15_000,
      jitterMaxMs: 0,
      random: () => 0,
      respectNightWindow: true,
    });
    const brRun = new Date(runAt - MS_BR);
    expect(brRun.getUTCHours()).toBeGreaterThanOrEqual(8);
    expect(brRun.getUTCHours()).toBeLessThan(20);
  });
});

describe('clampRunAtToAllowedWindow', () => {
  it('mantém horário diurno', () => {
    const MS_BR = 3 * 60 * 60 * 1000;
    const day = new Date(Date.UTC(2026, 0, 15, 14, 0, 0)).getTime() + MS_BR;
    expect(clampRunAtToAllowedWindow(day, 5000, true)).toBe(day);
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

describe('campaignPoolDispatch', () => {
  it('penaliza peso em HALF_OPEN', () => {
    expect(applyCircuitWeightPenalty(10, 'HALF_OPEN')).toBe(5);
    expect(applyCircuitWeightPenalty(10, 'CLOSED')).toBe(10);
  });

  it('priority escolhe primeiro chip saudável', () => {
    expect(
      pickPoolChannelByStrategy({
        strategy: 'priority',
        healthyIds: ['a', 'b', 'c'],
        channelWeights: {},
        index: 5,
      })
    ).toBe('a');
  });

  it('weighted distribui por índice', () => {
    const pick = pickPoolChannelByStrategy({
      strategy: 'weighted',
      healthyIds: ['a', 'b'],
      channelWeights: { a: 1, b: 3 },
      index: 2,
    });
    expect(['a', 'b']).toContain(pick);
  });
});

describe('chipTrustScore', () => {
  it('tier 0A para chip crítico (0–2d)', () => {
    const now = Date.now();
    const p = resolveChipTier(now - 1 * 86_400_000, now);
    expect(p.tier).toBe('0A');
    expect(p.delayMultiplier).toBe(5);
    expect(p.suggestedDailyCap).toBe(20);
  });

  it('tier 0B para chip 3–7d', () => {
    const now = Date.now();
    const p = resolveChipTier(now - 5 * 86_400_000, now);
    expect(p.tier).toBe('0B');
    expect(p.delayMultiplier).toBe(3);
  });

  it('multiplica delay base no tier 0A', () => {
    const p = resolveChipTier(Date.now() - 1 * 86_400_000);
    expect(computeTierAdjustedDelay(20_000, p)).toBe(100_000);
  });
});

describe('computeComposingDelayMs', () => {
  it('limita entre 1.5s e 7s', async () => {
    const { computeComposingDelayMs } = await import('../server/campaignComposingDelay.js');
    expect(computeComposingDelayMs('')).toBe(1500);
    expect(computeComposingDelayMs('x'.repeat(200))).toBe(7000);
    expect(computeComposingDelayMs('x'.repeat(45))).toBe(3000);
  });
});
