import {
  filterByConnectionScope as filterClient,
  ownsConnectionForUid as ownsClient,
  isLegacyConnectionId
} from '../src/utils/connectionScope.js';
import { expandTenantScopeUids } from './auth/tenantUidScopeServer.js';
import { shouldHideConnectionFromTenant } from './reconcileConnectionOwners.js';

/** Escopo no servidor: aceita Firebase legado + UUID Postgres do mesmo tenant. */
export function ownsConnectionForTenant(
  tenantUid: string | null | undefined,
  connectionId: string,
  metadataOwnerUid?: string | null
): boolean {
  const tenants = expandTenantScopeUids(String(tenantUid || '').trim() || 'anonymous');
  const metas = metadataOwnerUid
    ? expandTenantScopeUids(String(metadataOwnerUid).trim())
    : [undefined];
  for (const t of tenants) {
    for (const m of metas) {
      if (ownsClient(t, connectionId, m)) return true;
    }
    if (!metadataOwnerUid && isLegacyConnectionId(connectionId)) {
      if (ownsClient(t, connectionId, undefined)) return true;
    }
  }
  return false;
}

export function filterByConnectionScope<
  T extends { id?: string; connectionId?: string; ownerUid?: string; name?: string }
>(tenantUid: string | null | undefined, list: T[]): T[] {
  return list.filter((item) => {
    const key =
      typeof item.connectionId === 'string' && item.connectionId
        ? item.connectionId
        : typeof item.id === 'string'
          ? item.id
          : '';
    if (!key) return false;
    const meta =
      typeof item.ownerUid === 'string' ? item.ownerUid : undefined;
    if (!ownsConnectionForTenant(tenantUid, key, meta)) return false;
    const displayName = typeof item.name === 'string' ? item.name : undefined;
    if (shouldHideConnectionFromTenant(String(tenantUid || ''), key, displayName, meta)) {
      return false;
    }
    return true;
  });
}

/** Re-export para código que já importava do cliente. */
export { filterClient, ownsClient };
