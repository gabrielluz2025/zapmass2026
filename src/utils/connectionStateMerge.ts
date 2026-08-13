import { ConnectionStatus, type WhatsAppConnection } from '../types';

/**
 * Evita regressão CONNECTED → CONNECTING quando o servidor/envio de socket
 * ainda reflete RAM desatualizada no boot (antes do hydrate/sync Evolution).
 */
export function mergeConnectionStatus(
  incoming: ConnectionStatus,
  previous?: ConnectionStatus
): ConnectionStatus {
  if (incoming === ConnectionStatus.CONNECTED) return incoming;
  if (previous === ConnectionStatus.CONNECTED && incoming === ConnectionStatus.CONNECTING) {
    return previous;
  }
  if (
    previous === ConnectionStatus.CONNECTED &&
    (incoming === ConnectionStatus.QR_READY || incoming === ConnectionStatus.DISCONNECTED)
  ) {
    return incoming;
  }
  return incoming;
}

export function mergeWhatsAppConnectionRow(
  incoming: WhatsAppConnection,
  previous: WhatsAppConnection | undefined,
  qrFromCache: string | undefined
): WhatsAppConnection {
  const status = mergeConnectionStatus(incoming.status, previous?.status);
  const shouldClearQr = status === ConnectionStatus.CONNECTED;
  if (shouldClearQr) {
    return {
      ...incoming,
      status,
      qrCode: undefined,
      connectedSince: incoming.connectedSince ?? previous?.connectedSince
    };
  }
  const rawQr = qrFromCache ?? previous?.qrCode ?? incoming.qrCode;
  const qrCode = typeof rawQr === 'string' && rawQr.trim() ? rawQr.trim() : undefined;
  return {
    ...incoming,
    status,
    qrCode
  };
}

export function mergeWhatsAppConnectionLists(
  incoming: WhatsAppConnection[],
  previous: WhatsAppConnection[],
  qrById: Record<string, string | undefined>
): WhatsAppConnection[] {
  const prevById = new Map(previous.map((c) => [c.id, c]));
  const incomingIds = new Set(incoming.map((c) => c.id));
  const merged = incoming.map((conn) =>
    mergeWhatsAppConnectionRow(conn, prevById.get(conn.id), qrById[conn.id])
  );
  // Preserva canais já visíveis na UI se o payload do servidor vier incompleto (corrida de hydrate/escopo).
  for (const prev of previous) {
    if (!incomingIds.has(prev.id)) {
      merged.push(mergeWhatsAppConnectionRow(prev, prev, qrById[prev.id]));
    }
  }
  return merged;
}

/** Campos que, se mudarem, devem forçar re-render da lista de conexões. */
export function connectionListLooksUnchanged(
  prev: WhatsAppConnection[],
  next: WhatsAppConnection[]
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((p, i) => {
    const r = next[i];
    if (!r || p.id !== r.id) return false;
    return (
      p.status === r.status &&
      p.qrCode === r.qrCode &&
      p.name === r.name &&
      p.phoneNumber === r.phoneNumber &&
      (p.ownerUid ?? '') === (r.ownerUid ?? '') &&
      (p.healthScore ?? 100) === (r.healthScore ?? 100) &&
      (Number(p.messagesSentToday) || 0) === (Number(r.messagesSentToday) || 0) &&
      (Number(p.queueSize) || 0) === (Number(r.queueSize) || 0) &&
      (Number(p.dailyLimit) || 0) === (Number(r.dailyLimit) || 0) &&
      (p.connectedSince ?? 0) === (r.connectedSince ?? 0) &&
      (Number(p.batteryLevel) || 0) === (Number(r.batteryLevel) || 0)
    );
  });
}
