import { describe, expect, it } from 'vitest';
import { firebaseUidToTenantUuid, resolvePostgresTenantId } from './firebaseUidMap.js';

describe('firebaseUidMap', () => {
  it('gera UUID estável para o mesmo UID Firebase', () => {
    const a = firebaseUidToTenantUuid('abc123FirebaseUid');
    const b = firebaseUidToTenantUuid('abc123FirebaseUid');
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('resolvePostgresTenantId mantém UUID já migrado', () => {
    const uuid = firebaseUidToTenantUuid('tenantX');
    expect(resolvePostgresTenantId(uuid)).toBe(uuid);
    expect(resolvePostgresTenantId('legacyFbUid')).toBe(firebaseUidToTenantUuid('legacyFbUid'));
  });
});
