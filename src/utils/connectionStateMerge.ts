import { ConnectionStatus, type WhatsAppConnection } from '../types';

/**
 * Evita regressão CONNECTED → CONNECTING/DISCONNECTED transitório (Evolution/webhook).
 */
export function mergeConnectionStatus(
  incoming: ConnectionStatus,
  previous?: ConnectionStatus,
  meta?: { connectedSince?: number; phoneNumber?: string }
): ConnectionStatus {
  if (incoming === ConnectionStatus.CONNECTED) return incoming;
  if (previous === ConnectionStatus.CONNECTED && incoming === ConnectionStatus.CONNECTING) {
    return previous;
  }
  /** Reconexão Evolution: chip pareado não deve voltar para QR durante oscilação. */
  if (previous === ConnectionStatus.CONNECTED && incoming === ConnectionStatus.QR_READY) {
    return previous;
  }
  const since = meta?.connectedSince ?? 0;
  if (previous === ConnectionStatus.CONNECTED && incoming === ConnectionStatus.DISCONNECTED) {
    if (since > 0 && Date.now() - since < 120_000) return previous;
    /** connection-update pode marcar CONNECTED antes do hydrate enviar connectedSince. */
    if (since === 0 && meta?.phoneNumber?.trim()) return previous;
  }
  return incoming;
}

function preservePhone(incoming?: string, previous?: string): string | undefined {
  const inc = incoming?.trim();
  if (inc) return inc;
  const prev = previous?.trim();
  return prev || undefined;
}

export function mergeWhatsAppConnectionRow(
  incoming: WhatsAppConnection,
  previous: WhatsAppConnection | undefined,
  qrFromCache: string | undefined
): WhatsAppConnection {
  const phoneNumber = preservePhone(incoming.phoneNumber, previous?.phoneNumber);
  let connectedSince = incoming.connectedSince ?? previous?.connectedSince;
  const status = mergeConnectionStatus(incoming.status, previous?.status, {
    connectedSince,
    phoneNumber,
  });
  if (status === ConnectionStatus.CONNECTED && !connectedSince) {
    connectedSince = Date.now();
  }
  const shouldClearQr = status === ConnectionStatus.CONNECTED;
  if (shouldClearQr) {
    return {
      ...incoming,
      status,
      phoneNumber,
      qrCode: undefined,
      connectedSince,
    };
  }
  const rawQr = qrFromCache ?? previous?.qrCode ?? incoming.qrCode;
  const qrCode = typeof rawQr === 'string' && rawQr.trim() ? rawQr.trim() : undefined;
  return {
    ...incoming,
    status,
    phoneNumber,
    connectedSince,
    qrCode,
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
  return merged.sort((a, b) => a.id.localeCompare(b.id));
}

/** Campos que, se mudarem, devem forçar re-render da lista de conexões. */
export function connectionListLooksUnchanged(
  prev: WhatsAppConnection[],
  next: WhatsAppConnection[]
): boolean {
  if (prev.length !== next.length) return false;
  const nextById = new Map(next.map((c) => [c.id, c]));
  return prev.every((p) => {
    const r = nextById.get(p.id);
    if (!r) return false;
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
