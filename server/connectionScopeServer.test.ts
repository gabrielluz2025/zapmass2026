import { describe, expect, it } from 'vitest';
import { filterByConnectionScope, ownsConnectionForTenant } from './connectionScopeServer.js';

describe('ownsConnectionForTenant (servidor)', () => {
  it('Firebase legado equivale ao UUID Postgres derivado', () => {
    const fb = 'Psk62I4LRwdt29QNs7C5oEcfnAM2';
    const pg = 'f2e2f649-6ba6-561e-b15d-99df29ab1ded';
    expect(ownsConnectionForTenant(pg, 'conn_1', fb)).toBe(true);
    expect(ownsConnectionForTenant(fb, 'conn_1', pg)).toBe(true);
    expect(ownsConnectionForTenant('02c9d1fb-2677-48f0-a6a4-76bbea1dd6ae', 'conn_1', fb)).toBe(false);
  });
});

describe('filterByConnectionScope (servidor)', () => {
  const tenant = 'd497c1c3-4d3e-41ea-a0a9-cb9ab61b77bc';
  const legacyConn = 'conn_1789750619703_15';

  it('inclui conversa legada conn_* quando connectionOwnerUid bate com o tenant', () => {
    const out = filterByConnectionScope(tenant, [
      {
        id: `${legacyConn}:5511999999999@s.whatsapp.net`,
        connectionId: legacyConn,
        connectionOwnerUid: tenant,
      },
    ]);
    expect(out).toHaveLength(1);
  });

  it('exclui conversa legada conn_* sem metadado de dono', () => {
    const out = filterByConnectionScope(tenant, [
      {
        id: `${legacyConn}:5511999999999@s.whatsapp.net`,
        connectionId: legacyConn,
      },
    ]);
    expect(out).toHaveLength(0);
  });
});
