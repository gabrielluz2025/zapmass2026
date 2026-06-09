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
      qrCode: undefined
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
  return incoming.map((conn) =>
    mergeWhatsAppConnectionRow(conn, prevById.get(conn.id), qrById[conn.id])
  );
}
