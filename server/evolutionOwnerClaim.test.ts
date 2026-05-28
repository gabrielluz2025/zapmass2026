import { describe, expect, it } from 'vitest';
import { ownsConnectionForUid } from '../src/utils/connectionScope.js';

describe('legacy conn_* ownership (escopo estrito)', () => {
  const tenantUid = 'firebaseTenantA';
  const legacyChip = 'conn_1700000000000';

  it('sem ownerUid conhecido bloqueia tenant logado', () => {
    expect(ownsConnectionForUid(tenantUid, legacyChip)).toBe(false);
  });

  it('com ownerUid no resolver (settings/RAM) libera o tenant correto', () => {
    expect(ownsConnectionForUid(tenantUid, legacyChip, tenantUid)).toBe(true);
    expect(ownsConnectionForUid('outroUid', legacyChip, tenantUid)).toBe(false);
  });
});

describe('ensureTenantOwnsConnection (integração leve)', () => {
  it('exporta helper de escopo no evolutionService', async () => {
    const mod = await import('./evolutionService.js');
    expect(typeof mod.ensureTenantOwnsConnection).toBe('function');
    expect(typeof mod.tryClaimUnownedLegacyConnection).toBe('function');
  });
});
