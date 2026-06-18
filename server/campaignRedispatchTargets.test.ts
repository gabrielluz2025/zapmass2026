import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./repositories/campaignsRepository.js', () => ({
  listCampaignLogs: vi.fn(),
}));

vi.mock('./repositories/contactListsRepository.js', () => ({
  getContactListById: vi.fn(),
}));

vi.mock('./db/postgres.js', () => ({
  getZapmassPool: vi.fn(),
}));

import { getZapmassPool } from './db/postgres.js';
import { getContactListById } from './repositories/contactListsRepository.js';
import { listCampaignLogs } from './repositories/campaignsRepository.js';
import { resolveUnsentStep0TargetsFromSnapshot } from './campaignRedispatchTargets.js';

describe('resolveUnsentStep0TargetsFromSnapshot', () => {
  beforeEach(() => {
    vi.mocked(listCampaignLogs).mockReset();
    vi.mocked(getContactListById).mockReset();
    vi.mocked(getZapmassPool).mockReset();
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

  it('usa contactListId quando snapshot ausente (disparo imediato)', async () => {
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
    vi.mocked(getContactListById).mockResolvedValue({
      id: 'list1',
      name: 'Lista',
      contactIds: ['c1', 'c2'],
    } as never);
    vi.mocked(getZapmassPool).mockReturnValue({
      query: vi.fn().mockResolvedValue({
        rows: [{ phone: '5511999999999' }, { phone: '5521888888888' }],
      }),
    } as never);

    const targets = await resolveUnsentStep0TargetsFromSnapshot('tenant-1', 'c1', {
      contactListId: 'list1',
      totalContacts: 2,
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
