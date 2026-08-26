import { collapseConversationsByPhone } from '../src/utils/collapseConversationsByPhone.js';
import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { classifyReplyIntent, classifyReplyIntentFromHistory, type ReplyIntentKind } from '../shared/replyFlowMatch.js';
import { isWarmupGreetingMessage } from '../shared/warmupMessages.js';
import { fetchCampaignDoc } from './campaignStore.js';
import { filterByConnectionScope } from './connectionScopeServer.js';
import {
  isWaChatArchiveEnabled,
  loadChatArchiveMessages,
  threadIdFromConversationId,
  usePostgresChatArchive,
} from './chatArchiveStore.js';
import { getConversations, resolveActiveReplyFlowCampaignId } from './evolutionService.js';
import { findContactByPhoneKey } from './repositories/contactsRepository.js';
import { listInboxThreadStubsPg } from './repositories/chatArchiveRepository.js';
import {
  sanitizeReplyFlowMeta,
  sanitizeReplyFlowSteps,
} from './replyFlowEngine.js';
import type { ChatMessage, Conversation } from './types.js';
type LeadClassification = 'hot' | 'warm' | 'cold' | 'blacklist';

export type ReplyIntentScanItem = {
  conversationId: string;
  connectionId: string;
  phoneDigits: string;
  contactName: string;
  contactId: string | null;
  lastInboundText: string | null;
  lastInboundAt: number | null;
  intentKind: ReplyIntentKind | 'no_inbound';
  intentLabel: string;
  suggestedLeadClass: LeadClassification;
  hasActiveSession: boolean;
  campaignId: string | null;
  campaignName: string | null;
  warmupThread: boolean;
  marketingOptIn: boolean;
  marketingOptOut: boolean;
  queroThenSair: boolean;
};

export type ReplyIntentScanSummary = {
  total: number;
  withInbound: number;
  hot: number;
  warm: number;
  cold: number;
  blacklist: number;
  neutral: number;
  noInbound: number;
  warmupOnly: number;
};

export type ReplyIntentScanOptions = {
  startIndex?: number;
  limit?: number;
  onlyWithInbound?: boolean;
  excludeWarmup?: boolean;
  intentKind?: ReplyIntentKind | 'no_inbound';
  search?: string;
};

async function loadReplyFlowStepContext(tenantId: string, campaignId: string) {
  const doc = await fetchCampaignDoc(tenantId, campaignId);
  const rf = doc?.replyFlow as Record<string, unknown> | undefined;
  if (!rf?.enabled || !Array.isArray(rf.steps)) return null;
  const steps = sanitizeReplyFlowSteps(rf.steps as Parameters<typeof sanitizeReplyFlowSteps>[0]);
  const meta = sanitizeReplyFlowMeta(rf);
  const gate = steps[0];
  if (!gate) return null;
  return {
    meta,
    gate,
    campaignName: String(doc?.name || doc?.title || campaignId),
  };
}

export function phoneFromConversation(conv: Conversation): string {
  const jid = conv.id || '';
  const afterColon = jid.includes(':') ? jid.slice(jid.indexOf(':') + 1) : jid;
  const user = afterColon.split('@')[0] || '';
  if (/^\d+$/.test(user)) return user;
  return normalizePhoneDigits(conv.contactPhone || user);
}

function lastInboundFromMessages(messages: ChatMessage[]): { text: string; at: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender !== 'them') continue;
    const text = String(m.text || '').trim();
    if (!text) continue;
    return { text, at: Number(m.timestampMs) || 0 };
  }
  return null;
}

export function inboundTextsFromMessages(messages: ChatMessage[], limit = 12): string[] {
  const texts: string[] = [];
  for (const m of messages) {
    if (m.sender !== 'them') continue;
    const text = String(m.text || '').trim();
    if (text) texts.push(text);
  }
  if (texts.length <= limit) return texts;
  return texts.slice(-limit);
}

export function isWarmupOnlyThread(messages: ChatMessage[]): boolean {
  const inbound = lastInboundFromMessages(messages);
  return isWarmupThread(messages, inbound);
}

function isWarmupThread(messages: ChatMessage[], inbound: { text: string } | null): boolean {
  if (!inbound || !isWarmupGreetingMessage(inbound.text)) return false;
  const hasCampaign = messages.some((m) => m.fromCampaign || m.campaignId);
  if (hasCampaign) return false;
  const lastMe = [...messages].reverse().find((m) => m.sender === 'me' && String(m.text || '').trim());
  if (lastMe && isWarmupGreetingMessage(String(lastMe.text))) return true;
  return messages.filter((m) => m.sender === 'them').every((m) => isWarmupGreetingMessage(String(m.text || '')));
}

