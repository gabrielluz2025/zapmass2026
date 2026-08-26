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
  queroThenSair?: boolean;
  autoApplyClass?: LeadClassification | null;
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

export type AutoApplyReplyIntentResult = {
  ok: boolean;
  scanned: number;
  eligible: number;
  appliedHot: number;
  appliedBlacklist: number;
  skippedNoContact: number;
  queroThenSair: number;
  errors: Array<{ phoneDigits: string; error: string }>;
  preview: Array<{
    contactName: string;
    phoneDigits: string;
    lastInboundText: string | null;
    classification: LeadClassification;
    queroThenSair: boolean;
  }>;
};

export async function autoApplyReplyIntents(params?: {
  excludeWarmup?: boolean;
  dryRun?: boolean;
}): Promise<AutoApplyReplyIntentResult> {
  return apiFetchJson<AutoApplyReplyIntentResult>('/api/reply-intent/auto-apply', {
    method: 'POST',
    body: JSON.stringify(params || {}),
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

export type ApplyLeadBatchResult = {
  ok: boolean;
  applied: number;
  skipped: number;
  errors: Array<{ phoneDigits: string; error: string }>;
};

export async function applyLeadClassificationBatch(
  items: Array<{
    contactId?: string;
    phoneDigits: string;
    connectionId?: string;
    classification: LeadClassification;
    replyText?: string;
    reprocessFlow?: boolean;
    incomingConvId?: string;
  }>
): Promise<ApplyLeadBatchResult> {
  return apiFetchJson<ApplyLeadBatchResult>('/api/reply-intent/apply-batch', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function fetchAllReplyIntentScanItems(params: {
  onlyWithInbound?: boolean;
  excludeWarmup?: boolean;
  intentKind?: string;
  search?: string;
}): Promise<ReplyIntentScanItem[]> {
  const all: ReplyIntentScanItem[] = [];
  let startIndex = 0;
  for (;;) {
    const page = await scanReplyIntents({ ...params, startIndex, limit: 80 });
    all.push(...page.items);
    if (!page.hasMore) break;
    startIndex = page.nextStartIndex;
  }
  return all;
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadReplyIntentScanCsv(items: ReplyIntentScanItem[], filename = 'intencoes-resposta.csv'): void {
  const CLASS_LABEL: Record<LeadClassification, string> = {
    hot: 'Quente',
    warm: 'Morno',
    cold: 'Frio',
    blacklist: 'Lista negra',
  };
  const rows = [
    [
      'Nome',
      'Telefone',
      'Resposta',
      'Intenção',
      'Sugestão',
      'Campanha',
      'Data resposta',
      'Aquecimento',
      'Fluxo ativo',
    ],
    ...items.map((row) => [
      row.contactName,
      row.phoneDigits,
      row.lastInboundText || '',
      row.intentLabel,
      CLASS_LABEL[row.suggestedLeadClass],
      row.campaignName || '',
      row.lastInboundAt ? new Date(row.lastInboundAt).toLocaleString('pt-BR') : '',
      row.warmupThread ? 'sim' : 'não',
      row.hasActiveSession ? 'sim' : 'não',
    ]),
  ];
  const csv = '\uFEFF' + rows.map((r) => r.map(csvEscape).join(';')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

export function replyIntentScanToApplyPayload(row: ReplyIntentScanItem) {
  const classification = row.suggestedLeadClass;
  return {
    contactId: row.contactId || undefined,
    phoneDigits: row.phoneDigits,
    connectionId: row.connectionId,
    classification,
    replyText: row.lastInboundText || undefined,
    reprocessFlow: classification === 'hot' || classification === 'warm',
    incomingConvId: row.conversationId,
  };
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
