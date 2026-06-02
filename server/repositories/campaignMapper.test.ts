import { describe, expect, it } from 'vitest';
import { CampaignStatus } from '../../src/types.js';
import { campaignDocPayload, rowToCampaign } from './campaignMapper.js';

describe('campaignMapper', () => {
  it('rowToCampaign lê status e totais', () => {
    const c = rowToCampaign({
      id: '11111111-1111-1111-1111-111111111111',
      tenant_id: '22222222-2222-2222-2222-222222222222',
      name: 'Teste',
      status: 'RUNNING',
      next_run_at: null,
      schedule_lock_until: null,
      doc: {
        message: 'Oi',
        totalContacts: 10,
        processedCount: 3,
        successCount: 2,
        failedCount: 1,
        selectedConnectionIds: ['c1'],
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01')
    });
    expect(c.status).toBe(CampaignStatus.RUNNING);
    expect(c.totalContacts).toBe(10);
    expect(c.selectedConnectionIds).toEqual(['c1']);
  });

  it('campaignDocPayload inclui ownerUid', () => {
    const d = campaignDocPayload({ name: 'X' }, 'tenant-1');
    expect(d.ownerUid).toBe('tenant-1');
  });
});
