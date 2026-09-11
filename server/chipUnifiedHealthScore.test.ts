import { describe, expect, it } from 'vitest';
import {
  composeUnifiedHealth,
  computeBidirectionalScore,
  computeCircuitScore,
  computeMaturityScore,
  unifiedDelayMultiplier,
  unifiedPoolWeightMultiplier,
} from './chipUnifiedHealthScore.js';
import { ChipCircuitBreaker } from './chipCircuitBreaker.js';

const cb = new ChipCircuitBreaker();
const DAY = 86_400_000;
const now = Date.now();

describe('chipUnifiedHealthScore', () => {
  it('chip novo tem maturidade baixa; chip antigo alta', () => {
    expect(computeMaturityScore(now - DAY)).toBeLessThan(40);
    expect(computeMaturityScore(now - 30 * DAY)).toBeGreaterThan(80);
  });

  it('circuit OPEN zera sub-score; THROTTLED fica intermediário', () => {
    expect(computeCircuitScore(cb.classifyCounts(2, 0, 5))).toBe(0);
    expect(computeCircuitScore(cb.classifyCounts(20, 8, 0))).toBe(52);
    expect(computeCircuitScore(cb.classifyCounts(20, 18, 0))).toBeGreaterThan(85);
  });

  it('bidirecional premia taxa de resposta', () => {
    expect(computeBidirectionalScore(100, 50)).toBe(100);
    expect(computeBidirectionalScore(100, 5)).toBeLessThan(50);
  });

  it('score composto reflete faixas e multiplicadores', () => {
    const young = composeUnifiedHealth({
      connectedSinceMs: now - DAY,
      circuit: cb.classifyCounts(20, 18, 0),
      sentWindow: 20,
      inboundWindow: 8,
      hasProxy: true,
      proxyStatus: 'OK',
    });
    expect(young.score).toBeGreaterThanOrEqual(50);
    expect(young.delayMultiplier).toBeGreaterThanOrEqual(1);

    const critical = composeUnifiedHealth({
      connectedSinceMs: now - DAY,
      circuit: cb.classifyCounts(20, 4, 6),
      inQuarantine: true,
      banCount: 2,
    });
    expect(critical.score).toBeLessThan(30);
    expect(critical.usable).toBe(false);
    expect(unifiedPoolWeightMultiplier(critical.score, critical.circuitState)).toBe(0);
  });

  it('multiplicadores seguem bandas acordadas', () => {
    expect(unifiedDelayMultiplier(90)).toBe(1);
    expect(unifiedDelayMultiplier(65)).toBe(1.5);
    expect(unifiedDelayMultiplier(40)).toBe(2.5);
    expect(unifiedDelayMultiplier(20)).toBe(4);
  });
});