export async function resolveMergedMessagesForScan(
  tenantId: string,
  conv: Conversation
): Promise<ChatMessage[]> {
  const ram = Array.isArray(conv.messages) ? conv.messages : [];
  if (!isWaChatArchiveEnabled()) return ram;

  const threadId = threadIdFromConversationId(conv.id, conv.contactPhone);
  if (!threadId) return ram;

  const archived = await loadChatArchiveMessages(tenantId, threadId, 250);
  if (archived.length === 0) return ram;

  const byId = new Map<string, ChatMessage>();
  for (const m of archived) byId.set(m.id, m);
  for (const m of ram) {
    const prev = byId.get(m.id);
    if (!prev) {
      byId.set(m.id, m);
      continue;
    }
    byId.set(m.id, {
      ...prev,
      ...m,
      timestampMs: Math.max(Number(prev.timestampMs) || 0, Number(m.timestampMs) || 0),
      fromCampaign: prev.fromCampaign || m.fromCampaign,
      campaignId: prev.campaignId || m.campaignId,
    });
  }
  return Array.from(byId.values()).sort(
    (a, b) => (Number(a.timestampMs) || 0) - (Number(b.timestampMs) || 0)
  );
}

async function resolveLastInbound(
  tenantId: string,
  conv: Conversation
): Promise<{ text: string; at: number; messages: ChatMessage[] } | null> {
  const messages = await resolveMergedMessagesForScan(tenantId, conv);
  const fromMerged = lastInboundFromMessages(messages);
  if (!fromMerged) return null;
  return { ...fromMerged, messages };
}

async function listAllInboxThreadStubsPg(tenantId: string): Promise<Conversation[]> {
  if (!usePostgresChatArchive()) return [];
  const all: Conversation[] = [];
  let cursorMs: number | null = null;
  for (let page = 0; page < 40; page++) {
    const batch = await listInboxThreadStubsPg(tenantId, { cursorMs, limit: 150 });
    if (batch.length === 0) break;
    all.push(...batch);
    const last = batch[batch.length - 1];
    const nextCursor = last?.lastMessageTimestamp ?? null;
    if (nextCursor == null || batch.length < 150) break;
    cursorMs = nextCursor;
  }
  return all;
}

export async function collectScopedConversationsForIntent(tenantId: string): Promise<Conversation[]> {
  const live = filterByConnectionScope(tenantId, getConversations());
  const merged = [...live];

  if (usePostgresChatArchive()) {
    const stubs = await listAllInboxThreadStubsPg(tenantId);
    const scopedStubs = filterByConnectionScope(tenantId, stubs);
    const byId = new Map<string, Conversation>();
    for (const c of merged) byId.set(c.id, c);
    for (const stub of scopedStubs) {
      if (!byId.has(stub.id)) byId.set(stub.id, stub);
    }
    return collapseConversationsByPhone(Array.from(byId.values()));
  }

  return collapseConversationsByPhone(merged);
}

function matchesSearch(conv: Conversation, phoneDigits: string, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const name = String(conv.contactName || '').toLowerCase();
  const phone = phoneDigits.toLowerCase();
  return name.includes(q) || phone.includes(q) || String(conv.contactPhone || '').includes(q);
}

