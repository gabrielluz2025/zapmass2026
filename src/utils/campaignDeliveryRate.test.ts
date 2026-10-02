import { describe, expect, it } from 'vitest';
import { CampaignStatus } from '../types';
import type { Campaign } from '../types';
import {
  computeCampaignDeliveriesPerHour,
  computeCampaignThroughputPerHour,
  getCampaignCardFunnelMetrics,
  resolveCampaignDispatchWindow
} from './campaignDeliveryRate';

const baseCampaign = (over: Partial<Campaign> = {}): Campaign =>
  ({
    id: 'c1',
    name: 'Teste',
    message: 'oi',
    totalContacts: 10,
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    status: CampaignStatus.RUNNING,
    selectedConnectionIds: [],
    createdAt: '2026-10-02T10:00:00.000Z',
    ...over
  }) as Campaign;

describe('resolveCampaignDispatchWindow', () => {
  it('usa lastRunAt como fim em campanha concluída', () => {
    const c = baseCampaign({
      status: CampaignStatus.COMPLETED,
      createdAt: '2026-10-02T10:00:00.000Z',
      lastRunAt: '2026-10-02T12:00:00.000Z'
    });
    const w = resolveCampaignDispatchWindow(c, Date.parse('2026-10-02T15:00:00.000Z'));
    expect(w).toEqual({
      startMs: Date.parse('2026-10-02T10:00:00.000Z'),
      endMs: Date.parse('2026-10-02T12:00:00.000Z')
    });
  });
});

describe('computeCampaignDeliveriesPerHour', () => {
  it('calcula média em 2 horas', () => {
    const rate = computeCampaignDeliveriesPerHour(200, {
      startMs: 0,
      endMs: 2 * 3_600_000
    });
    expect(rate).toBe(100);
  });
});

describe('getCampaignCardFunnelMetrics', () => {
  it('não trata successCount como entregue sem relatório', () => {
    const c = baseCampaign({ successCount: 40, processedCount: 40 });
    expect(getCampaignCardFunnelMetrics(c).delivered).toBe(0);
    expect(getCampaignCardFunnelMetrics(c).sent).toBe(40);
  });

  it('usa totals do reportSnapshot', () => {
    const c = baseCampaign({
      reportSnapshot: {
        builtAt: '',
        logCount: 0,
        rows: [],
        replyPhones: {},
        stageFunnels: [],
        totals: { sent: 50, delivered: 45, read: 20, replied: 5 }
      }
    });
    expect(getCampaignCardFunnelMetrics(c).delivered).toBe(45);
  });
});

describe('computeCampaignThroughputPerHour', () => {
  it('prefere entregues e cai para enviados ok', () => {
    const c = baseCampaign({
      createdAt: '2026-10-02T10:00:00.000Z',
      lastRunAt: '2026-10-02T11:00:00.000Z',
      status: CampaignStatus.COMPLETED
    });
    expect(computeCampaignThroughputPerHour(c, { delivered: 60, sentOk: 80 })).toBe(60);
    expect(computeCampaignThroughputPerHour(c, { delivered: 0, sentOk: 30 })).toBe(30);
  });
});
