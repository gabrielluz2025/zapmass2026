import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { buildEvolutionIncomingConvId } from './evolutionWebhookMessages.js';
import {
  buildInboundAutomationDedupeKey,
  isInboundAutomationProcessed,
} from './inboundAutomationDedupe.js';
import type { ChatMessage, Conversation } from './types.js';

const MAX_LOOKBACK_MS = 7 * 24 * 3600_000;
const DEFAULT_LOOKBACK_MS = 72 * 3600_000;
const MAX_REPLAY_PER_CONNECT = 400;
const REPLAY_DELAY_MS = 120;
const MANUAL_LOAD_BATCH = 8;

export type InboundProcessParams = {
  connectionId: string;
  phoneDigits: string;
  bodyText: string;
  nonTextReply?: boolean;
  incomingConvId: string;
  messageOwnerUid: string | undefined;
  dedupeKey: string;
  source: 'webhook' | 'replay';
};

export type InboundReplayDeps = {
  getConversations: () => Conversation[];
  loadChatHistory: (conversationId: string, limit: number) => Promise<{ ok: boolean }>;
  getLastClosedAt: (connectionId: string) => number | undefined;
  processInbound: (params: InboundProcessParams) => Promise<void>;
  log: (message: string, payload?: Record<string, unknown>) => void;
  /** Clique manual em Respostas: hidrata inbox (arquivo / findChats) antes de varrer. */
  prefetchInbox?: () => Promise<void>;
};

export type InboundReplayOptions = {
  /** Pedido do usuário: ignora lastClosedAt e usa 72h. */
  manual?: boolean;
};

export type ReplayCandidate = {
  dedupeKey: string;
  phoneDigits: string;
  bodyText: string;
  nonTextReply: boolean;
  incomingConvId: string;
  timestampMs: number;
};

export type InboundReplayResult = {
  scanned: number;
  replayed: number;
  skipped: number;
  windowHours: number;
};

