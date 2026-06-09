import { describe, expect, it } from 'vitest';
import { ownsConnectionForTenant } from './connectionScopeServer.js';

describe('ownsConnectionForTenant (servidor)', () => {
  it('Firebase legado equivale ao UUID Postgres derivado', () => {
    const fb = 'Psk62I4LRwdt29QNs7C5oEcfnAM2';
    const pg = 'f2e2f649-6ba6-561e-b15d-99df29ab1ded';
    expect(ownsConnectionForTenant(pg, 'conn_1', fb)).toBe(true);
    expect(ownsConnectionForTenant(fb, 'conn_1', pg)).toBe(true);
    expect(ownsConnectionForTenant('02c9d1fb-2677-48f0-a6a4-76bbea1dd6ae', 'conn_1', fb)).toBe(false);
  });
});
