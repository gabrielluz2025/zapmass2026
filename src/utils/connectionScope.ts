/**
 * Canais criados antes do isolamento por conta: id sem "__" (ex.: timestamp).
 * Visíveis a qualquer sessão no mesmo servidor (típico: uma instância, um operador).
 * Em servidor compartilhado com várias contas, considere migrar ids para `uid__...`.
 */
/**
 * Em multi-tenant estrito, canais "legado" (id sem `uid__`) não devem aparecer para
 * contas logadas (evita somar canais alheios). Em instalação típica (1 VPS = 1 dono)
 * o padrão é mostrar canais legados para todos, inclusive após reidratar sessao no deploy.
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
  return false;
};

export function isLegacyConnectionId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && !id.includes('__');
}

export function ownsConnectionForUid(
  socketUid: string | null | undefined,
  connectionId: string
): boolean {
  if (!connectionId) return false;
  if (isLegacyConnectionId(connectionId)) {
    if (!strictConnectionScope()) {
      // Padrão: mesma instância / um operador — canais legados visíveis a todos
      // (incluindo apos deploy quando a sessao foi criada como legado).
      return true;
    }
    // Modo multi-tenant estrito: so sessao "anonima" (operador) ve o legado.
    return !socketUid || socketUid === 'anonymous';
  }

  const idx = connectionId.indexOf('__');
  if (idx <= 0) return false;

  const owner = connectionId.slice(0, idx);
  const uid = !socketUid || socketUid === 'anonymous' ? 'anonymous' : socketUid;

  if (uid === 'anonymous') return owner === 'anonymous';
  return owner === uid;
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
    return ownsConnectionForUid(uid, key);
  });
}
