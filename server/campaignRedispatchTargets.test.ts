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

vi.mock('./campaignJobsResilience.js', () => ({
  listSettledCampaignJobs: vi.fn(),
  listCampaignJobToNumbers: vi.fn(),
}));

import { getZapmassPool } from './db/postgres.js';
import { getContactListById } from './repositories/contactListsRepository.js';
import { listCampaignLogs } from './repositories/campaignsRepository.js';
import { listSettledCampaignJobs } from './campaignJobsResilience.js';
import {
  plannedPhonesMissingFromJobs,
  resolveUnsentStep0TargetsFromSnapshot,
  resolveUnsentTargetsFromCampaignJobs,
} from './campaignRedispatchTargets.js';

describe('plannedPhonesMissingFromJobs', () => {
  it('pula quem já tem job, mesmo com DDD/9 diferentes', () => {
    const missing = plannedPhonesMissingFromJobs(
      ['5548999887766', '5548988776655', '4899771122'],
      ['48999887766']
    );
    expect(missing).toContain('5548988776655');
    expect(missing.some((p) => p.endsWith('99887766'))).toBe(false);
  });

  it('devolve todos se ainda não há jobs', () => {
    expect(plannedPhonesMissingFromJobs(['5548999112233'], [])).toEqual(['5548999112233']);
  });
});

describe('resolveUnsentTargetsFromCampaignJobs', () => {
  beforeEach(() => {
    vi.mocked(listSettledCampaignJobs).mockReset();
    vi.mocked(getContactListById).mockReset();
    vi.mocked(getZapmassPool).mockReset();
  });

  it('não reenvia sent/dead e devolve o restante da lista', async () => {
    vi.mocked(listSettledCampaignJobs).mockResolvedValue([
      { idempotencyKey: 'k1', toNumber: '48999887766', stageIndex: 0 },
    ]);
    vi.mocked(getContactListById).mockResolvedValue({
      id: 'list1',
      name: 'Lista',
      contactIds: ['c1', 'c2'],
    } as never);
    vi.mocked(getZapmassPool).mockReturnValue({
      query: vi.fn().mockResolvedValue({
        rows: [{ phone: '5548999887766' }, { phone: '5548988776655' }],
      }),
    } as never);

    const targets = await resolveUnsentTargetsFromCampaignJobs('tenant-1', 'c1', {
      contactListId: 'list1',
      totalContacts: 2,
    });

    expect(targets.some((t) => t.phone.endsWith('99887766'))).toBe(false);
    expect(targets.some((t) => t.phone.endsWith('88776655'))).toBe(true);
  });
});

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

  it('une snapshot parcial com contactListId (campanha concluída cedo demais)', async () => {
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
      contactIds: ['c1', 'c2', 'c3'],
    } as never);
    vi.mocked(getZapmassPool).mockReturnValue({
      query: vi.fn().mockResolvedValue({
        rows: [
          { phone: '5511999999999' },
          { phone: '5521888888888' },
          { phone: '5531777777777' },
        ],
      }),
    } as never);

    const targets = await resolveUnsentStep0TargetsFromSnapshot('tenant-1', 'c1', {
      contactListId: 'list1',
      totalContacts: 1,
      scheduleStartSnapshot: { numbers: ['5511999999999'], message: 'oi' },
    });

    expect(targets).toEqual([
      { phone: '5521888888888', stepIndex: 0 },
      { phone: '5531777777777', stepIndex: 0 },
    ]);
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
