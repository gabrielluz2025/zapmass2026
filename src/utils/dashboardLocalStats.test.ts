import { describe, it, expect } from 'vitest';
import { CampaignStatus } from '../types';
import type { Campaign } from '../types';
import {
  computeDailyBreakdownFromServer,
  computeDailySendsFromCampaigns,
  formatSendDayTooltip,
  getDailySendSeriesLastNDays,
  mergeDailySendCount
} from './dashboardLocalStats';

const base = (over: Partial<Campaign>): Campaign =>
  ({
    id: '1',
    name: 'Test',
    message: '',
    totalContacts: 10,
    processedCount: 10,
    successCount: 0,
    failedCount: 0,
    status: CampaignStatus.COMPLETED,
    selectedConnectionIds: [],
    createdAt: '2026-06-01T10:00:00.000Z',
    ...over
  }) as Campaign;

describe('computeDailySendsFromCampaigns', () => {
  it('usa successCount no dia de lastRunAt quando não há logs', () => {
    const runAt = new Date(2026, 5, 5, 10, 0, 0);
    const dk = `${runAt.getFullYear()}-${String(runAt.getMonth() + 1).padStart(2, '0')}-${String(runAt.getDate()).padStart(2, '0')}`;
    const c = base({
      successCount: 42,
      lastRunAt: runAt.toISOString()
    });
    const m = computeDailySendsFromCampaigns([c]);
    expect(m.get(dk)).toBe(42);
  });

  it('conta logs SUCCESS por dia', () => {
    const c = base({
      logs: [
        { id: '1', type: 'SUCCESS', message: 'ok', timestamp: new Date('2026-06-07T12:00:00Z') },
        { id: '2', type: 'SUCCESS', message: 'ok', timestamp: new Date('2026-06-07T13:00:00Z') },
        { id: '3', type: 'ERROR', message: 'x', timestamp: new Date('2026-06-07T14:00:00Z') }
      ]
    });
    const m = computeDailySendsFromCampaigns([c]);
    expect(m.get('2026-06-07')).toBe(2);
  });

  it('formatSendDayTooltip em linguagem simples', () => {
    const tip = formatSendDayTooltip('2026-06-04', 10, {
      total: 10,
      campaigns: [{ name: 'Promoção', count: 10 }]
    });
    expect(tip).toContain('10 mensagens');
    expect(tip).toContain('Promoção');
  });

  it('mergeDailySendCount prioriza contagem do servidor', () => {
    const server = new Map([['2026-06-04', 12]]);
    const campaign = new Map([['2026-06-04', 251]]);
    expect(mergeDailySendCount('2026-06-04', server, campaign, {})).toBe(12);
    expect(mergeDailySendCount('2026-06-05', server, campaign, {})).toBe(0);
  });

  it('computeDailyBreakdownFromServer resolve nome da campanha', () => {
    const c = base({ id: 'camp-1', name: 'Black Friday' });
    const map = computeDailyBreakdownFromServer([c], {
      '2026-06-04': { 'camp-1': 3 }
    });
    expect(map.get('2026-06-04')?.campaigns[0]).toEqual({ name: 'Black Friday', count: 3 });
  });

  it('getDailySendSeriesLastNDays usa servidor quando disponível', () => {
    const today = new Date();
    const dk = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const server = new Map([[dk, 5]]);
    const series = getDailySendSeriesLastNDays(undefined, 1, undefined, server);
    expect(series).toHaveLength(1);
    expect(series[0].count).toBe(5);
  });
});