function messageTimestampMs(msg: ChatMessage): number {
  if (typeof msg.timestampMs === 'number' && msg.timestampMs > 0) return msg.timestampMs;
  const parsed = Date.parse(String(msg.timestamp || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function conversationActivityMs(conv: Conversation): number {
  if (typeof conv.lastMessageTimestamp === 'number' && conv.lastMessageTimestamp > 0) {
    return conv.lastMessageTimestamp;
  }
  const parsed = Date.parse(String(conv.lastMessageTime || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Janela de reprocessamento: auto = desde o close (cap 7d); manual = 72h. */
export function resolveInboundReplayWindowStart(
  nowMs: number,
  lastClosedAt: number | undefined,
  manual: boolean
): number {
  if (manual) return nowMs - DEFAULT_LOOKBACK_MS;
  return Math.max(nowMs - MAX_LOOKBACK_MS, lastClosedAt ?? nowMs - DEFAULT_LOOKBACK_MS);
}

/** Coleta mensagens inbound elegíveis para reprocessamento após reconexão. */
export function collectInboundReplayCandidates(
  connectionId: string,
  conversations: Conversation[],
  windowStartMs: number
): ReplayCandidate[] {
  const out: ReplayCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const conv of conversations) {
    if (conv.connectionId !== connectionId) continue;
    const phoneDigits = normPhoneKey(conv.contactPhone);
    if (phoneDigits.length < 8) continue;

    const incomingConvId =
      conv.id.includes(':') && conv.id.startsWith(`${connectionId}:`)
        ? conv.id
        : buildEvolutionIncomingConvId(
              connectionId,
              `${phoneDigits}@s.whatsapp.net`,
              phoneDigits
          );

    const msgs = (conv.messages || [])
      .filter((m) => m.sender === 'them')
      .map((m) => ({ m, ts: messageTimestampMs(m) }))
      .filter(({ ts }) => ts >= windowStartMs)
      .sort((a, b) => a.ts - b.ts);

    for (const { m, ts } of msgs) {
      const bodyText = String(m.text || '').trim();
      const nonTextReply = !bodyText && m.type !== 'text';
      if (!bodyText && !nonTextReply) continue;

      const dedupeKey = buildInboundAutomationDedupeKey({
        connectionId,
        messageId: m.id,
        phoneDigits,
        timestampMs: ts,
        bodyText: bodyText || `[${m.type}]`,
      });
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      out.push({
        dedupeKey,
        phoneDigits,
        bodyText,
        nonTextReply,
        incomingConvId,
        timestampMs: ts,
      });
    }
  }

  return out.sort((a, b) => a.timestampMs - b.timestampMs);
}

async function loadHistoriesInBatches(
  convs: Conversation[],
  loadChatHistory: InboundReplayDeps['loadChatHistory'],
  limit: number
): Promise<void> {
  for (let i = 0; i < convs.length; i += MANUAL_LOAD_BATCH) {
    const batch = convs.slice(i, i + MANUAL_LOAD_BATCH);
    await Promise.all(batch.map((conv) => loadChatHistory(conv.id, limit).catch(() => ({ ok: false }))));
  }
}

export async function replayMissedInboundForConnection(
  connectionId: string,
  ownerUid: string | undefined,
  deps: InboundReplayDeps,
  options?: InboundReplayOptions
): Promise<InboundReplayResult> {
  const empty: InboundReplayResult = { scanned: 0, replayed: 0, skipped: 0, windowHours: 0 };
  if (!connectionId || !ownerUid) {
    return empty;
  }

  const manual = Boolean(options?.manual);
  const nowMs = Date.now();
  const lastClosed = deps.getLastClosedAt(connectionId);
  const windowStart = resolveInboundReplayWindowStart(nowMs, lastClosed, manual);
  const windowHours = Math.max(1, Math.round((nowMs - windowStart) / 3600_000));

  deps.log('[InboundReplay] Iniciando reprocessamento após reconexão', {
    connectionId,
    ownerUid,
    manual,
    windowHours,
    windowStart: new Date(windowStart).toISOString(),
    lastClosedAt: lastClosed ? new Date(lastClosed).toISOString() : undefined,
  });

  if (manual && deps.prefetchInbox) {
    await deps.prefetchInbox().catch(() => undefined);
  }

  let convs = deps.getConversations().filter((c) => c.connectionId === connectionId);

  const inWindow = convs
    .filter((c) => {
      if (conversationActivityMs(c) >= windowStart) return true;
      return (c.messages || []).some(
        (m) => m.sender === 'them' && messageTimestampMs(m) >= windowStart
      );
    })
    .sort((a, b) => conversationActivityMs(b) - conversationActivityMs(a));

  const toLoad = manual
    ? inWindow.slice(0, 120)
    : inWindow.filter((c) => (c.messages?.length ?? 0) <= 8).slice(0, 80);

  await loadHistoriesInBatches(toLoad, deps.loadChatHistory, manual ? 150 : 100);

  if (toLoad.length > 0 || (manual && deps.prefetchInbox)) {
    convs = deps.getConversations().filter((c) => c.connectionId === connectionId);
  }

  const candidates = collectInboundReplayCandidates(connectionId, convs, windowStart);
  let replayed = 0;
  let skipped = 0;

  for (const c of candidates) {
    if (replayed >= MAX_REPLAY_PER_CONNECT) break;
    if (await isInboundAutomationProcessed(c.dedupeKey)) {
      skipped += 1;
      continue;
    }

    await deps.processInbound({
      connectionId,
      phoneDigits: c.phoneDigits,
      bodyText: c.bodyText,
      nonTextReply: c.nonTextReply,
      incomingConvId: c.incomingConvId,
      messageOwnerUid: ownerUid,
      dedupeKey: c.dedupeKey,
      source: 'replay',
    });
    replayed += 1;

    if (REPLAY_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, REPLAY_DELAY_MS));
    }
  }

  deps.log('[InboundReplay] Reprocessamento concluído', {
    connectionId,
    scanned: candidates.length,
    replayed,
    skipped,
    windowHours,
    manual,
  });

  return { scanned: candidates.length, replayed, skipped, windowHours };
}
