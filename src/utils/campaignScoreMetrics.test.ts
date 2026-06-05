import { describe, expect, it } from 'vitest';
import { computeCampaignScore, effectiveSpeedPct } from './campaignScoreMetrics';

describe('effectiveSpeedPct', () => {
  it('fluxo por resposta com 1 contato e resposta não penaliza espera (throughput baixo)', () => {
    const pct = effectiveSpeedPct(
      { throughputPerMin: 0.1, replyFlowMode: true, plannedContacts: 1 },
      1,
      1
    );
    expect(pct).toBe(1);
  });

  it('disparo em massa mantém penalidade por throughput', () => {
    const pct = effectiveSpeedPct(
      { throughputPerMin: 0.1, replyFlowMode: true, plannedContacts: 500 },
      400,
      0.2
    );
    expect(pct).toBeCloseTo(0.025, 3);
  });

  it('sem fluxo por resposta usa só throughput', () => {
    const pct = effectiveSpeedPct(
      { throughputPerMin: 2, replyFlowMode: false, plannedContacts: 10 },
      10,
      1
    );
    expect(pct).toBe(0.5);
  });
});

describe('computeCampaignScore', () => {
  it('teste 9: 1 contato, 100% funil → score 100', () => {
    const { score } = computeCampaignScore({
      delivered: 1,
      read: 1,
      replied: 1,
      sent: 1,
      throughputPerMin: 0.1,
      failed: 0,
      plannedContacts: 1,
      replyFlowMode: true
    });
    expect(score).toBe(100);
  });
});
