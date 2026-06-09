import { describe, expect, it } from 'vitest';
import { filterByConnectionScope, isLegacyConnectionId, ownsConnectionForUid } from './connectionScope';

describe('connectionScope', () => {
  it('detects legacy ids', () => {
    expect(isLegacyConnectionId('1234567890')).toBe(true);
    expect(isLegacyConnectionId('user__abc')).toBe(false);
  });

  it('ownsConnectionForUid strict: prefixed channel matches owner', () => {
    expect(ownsConnectionForUid('owner1', 'owner1__chanA')).toBe(true);
    expect(ownsConnectionForUid('owner1', 'owner2__chanA')).toBe(false);
  });

  it('ownsConnectionForUid strict: legacy conn_* with metadata ownerUid', () => {
    expect(ownsConnectionForUid('owner1', 'conn_1700000000000', 'owner1')).toBe(true);
    expect(ownsConnectionForUid('owner2', 'conn_1700000000000', 'owner1')).toBe(false);
    expect(ownsConnectionForUid('owner1', 'conn_1700000000000')).toBe(false);
  });

  it('ownsConnectionForUid: Firebase legado equivale ao UUID Postgres derivado', () => {
    const fb = 'Psk62I4LRwdt29QNs7C5oEcfnAM2';
    const pg = 'f2e2f649-6ba6-561e-b15d-99df29ab1ded';
    expect(ownsConnectionForUid(pg, 'conn_1700000000000', fb)).toBe(true);
    expect(ownsConnectionForUid(fb, 'conn_1700000000000', pg)).toBe(true);
    expect(ownsConnectionForUid('02c9d1fb-2677-48f0-a6a4-76bbea1dd6ae', 'conn_1700000000000', fb)).toBe(
      false
    );
  });

  it('filterByConnectionScope keeps only owned', () => {
    const list = [
      { id: 'owner1__a', connectionId: 'owner1__a' },
      { id: 'owner2__b', connectionId: 'owner2__b' }
    ];
    const f = filterByConnectionScope('owner1', list);
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe('owner1__a');
  });
});
