import { describe, expect, it } from 'vitest';
import { buildDashboardActivityFeed, isNoiseSystemLog } from './dashboardActivityFeed';
import { CampaignStatus } from '../types';

describe('dashboardActivityFeed', () => {
  it('ignora logs técnicos de socket', () => {
    expect(isNoiseSystemLog({ event: 'socket:connected', timestamp: '2026-01-01T00:00:00Z', payload: {} })).toBe(true);
    expect(isNoiseSystemLog({ event: 'socket:sync-connections', timestamp: '2026-01-01T00:00:00Z', payload: {} })).toBe(
      true
    );
    expect(
      isNoiseSystemLog({
        event: 'campaign:log',
        timestamp: '2026-01-01T00:00:00Z',
        payload: { message: 'Campanha iniciada' }
      })
    ).toBe(false);
  });

  it('usa campanhas quando só há ruído nos logs', () => {
    const feed = buildDashboardActivityFeed(
      [{ event: 'socket:connected', timestamp: '2026-06-01T12:00:00Z', payload: {} }],
      [
        {
          id: 'c1',
          name: 'Promo verão',
          status: CampaignStatus.RUNNING,
          successCount: 42,
          createdAt: '2026-06-01T10:00:00Z',
          lastRunAt: '2026-06-01T11:00:00Z'
        } as never
      ],
      3
    );
    expect(feed.length).toBeGreaterThan(0);
    expect(feed[0].title).toBe('Campanha em disparo');
    expect(feed[0].sub).toContain('Promo verão');
  });
});
