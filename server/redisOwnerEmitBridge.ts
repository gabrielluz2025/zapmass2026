import IORedis from 'ioredis';
import type { Server } from 'socket.io';

const CHANNEL = 'zapmass:owner-socket-emit';

type OwnerEmit = (uid: string, event: string, payload: Record<string, unknown>) => void;

type OwnerEmitSubscriberDeps = {
    onBridged?: (msg: { uid: string; event: string; payload: Record<string, unknown> }) => void;
};

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
  const sub = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
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
    const pub = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
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
