import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./repositories/campaignsRepository.js', () => ({
  listCampaignLogs: vi.fn(),
}));

import { listCampaignLogs } from './repositories/campaignsRepository.js';
import { resolveUnsentStep0TargetsFromSnapshot } from './campaignRedispatchTargets.js';

describe('resolveUnsentStep0TargetsFromSnapshot', () => {
  beforeEach(() => {
    vi.mocked(listCampaignLogs).mockReset();
  });

  it('retorna contatos planejados que ainda não receberam mensagem', async () => {
    vi.mocked(listCampaignLogs).mockResolvedValue([
      {
        id: '1',
        tenant_id: 't1',
        campaign_id: 'c1',
        level: 'INFO',
        message: 'Mensagem enviada',
        payload: { campaignId: 'c1', to: '5511999999999', phoneDigits: '5511999999999' },
        created_at: new Date('2026-06-18T10:00:00Z'),
      },
    ] as never);

    const targets = await resolveUnsentStep0TargetsFromSnapshot('tenant-1', 'c1', {
      contactListId: '',
      totalContacts: 2,
      scheduleStartSnapshot: {
        numbers: ['5511999999999', '5521888888888'],
        message: 'oi',
      },
    });

    expect(targets).toEqual([{ phone: '5521888888888', stepIndex: 0 }]);
  });

  it('retorna vazio quando todos já foram enviados', async () => {
    vi.mocked(listCampaignLogs).mockResolvedValue([
      {
        id: '1',
        tenant_id: 't1',
        campaign_id: 'c1',
        level: 'INFO',
        message: 'Mensagem enviada',
        payload: { campaignId: 'c1', to: '5511999999999' },
        created_at: new Date(),
      },
    ] as never);

    const targets = await resolveUnsentStep0TargetsFromSnapshot('tenant-1', 'c1', {
      contactListId: '',
      totalContacts: 1,
      scheduleStartSnapshot: { numbers: ['5511999999999'], message: 'oi' },
    });

    expect(targets).toEqual([]);
  });
});
