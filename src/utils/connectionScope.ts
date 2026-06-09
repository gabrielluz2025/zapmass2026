import { tenantScopeUidsMatch } from './tenantUidScope';

/**
 * Canais criados antes do isolamento por conta: id sem "__" (ex.: timestamp).
 * Visíveis a qualquer sessão no mesmo servidor (típico: uma instância, um operador).
 * Em servidor compartilhado com várias contas, considere migrar ids para `uid__...`.
 */
/**
 * Em multi-tenant estrito, canais "legado" (id sem `uid__`) não devem aparecer para
 * contas logadas (evita vazar dados entre usuários).
 *
 * No servidor: ZAPMASS_STRICT_CONNECTION_SCOPE=1
 * No front (Vite): VITE_STRICT_CONNECTION_SCOPE=1
 */
const strictConnectionScope = (): boolean => {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_STRICT_CONNECTION_SCOPE?: string } }).env) {
      const v = (import.meta as { env?: { VITE_STRICT_CONNECTION_SCOPE?: string } }).env?.VITE_STRICT_CONNECTION_SCOPE;
      if (v === '1' || v === 'true') return true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof process !== 'undefined' && process.env?.ZAPMASS_STRICT_CONNECTION_SCOPE) {
      const v = process.env.ZAPMASS_STRICT_CONNECTION_SCOPE;
      return v === '1' || v === 'true';
    }
  } catch {
    /* ignore */
  }
  // Segurança primeiro: por padrão sempre estrito.
  return true;
};

export function isLegacyConnectionId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && !id.includes('__');
}

export function ownsConnectionForUid(
  socketUid: string | null | undefined,
  connectionId: string,
  /** Dono gravado no servidor (ids legados `conn_*` sem prefixo `uid__`). */
  metadataOwnerUid?: string | null
): boolean {
  if (!connectionId) return false;

  const uid = !socketUid || socketUid === 'anonymous' ? 'anonymous' : socketUid;

  const idx = connectionId.indexOf('__');
  if (idx > 0) {
    const owner = connectionId.slice(0, idx);
    if (uid === 'anonymous') return owner === 'anonymous';
    return tenantScopeUidsMatch(uid, owner);
  }

  if (metadataOwnerUid) {
    if (uid === 'anonymous') return metadataOwnerUid === 'anonymous';
    return tenantScopeUidsMatch(uid, metadataOwnerUid);
  }

  if (isLegacyConnectionId(connectionId)) {
    if (!strictConnectionScope()) return true;
    return !socketUid || socketUid === 'anonymous';
  }

  return false;
}

export function filterByConnectionScope<T extends { id?: string; connectionId?: string }>(
  socketUid: string | null | undefined,
  list: T[]
): T[] {
  const uid = !socketUid || socketUid === 'anonymous' ? 'anonymous' : socketUid;
  return list.filter((item) => {
    const key =
      typeof item.connectionId === 'string' && item.connectionId
        ? item.connectionId
        : typeof item.id === 'string'
          ? item.id
          : '';
    if (!key) return false;
    const meta =
      typeof (item as { ownerUid?: string }).ownerUid === 'string'
        ? (item as { ownerUid?: string }).ownerUid
        : undefined;
    return ownsConnectionForUid(uid, key, meta);
  });
}
