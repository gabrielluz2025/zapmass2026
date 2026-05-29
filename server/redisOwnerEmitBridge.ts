import IORedis from 'ioredis';
import type { Server } from 'socket.io';
import type { Conversation } from './types.js';

const CHANNEL = 'zapmass:owner-socket-emit';

type OwnerEmit = (uid: string, event: string, payload: Record<string, unknown>) => void;

type OwnerEmitSubscriberDeps = {
  onBridged?: (msg: { uid: string; event: string; payload: Record<string, unknown> }) => void;
};

async function emitConversationsFilteredPerSocket(io: Server, tenantUid: string, payload: unknown): Promise<void> {
  const convs = Array.isArray(payload) ? (payload as Conversation[]) : [];
  try {
    const socks = await io.in(`user:${tenantUid}`).fetchSockets();
    const { ensureAssignmentsLoaded } = await import('./inboxAssignments.js');
    const { conversationsPayloadForViewer } = await import('./conversationsEmit.js');
    if (tenantUid !== 'anonymous') {
      await ensureAssignmentsLoaded(tenantUid).catch(() => undefined);
    }
    for (const remoteSocket of socks) {
      const authUid = String((remoteSocket.data as { authUid?: string }).authUid ?? tenantUid);
      const { resolveConnectionOwnerUid } = await import('./evolutionService.js');
      const list = conversationsPayloadForViewer(tenantUid, authUid, convs, resolveConnectionOwnerUid);
      remoteSocket.emit('conversations-update', list);
    }
  } catch (e) {
    console.warn('[owner-emit-redis] conversations-update por socket falhou:', (e as Error)?.message);
    try {
      io.to(`user:${tenantUid}`).emit('conversations-update', payload);
    } catch {
      /* ignore */
    }
  }
}

/**
 * No arranque da API (processo com Socket.IO real): subscreve Redis para o worker
 * publicar eventos (qr-code, etc.) que devem chegar ao `user:uid` no browser.
 */
export const startOwnerEmitRedisSubscriber = (
  io: Server,
  redisUrl: string,
  deps?: OwnerEmitSubscriberDeps
): (() => void) | null => {
  if (!redisUrl?.trim()) return null;
  const sub = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 500, 5000),
    reconnectOnError: () => true,
  });
  sub.on('error', (err) => console.warn('[owner-emit-redis] sub error:', err?.message || err));
  let closed = false;

  void sub
    .subscribe(CHANNEL)
    .then(() => {
      console.log('[owner-emit-redis] subscritor ativo (QR e eventos do worker -> browser)');
    })
    .catch((e) => console.error('[owner-emit-redis] falha ao subscrever:', e));

  sub.on('message', (_ch, message) => {
    if (closed) return;
    try {
      const parsed = JSON.parse(message) as { uid?: string; event?: string; payload?: Record<string, unknown> };
      if (!parsed?.uid || !parsed?.event) return;
      deps?.onBridged?.({
        uid: String(parsed.uid),
        event: String(parsed.event),
        payload: parsed.payload ?? {}
      });
      if (parsed.event === 'conversations-update') {
        const tenantUid = String(parsed.uid);
        void emitConversationsFilteredPerSocket(io, tenantUid, parsed.payload);
        return;
      }
      io.to(`user:${parsed.uid}`).emit(parsed.event, parsed.payload ?? {});
    } catch (e) {
      console.warn('[owner-emit-redis] mensagem inválida:', (e as Error)?.message);
    }
  });

  return () => {
    closed = true;
    void sub.quit().catch(() => undefined);
  };
};

/**
 * No worker: publica no Redis o mesmo payload que a API emeteria via Socket.IO.
 */
export const createOwnerEmitRedisPublisher = (redisUrl: string): OwnerEmit | null => {
  if (!redisUrl?.trim()) return null;
  try {
    const pub = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
      reconnectOnError: () => true,
    });
    pub.on('error', (err) => console.warn('[owner-emit-redis] pub error:', err?.message || err));
    return (uid: string, event: string, payload: Record<string, unknown>) => {
      try {
        void pub.publish(CHANNEL, JSON.stringify({ uid, event, payload }));
      } catch (err) {
        console.warn('[owner-emit-redis] publish falhou:', (err as Error)?.message);
      }
    };
  } catch (e) {
    console.error('[owner-emit-redis] publicador nao disponivel:', (e as Error)?.message);
    return null;
  }
};
