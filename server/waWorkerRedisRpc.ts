/**
 * Com SESSION_PROCESS_MODE=api o processo da API não tem `clients` (Puppeteer só no wa-worker).
 * Estes RPCs enviam pedidos por Redis; o worker executa e publica a resposta no canal de reply.
 */
import IORedis from 'ioredis';

const CHANNEL_REQUEST = 'zapmass:wa:worker:request';
const RPC_TIMEOUT_MS = 90_000;

type RpcLoadChatHistory = {
  replyChannel: string;
  kind: 'loadChatHistory';
  conversationId: string;
  limit: number;
  skipMedia: boolean;
};

type RpcFetchConversationPicture = {
  replyChannel: string;
  kind: 'fetchConversationPicture';
  conversationId: string;
};

type RpcLoadMessageMedia = {
  replyChannel: string;
  kind: 'loadMessageMedia';
  conversationId: string;
  messageId: string;
};

type RpcWire = RpcLoadChatHistory | RpcFetchConversationPicture | RpcLoadMessageMedia;

type RpcPayload =
  | { kind: 'loadChatHistory'; conversationId: string; limit: number; skipMedia: boolean }
  | { kind: 'fetchConversationPicture'; conversationId: string }
  | { kind: 'loadMessageMedia'; conversationId: string; messageId: string };

export const startWaWorkerRpcListener = (redisUrl: string): (() => void) | null => {
  if (!redisUrl?.trim()) return null;
  try {
    const sub = new IORedis(redisUrl, { maxRetriesPerRequest: 3 });
    const pub = new IORedis(redisUrl, { maxRetriesPerRequest: 3 });
    let closed = false;

    void sub.subscribe(CHANNEL_REQUEST).catch((e) => console.error('[wa-worker-rpc] subscribe:', e));

    sub.on('message', async (_ch, raw) => {
      if (closed) return;
      let msg: RpcWire;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg.replyChannel) return;

      try {
        const wa = await import('./whatsappService.js');

        if (msg.kind === 'loadChatHistory') {
          const resp = await wa.loadChatHistory(msg.conversationId, msg.limit ?? 500, msg.skipMedia);
          await pub.publish(msg.replyChannel, JSON.stringify(resp));
        } else if (msg.kind === 'fetchConversationPicture') {
          const profilePicUrl = await wa.fetchConversationPicture(msg.conversationId);
          await pub.publish(msg.replyChannel, JSON.stringify({ profilePicUrl }));
        } else if (msg.kind === 'loadMessageMedia') {
          const resp = await wa.loadMessageMedia(msg.conversationId, msg.messageId);
          await pub.publish(msg.replyChannel, JSON.stringify(resp));
        }
      } catch (e) {
        console.error('[wa-worker-rpc] falha:', (e as Error)?.message || e);
      }
    });

    console.log('[wa-worker-rpc] ouvinte ativo →', CHANNEL_REQUEST);
    return () => {
      closed = true;
      void sub.quit().catch(() => undefined);
      void pub.quit().catch(() => undefined);
    };
  } catch (e) {
    console.error('[wa-worker-rpc] nao iniciou:', e);
    return null;
  }
};

function buildWire(replyChannel: string, payload: RpcPayload): RpcWire {
  if (payload.kind === 'loadChatHistory') {
    return {
      replyChannel,
      kind: 'loadChatHistory',
      conversationId: payload.conversationId,
      limit: payload.limit,
      skipMedia: payload.skipMedia
    };
  }
  if (payload.kind === 'fetchConversationPicture') {
    return { replyChannel, kind: 'fetchConversationPicture', conversationId: payload.conversationId };
  }
  return {
    replyChannel,
    kind: 'loadMessageMedia',
    conversationId: payload.conversationId,
    messageId: payload.messageId
  };
}

async function rpcReply<T>(redisUrl: string, payload: RpcPayload): Promise<T> {
  const replyChannel = `zapmass:wa:reply:${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  const wire = buildWire(replyChannel, payload);
  const sub = new IORedis(redisUrl, { maxRetriesPerRequest: 3 });
  const pub = new IORedis(redisUrl, { maxRetriesPerRequest: 3 });

  try {
    await sub.subscribe(replyChannel);
    await pub.publish(CHANNEL_REQUEST, JSON.stringify(wire));

    return await new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        resolve({ error: 'Timeout ao falar com o worker (wa-worker + Redis).' } as unknown as T);
      }, RPC_TIMEOUT_MS);

      sub.on('message', (channel: string, message: string) => {
        if (channel !== replyChannel) return;
        clearTimeout(timer);
        try {
          resolve(JSON.parse(message));
        } catch {
          resolve({ error: 'Resposta invalida do worker.' } as unknown as T);
        }
      });
    });
  } finally {
    sub.disconnect();
    pub.disconnect();
  }
}

export async function loadChatHistoryViaRedis(
  redisUrl: string,
  conversationId: string,
  limit: number,
  skipMedia: boolean
): Promise<{ ok: boolean; total: number; error?: string }> {
  const r = await rpcReply<{ ok?: boolean; total?: number; error?: string }>(redisUrl, {
    kind: 'loadChatHistory',
    conversationId,
    limit,
    skipMedia
  });
  if (r && typeof r === 'object' && 'error' in r && (r as { error: string }).error) {
    return { ok: false, total: 0, error: (r as { error: string }).error };
  }
  return {
    ok: Boolean((r as { ok?: boolean }).ok),
    total: typeof (r as { total?: number }).total === 'number' ? (r as { total: number }).total : 0,
    ...((r as { error?: string }).error ? { error: (r as { error: string }).error } : {})
  };
}

export async function fetchConversationPictureViaRedis(
  redisUrl: string,
  conversationId: string
): Promise<string | null> {
  const r = await rpcReply<{ profilePicUrl?: string | null } | { error: string }>(redisUrl, {
    kind: 'fetchConversationPicture',
    conversationId
  });
  if (r && typeof r === 'object' && 'error' in r) return null;
  const pic = (r as { profilePicUrl?: string | null }).profilePicUrl;
  return pic === undefined ? null : pic;
}

export async function loadMessageMediaViaRedis(
  redisUrl: string,
  conversationId: string,
  messageId: string
): Promise<{ ok: boolean; mediaUrl?: string; error?: string }> {
  const r = await rpcReply<{ ok?: boolean; mediaUrl?: string; error?: string }>(redisUrl, {
    kind: 'loadMessageMedia',
    conversationId,
    messageId
  });
  const x = r as { ok?: boolean; mediaUrl?: string; error?: string };
  /** Timeout só traz `.error`; resposta whatsapp pode ser `{ ok: false, error }` ou `{ ok: true, mediaUrl }`. */
  return {
    ok: typeof x.ok === 'boolean' ? x.ok : false,
    ...(typeof x.mediaUrl === 'string' ? { mediaUrl: x.mediaUrl } : {}),
    ...(typeof x.error === 'string' ? { error: x.error } : {})
  };
}
