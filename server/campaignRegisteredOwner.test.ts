import { describe, expect, it, vi, beforeEach } from 'vitest';
import { firebaseUidToTenantUuid } from './auth/tenantUidScopeServer.js';

const { getCampaignDoc, resolveCampaignTenantId } = vi.hoisted(() => ({
  getCampaignDoc: vi.fn(),
  resolveCampaignTenantId: vi.fn(),
}));

vi.mock('./repositories/campaignsRepository.js', () => ({
  getCampaignDoc,
  resolveCampaignTenantId,
}));

import { resolveRegisteredCampaignOwner } from './campaignRegisteredOwner.js';

describe('resolveRegisteredCampaignOwner', () => {
  beforeEach(() => {
    getCampaignDoc.mockReset();
    resolveCampaignTenantId.mockReset();
  });

  it('prioriza tenant_id da campanha no Postgres', async () => {
    const cid = '11111111-1111-4111-8111-111111111111';
    const pgTenant = '22222222-2222-4222-8222-222222222222';
    resolveCampaignTenantId.mockResolvedValue(pgTenant);
    getCampaignDoc.mockImplementation(async (tenant: string) =>
      tenant === pgTenant ? { name: 'x' } : null
    );

    const owner = await resolveRegisteredCampaignOwner(cid, 'firebaseUidLegacy');
    expect(owner).toBe(pgTenant);
    expect(getCampaignDoc).toHaveBeenCalledWith(pgTenant, cid);
  });

  it('aceita hint Firebase quando doc existe no UUID derivado', async () => {
    const cid = '11111111-1111-4111-8111-111111111111';
    const fb = 'abcFirebaseUid123';
    const derived = firebaseUidToTenantUuid(fb);
    resolveCampaignTenantId.mockResolvedValue(null);
    getCampaignDoc.mockImplementation(async (tenant: string) =>
      tenant === derived ? { ok: true } : null
    );

    const owner = await resolveRegisteredCampaignOwner(cid, fb);
    expect(owner).toBe(derived);
  });

  it('retorna null quando campanha não existe', async () => {
    resolveCampaignTenantId.mockResolvedValue(null);
    getCampaignDoc.mockResolvedValue(null);
    const owner = await resolveRegisteredCampaignOwner('missing-id', 'any');
    expect(owner).toBeNull();
  });

  it('confia no tenant_id da linha mesmo se getCampaignDoc falhar', async () => {
    const cid = '11111111-1111-4111-8111-111111111111';
    const pgTenant = '22222222-2222-4222-8222-222222222222';
    resolveCampaignTenantId.mockResolvedValue(pgTenant);
    getCampaignDoc.mockResolvedValue(null);

    const owner = await resolveRegisteredCampaignOwner(cid, 'firebaseUidLegacy');
    expect(owner).toBe(pgTenant);
  });
});
