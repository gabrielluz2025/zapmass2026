import { describe, expect, it } from 'vitest';
import {
  aggregateChipHealthSummary,
  distributionBucketForScore,
} from './chipHealthSummaryService.js';

describe('chipHealthSummaryService', () => {
  it('classifica faixas de score', () => {
    expect(distributionBucketForScore(95)).toBe('excellent');
    expect(distributionBucketForScore(80)).toBe('excellent');
    expect(distributionBucketForScore(65)).toBe('regular');
    expect(distributionBucketForScore(50)).toBe('regular');
    expect(distributionBucketForScore(40)).toBe('degraded');
    expect(distributionBucketForScore(30)).toBe('degraded');
    expect(distributionBucketForScore(15)).toBe('critical');
  });

  it('agrega distribuição, média e status', () => {
    const summary = aggregateChipHealthSummary([
      { score: 90, band: 'excellent', circuitState: 'CLOSED', inQuarantine: false, proxyStatus: 'OK' },
      { score: 85, band: 'excellent', circuitState: 'CLOSED', inQuarantine: false, proxyStatus: 'OK' },
      { score: 60, band: 'good', circuitState: 'HALF_OPEN', inQuarantine: false, proxyStatus: 'OK' },
      { score: 35, band: 'caution', circuitState: 'THROTTLED', inQuarantine: false, proxyStatus: 'DRIFT' },
      { score: 20, band: 'critical', circuitState: 'OPEN', inQuarantine: true, proxyStatus: 'PROXY_DOWN' },
    ]);

    expect(summary.totalChips).toBe(5);
    expect(summary.averageScore).toBe(58);
    expect(summary.distribution).toEqual({
      excellent: 2,
      regular: 1,
      degraded: 1,
      critical: 1,
    });
    expect(summary.statusCounts).toEqual({
      throttled: 1,
      openCircuit: 1,
      proxyDown: 1,
      quarantine: 1,
    });
    expect(summary.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('pool vazio retorna zeros', () => {
    const summary = aggregateChipHealthSummary([]);
    expect(summary.totalChips).toBe(0);
    expect(summary.averageScore).toBe(0);
    expect(summary.distribution.critical).toBe(0);
  });
});
