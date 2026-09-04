import { describe, expect, it } from 'vitest';
import { pickOrphanJobCampaignTarget } from './campaignOrphanJobs.js';

describe('pickOrphanJobCampaignTarget', () => {
  it('anexa à única campanha do tenant', () => {
    expect(
      pickOrphanJobCampaignTarget([{ id: 'f3f9b011-13a6-4b10-8442-83782d6a8379', status: 'DRAFT' }])
    ).toBe('f3f9b011-13a6-4b10-8442-83782d6a8379');
  });

  it('prefere a campanha viva quando a outra já terminou', () => {
    expect(
      pickOrphanJobCampaignTarget([
        { id: 'done', status: 'COMPLETED' },
        { id: 'live', status: 'DRAFT' },
      ])
    ).toBe('live');
  });

  it('não adivinha com duas campanhas ativas', () => {
    expect(
      pickOrphanJobCampaignTarget([
        { id: 'a', status: 'DRAFT' },
        { id: 'b', status: 'RUNNING' },
      ])
    ).toBeNull();
  });

  it('retorna null sem campanhas', () => {
    expect(pickOrphanJobCampaignTarget([])).toBeNull();
  });
});
