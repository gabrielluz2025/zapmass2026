import { describe, expect, it } from 'vitest';
import { mergePersistedFunnelStats } from './dashboardFunnelMetrics';

describe('mergePersistedFunnelStats', () => {
  it('sanitiza funil monotônico sem geo de campanha', () => {
    expect(
      mergePersistedFunnelStats({
        totalSent: 100,
        totalDelivered: 80,
        totalRead: 50,
        totalReplied: 12
      })
    ).toEqual({
      totalSent: 100,
      totalDelivered: 80,
      totalRead: 50,
      totalReplied: 12
    });
  });

  it('promove entregue/lida quando há respostas sem ack de leitura', () => {
    expect(
      mergePersistedFunnelStats({
        totalSent: 10,
        totalDelivered: 2,
        totalRead: 0,
        totalReplied: 5
      })
    ).toEqual({
      totalSent: 10,
      totalDelivered: 5,
      totalRead: 5,
      totalReplied: 5
    });
  });
});
