import type { Contact, Conversation } from '../types';
import type { ClassifyReplyIntentResult } from '../../shared/replyFlowMatch';
import { apiFetchJson } from '../utils/apiFetchAuth';
import { normalizePhoneDigits } from '../utils/contactPhoneLookup';

export type LeadClassification = 'hot' | 'warm' | 'cold' | 'blacklist';

export type ReplyIntentInspectResult = {
  ok: boolean;
  campaignId: string | null;
  campaignName: string | null;
  hasActiveSession: boolean;
  contactId: string | null;
  marketingOptIn: boolean;
  marketingOptOut: boolean;
  results: Array<{ text: string; intent: ClassifyReplyIntentResult }>;
  suggested: LeadClassification;
  message?: string;
};

export type ReplyIntentScanItem = {
  conversationId: string;
  connectionId: string;
  phoneDigits: string;
  contactName: string;
  contactId: string | null;
  lastInboundText: string | null;
  lastInboundAt: number | null;
  intentKind: string;
  intentLabel: string;
  suggestedLeadClass: LeadClassification;
  hasActiveSession: boolean;
  campaignId: string | null;
  campaignName: string | null;
  warmupThread: boolean;
  marketingOptIn: boolean;
  marketingOptOut: boolean;
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

export type ReplyIntentScanResult = {
  ok: boolean;
  items: ReplyIntentScanItem[];
  summary: ReplyIntentScanSummary;
  nextStartIndex: number;
  hasMore: boolean;
  totalCandidates: number;
};

export async function scanReplyIntents(params: {
  startIndex?: number;
  limit?: number;
  onlyWithInbound?: boolean;
  excludeWarmup?: boolean;
  intentKind?: string;
  search?: string;
}): Promise<ReplyIntentScanResult> {
  return apiFetchJson<ReplyIntentScanResult>('/api/reply-intent/scan', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function inspectReplyIntent(params: {
  connectionId: string;
  phoneDigits: string;
  messages?: Conversation['messages'];
  bodyText?: string;
  campaignId?: string;
}): Promise<ReplyIntentInspectResult> {
  return apiFetchJson<ReplyIntentInspectResult>('/api/reply-intent/inspect', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function applyLeadClassification(params: {
  contactId?: string;
  phoneDigits: string;
  connectionId?: string;
  classification: LeadClassification;
  replyText?: string;
  reprocessFlow?: boolean;
  incomingConvId?: string;
}): Promise<{ ok: boolean; contact: Contact; classification: LeadClassification }> {
  return apiFetchJson('/api/reply-intent/apply', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function lastInboundTexts(conversation: Conversation, limit = 5): string[] {
  const msgs = conversation.messages || [];
  const texts: string[] = [];
  for (let i = msgs.length - 1; i >= 0 && texts.length < limit; i--) {
    const m = msgs[i];
    if (m.sender === 'them' && String(m.text || '').trim()) {
      texts.unshift(String(m.text).trim());
    }
  }
  return texts;
}

export function phoneFromConversation(conv: Conversation): string {
  const jid = conv.id || '';
  const user = jid.split('@')[0] || '';
  if (/^\d+$/.test(user)) return user;
  return normalizePhoneDigits(conv.contactPhone || user);
}
