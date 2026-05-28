import { describe, expect, it } from 'vitest';
import {
  canReconcileLegacyCampaignOwner,
  resolveCampaignTenantOwner
} from './campaignTenantScope.js';

describe('resolveCampaignTenantOwner', () => {
  const members = new Set(['owner-1', 'member-a', 'member-b']);

  it('aceita dono do workspace como tenant', () => {
    expect(resolveCampaignTenantOwner('owner-1', 'owner-1', members)).toBe('owner-1');
  });

  it('reconcilia campanha iniciada por membro da equipa para o tenant', () => {
    expect(resolveCampaignTenantOwner('owner-1', 'member-a', members)).toBe('owner-1');
  });

  it('reconcilia ownerUid vazio para o tenant', () => {
    expect(resolveCampaignTenantOwner('owner-1', '', members)).toBe('owner-1');
  });

  it('bloqueia UID fora do workspace', () => {
    expect(resolveCampaignTenantOwner('owner-1', 'stranger', members)).toBeNull();
  });

  it('reconcilia ownerUid legado só para dono com equipa no workspace', () => {
    expect(canReconcileLegacyCampaignOwner('owner-1', 'legacy-old-uid', members)).toBe(true);
    expect(canReconcileLegacyCampaignOwner('member-a', 'owner-1', new Set(['member-a']))).toBe(false);
  });

  it('permite membro da equipa controlar campanha com ownerUid legado', () => {
    expect(resolveCampaignTenantOwner('owner-1', 'legacy-old-uid', members, 'member-a')).toBe('owner-1');
  });

  it('bloqueia tenant anonimo ou vazio', () => {
    expect(resolveCampaignTenantOwner('', 'owner-1', members)).toBeNull();
    expect(resolveCampaignTenantOwner('anonymous', 'owner-1', members)).toBeNull();
  });

  it('sem set de membros só permite owner === tenant', () => {
    expect(resolveCampaignTenantOwner('owner-1', 'owner-1')).toBe('owner-1');
    expect(resolveCampaignTenantOwner('owner-1', 'member-a')).toBeNull();
  });
});
