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
