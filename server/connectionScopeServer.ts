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

function connectionMetadataOwnerUid(item: {
  ownerUid?: string;
  connectionOwnerUid?: string;
}): string | undefined {
  if (typeof item.ownerUid === 'string' && item.ownerUid.trim()) return item.ownerUid.trim();
  if (typeof item.connectionOwnerUid === 'string' && item.connectionOwnerUid.trim()) {
    return item.connectionOwnerUid.trim();
  }
  return undefined;
}

export function filterByConnectionScope<
  T extends {
    id?: string;
    connectionId?: string;
    ownerUid?: string;
    connectionOwnerUid?: string;
    name?: string;
  }
>(tenantUid: string | null | undefined, list: T[]): T[] {
  return list.filter((item) => {
    const key =
      typeof item.connectionId === 'string' && item.connectionId
        ? item.connectionId
        : typeof item.id === 'string'
          ? item.id
          : '';
    if (!key) return false;
    const meta = connectionMetadataOwnerUid(item);
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
