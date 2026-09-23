import { describe, it, expect } from 'vitest';
import {
  isTenantCacheFresh,
  isTenantContactsCacheComplete,
  type TenantDailyBootstrapCache,
} from './tenantDailyCache';

function base(partial: Partial<TenantDailyBootstrapCache> = {}): TenantDailyBootstrapCache {
  return {
    day: '2099-01-01',
    uid: 'u1',
    cachedAt: Date.now(),
    contacts: [],
    contactsOffset: 0,
    contactsHasMore: false,
    contactsSavedTotal: 1000,
    campaigns: [],
    contactLists: [],
    inboxFullSyncDone: false,
    ...partial,
  };
}

describe('isTenantCacheFresh', () => {
  it('aceita cache com menos de 24h mesmo com day antigo', () => {
    expect(
      isTenantCacheFresh({
        day: '2020-01-01',
        cachedAt: Date.now() - 60_000,
      })
    ).toBe(true);
  });

  it('rejeita cache com mais de 24h', () => {
    expect(
      isTenantCacheFresh({
        day: '2099-01-01',
        cachedAt: Date.now() - 25 * 60 * 60 * 1000,
      })
    ).toBe(false);
  });
});

describe('isTenantContactsCacheComplete', () => {
  it('completo quando hasMore=false e IDB cobriu o total', () => {
    expect(isTenantContactsCacheComplete(base({ contactsHasMore: false, contactsSavedTotal: 5000 }), 5000)).toBe(
      true
    );
  });

  it('incompleto quando ainda hasMore', () => {
    expect(isTenantContactsCacheComplete(base({ contactsHasMore: true, contactsOffset: 1000 }), 1000)).toBe(
      false
    );
  });

  it('incompleto se faltam muitos contatos', () => {
    expect(isTenantContactsCacheComplete(base({ contactsHasMore: false, contactsSavedTotal: 5000 }), 100)).toBe(
      false
    );
  });
});
