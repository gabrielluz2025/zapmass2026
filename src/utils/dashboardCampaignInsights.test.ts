import { describe, it, expect } from 'vitest';
import { CampaignStatus } from '../types';
import type { Campaign } from '../types';
import { computeCampaignRadar } from './dashboardCampaignInsights';

const baseCampaign = (over: Partial<Campaign>): Campaign =>
  ({
    id: 'x',
    name: 'Test',
    message: '',
    totalContacts: 10,
    processedCount: 10,
    successCount: 10,
    failedCount: 0,
    status: CampaignStatus.COMPLETED,
    selectedConnectionIds: [],
    createdAt: new Date().toISOString(),
    ...over
  }) as Campaign;

describe('computeCampaignRadar', () => {
  it('retorna vazio sem campanhas', () => {
    const r = computeCampaignRadar([]);
    expect(r.lastTouched).toBeNull();
    expect(r.bestSuccess).toBeNull();
    expect(r.nextScheduled).toBeNull();
  });

  it('escolhe próximo agendamento mais cedo', () => {
    const c1 = baseCampaign({
      id: '1',
      name: 'A',
      status: CampaignStatus.SCHEDULED,
      nextRunAt: '2026-06-10T12:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    const c2 = baseCampaign({
      id: '2',
      name: 'B',
      status: CampaignStatus.SCHEDULED,
      nextRunAt: '2026-06-01T12:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z'
    });
    const r = computeCampaignRadar([c1, c2]);
    expect(r.nextScheduled?.campaign.id).toBe('2');
  });

  it('melhor sucesso entre concluídas', () => {
    const low = baseCampaign({
      id: 'l',
      name: 'Low',
      successCount: 5,
      failedCount: 5,
      processedCount: 10,
      totalContacts: 1
    });
    const high = baseCampaign({
      id: 'h',
      name: 'High',
      successCount: 9,
      failedCount: 1,
      processedCount: 10,
      totalContacts: 1
    });
    const r = computeCampaignRadar([low, high]);
    expect(r.bestSuccess?.id).toBe('h');
    expect(r.bestSuccessPct).toBeGreaterThanOrEqual(90);
  });
});
