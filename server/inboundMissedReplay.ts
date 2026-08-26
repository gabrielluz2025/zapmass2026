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
};

export type ReplayCandidate = {
  dedupeKey: string;
  phoneDigits: string;
  bodyText: string;
  nonTextReply: boolean;
  incomingConvId: string;
  timestampMs: number;
};

function messageTimestampMs(msg: ChatMessage): number {
  if (typeof msg.timestampMs === 'number' && msg.timestampMs > 0) return msg.timestampMs;
  const parsed = Date.parse(String(msg.timestamp || ''));
  return Number.isFinite(parsed) ? parsed : 0;
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

export async function replayMissedInboundForConnection(
  connectionId: string,
  ownerUid: string | undefined,
  deps: InboundReplayDeps
): Promise<{ scanned: number; replayed: number; skipped: number }> {
  if (!connectionId || !ownerUid) {
    return { scanned: 0, replayed: 0, skipped: 0 };
  }

  const lastClosed = deps.getLastClosedAt(connectionId);
  const windowStart = Math.max(
    Date.now() - MAX_LOOKBACK_MS,
    lastClosed ?? Date.now() - DEFAULT_LOOKBACK_MS
  );

  deps.log('[InboundReplay] Iniciando reprocessamento após reconexão', {
    connectionId,
    ownerUid,
    windowStart: new Date(windowStart).toISOString(),
    lastClosedAt: lastClosed ? new Date(lastClosed).toISOString() : undefined,
  });

  let convs = deps.getConversations().filter((c) => c.connectionId === connectionId);

  const sparse = convs
    .filter(
      (c) =>
        (c.lastMessageTimestamp || 0) >= windowStart &&
        (c.messages?.length ?? 0) <= 8
    )
    .slice(0, 80);

  for (const conv of sparse) {
    await deps.loadChatHistory(conv.id, 100).catch(() => ({ ok: false }));
  }

  if (sparse.length > 0) {
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
  });

  return { scanned: candidates.length, replayed, skipped };
}