export async function scanReplyIntentsForTenant(
  tenantId: string,
  opts: ReplyIntentScanOptions = {}
): Promise<{
  items: ReplyIntentScanItem[];
  summary: ReplyIntentScanSummary;
  nextStartIndex: number;
  hasMore: boolean;
  totalCandidates: number;
}> {
  const limit = Math.max(1, Math.min(80, opts.limit ?? 40));
  const startIndex = Math.max(0, Math.floor(opts.startIndex ?? 0));
  const onlyWithInbound = opts.onlyWithInbound !== false;
  const excludeWarmup = opts.excludeWarmup === true;
  const search = String(opts.search || '').trim();

  const all = await collectScopedConversationsForIntent(tenantId);
  const sorted = [...all].sort(
    (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
  );

  const searchFiltered = search
    ? sorted.filter((conv) => {
        const phoneDigits = phoneFromConversation(conv);
        return matchesSearch(conv, phoneDigits, search);
      })
    : sorted;

  const summary: ReplyIntentScanSummary = {
    total: sorted.length,
    withInbound: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    blacklist: 0,
    neutral: 0,
    noInbound: 0,
    warmupOnly: 0,
  };

  if (startIndex === 0) {
    for (const conv of searchFiltered) {
      const messages = await resolveMergedMessagesForScan(tenantId, conv);
      const inbound = lastInboundFromMessages(messages);
      const warmupThread = isWarmupThread(messages, inbound);
      if (!inbound) {
        summary.noInbound += 1;
        continue;
      }
      summary.withInbound += 1;
      if (warmupThread) summary.warmupOnly += 1;
      const intent = classifyReplyIntentFromHistory(inboundTextsFromMessages(messages, 20));
      if (intent.kind === 'opt_in' || intent.kind === 'flow_match') summary.hot += 1;
      else if (intent.kind === 'opt_out') summary.blacklist += 1;
      else if (intent.kind === 'flow_invalid') summary.cold += 1;
      else if (intent.kind === 'neutral' || intent.kind === 'polite_ack') summary.neutral += 1;
      else summary.warm += 1;
    }
  }

  const items: ReplyIntentScanItem[] = [];
  let index = startIndex;

  for (; index < searchFiltered.length && items.length < limit; index++) {
    const conv = searchFiltered[index];
    const connectionId = String(conv.connectionId || '').trim();
    const phoneDigits = phoneFromConversation(conv);
    if (!connectionId || phoneDigits.length < 8) continue;

    const ts = conv.lastMessageTimestamp || 0;

    const inbound = await resolveLastInbound(tenantId, conv);
    const messages = inbound?.messages ?? (Array.isArray(conv.messages) ? conv.messages : []);
    const warmupThread = isWarmupThread(messages, inbound);

    if (!inbound) {
      if (onlyWithInbound) continue;
      if (opts.intentKind && opts.intentKind !== 'no_inbound') continue;

      items.push({
        conversationId: conv.id,
        connectionId,
        phoneDigits,
        contactName: conv.contactName || conv.contactPhone || phoneDigits,
        contactId: null,
        lastInboundText: null,
        lastInboundAt: null,
        intentKind: 'no_inbound',
        intentLabel: 'Sem resposta inbound',
        suggestedLeadClass: 'cold',
        hasActiveSession: Boolean(resolveActiveReplyFlowCampaignId(connectionId, phoneDigits)),
        campaignId: null,
        campaignName: null,
        warmupThread: false,
        marketingOptIn: false,
        marketingOptOut: false,
        queroThenSair: false,
      });
    } else {
      if (excludeWarmup && warmupThread) continue;

      let campaignId =
        resolveActiveReplyFlowCampaignId(connectionId, phoneDigits) ||
        '';
      const contact = (await findContactByPhoneKey(tenantId, normPhoneKey(phoneDigits))) || null;
      if (!campaignId && contact?.campaignTablePreview?.campaignId) {
        campaignId = contact.campaignTablePreview.campaignId;
      }

      const flowCtx = campaignId ? await loadReplyFlowStepContext(tenantId, campaignId) : null;
      const intent = classifyReplyIntentFromHistory(
        inboundTextsFromMessages(messages, 20),
        flowCtx
          ? {
              globalOptOutKeywords: flowCtx.meta.globalOptOutKeywords,
              acceptAnyReply: flowCtx.gate.acceptAnyReply,
              validTokens: flowCtx.gate.validTokens,
              matchMode: flowCtx.gate.matchMode,
              options: flowCtx.gate.options,
              invalidReplyBody: flowCtx.gate.invalidReplyBody,
            }
          : undefined
      );

      const suggested = intent.suggestedLeadClass || 'warm';

      if (opts.intentKind && opts.intentKind !== intent.kind) continue;

      items.push({
        conversationId: conv.id,
        connectionId,
        phoneDigits,
        contactName: conv.contactName || conv.contactPhone || phoneDigits,
        contactId: contact?.id || null,
        lastInboundText: inbound.text,
        lastInboundAt: inbound.at || ts || null,
        intentKind: intent.kind,
        intentLabel: intent.label,
        suggestedLeadClass: suggested,
        hasActiveSession: Boolean(resolveActiveReplyFlowCampaignId(connectionId, phoneDigits)),
        campaignId: campaignId || null,
        campaignName: flowCtx?.campaignName || null,
        warmupThread,
        marketingOptIn: contact?.marketingOptIn ?? false,
        marketingOptOut: contact?.marketingOptOut ?? false,
        queroThenSair: Boolean(intent.queroThenSair),
      });
    }

    if (items.length >= limit) break;
  }

  const nextStartIndex = index + 1;

  return {
    items,
    summary,
    nextStartIndex,
    hasMore: nextStartIndex < searchFiltered.length,
    totalCandidates: searchFiltered.length,
  };
}
