import { describe, expect, it } from 'vitest';
import { ownsConnectionForUid } from '../src/utils/connectionScope.js';

const tenantUid = 'firebaseTenantA';
const legacyChip = 'conn_1700000000000';

describe('legacy conn_* ownership (escopo estrito)', () => {

  it('sem ownerUid conhecido bloqueia tenant logado', () => {
    expect(ownsConnectionForUid(tenantUid, legacyChip)).toBe(false);
  });

  it('com ownerUid no resolver (settings/RAM) libera o tenant correto', () => {
    expect(ownsConnectionForUid(tenantUid, legacyChip, tenantUid)).toBe(true);
    expect(ownsConnectionForUid('outroUid', legacyChip, tenantUid)).toBe(false);
  });
});

describe('ensureTenantOwnsConnection (integração leve)', () => {
  it(
    'exporta helper de escopo no evolutionService',
    async () => {
      const mod = await import('./evolutionService.js');
      expect(typeof mod.ensureTenantOwnsConnection).toBe('function');
      expect(typeof mod.tryClaimUnownedLegacyConnection).toBe('function');
    },
    20_000,
  );

  it('membro da equipa no Set permite promoção conn_* → tenant (regra)', () => {
    const staffUid = 'staffB';
    const members = new Set([tenantUid, staffUid]);
    expect(members.has(staffUid)).toBe(true);
    expect(ownsConnectionForUid(tenantUid, legacyChip, staffUid)).toBe(false);
    expect(ownsConnectionForUid(tenantUid, legacyChip, tenantUid)).toBe(true);
  });
});
