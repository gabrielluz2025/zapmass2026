/**
 * Canais criados antes do isolamento por conta: id sem "__" (ex.: timestamp).
 * Visíveis a qualquer sessão no mesmo servidor (típico: uma instância, um operador).
 * Em servidor compartilhado com várias contas, considere migrar ids para `uid__...`.
 */
export function isLegacyConnectionId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && !id.includes('__');
}

export function ownsConnectionForUid(
  socketUid: string | null | undefined,
  connectionId: string
): boolean {
  if (!connectionId) return false;
  if (isLegacyConnectionId(connectionId)) return true;

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
