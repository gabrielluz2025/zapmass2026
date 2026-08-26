import { findActionableReplyInHistory, type ReplyIntentContext } from '../shared/replyFlowMatch.js';
import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { applyLeadClassificationForTenant } from './replyIntentApply.js';
import { fetchCampaignDoc } from './campaignStore.js';
import { findContactByPhoneKey } from './repositories/contactsRepository.js';
import { resolveActiveReplyFlowCampaignId } from './evolutionService.js';
import {
  sanitizeReplyFlowMeta,
  sanitizeReplyFlowSteps,
} from './replyFlowEngine.js';
import {
  collectScopedConversationsForIntent,
  inboundTextsFromMessages,
  isWarmupOnlyThread,
  phoneFromConversation,
  resolveMergedMessagesForScan,
} from './replyIntentScan.js';
import type { Conversation } from './types.js';

export type AutoApplyReplyIntentResult = {
  scanned: number;
  withInbound: number;
  eligible: number;
  appliedHot: number;
  appliedBlacklist: number;
  skippedNoContact: number;
  skippedWarmup: number;
  skippedNeutral: number;
  queroThenSair: number;
  errors: Array<{ phoneDigits: string; error: string }>;
  preview: Array<{
    contactName: string;
    phoneDigits: string;
    lastInboundText: string | null;
    classification: 'hot' | 'blacklist';
    queroThenSair: boolean;
  }>;
};

async function loadReplyFlowStepContext(tenantId: string, campaignId: string) {
  const doc = await fetchCampaignDoc(tenantId, campaignId);
  const rf = doc?.replyFlow as Record<string, unknown> | undefined;
  if (!rf?.enabled || !Array.isArray(rf.steps)) return null;
  const steps = sanitizeReplyFlowSteps(rf.steps as Parameters<typeof sanitizeReplyFlowSteps>[0]);
  const meta = sanitizeReplyFlowMeta(rf);
  const gate = steps[0];
  if (!gate) return null;
  return { meta, gate };
}

function flowInputFromCtx(
  flowCtx: NonNullable<Awaited<ReturnType<typeof loadReplyFlowStepContext>>>
): ReplyIntentContext {
  return {
    globalOptOutKeywords: flowCtx.meta.globalOptOutKeywords,
    acceptAnyReply: flowCtx.gate.acceptAnyReply,
    validTokens: flowCtx.gate.validTokens,
    matchMode: flowCtx.gate.matchMode,
    options: flowCtx.gate.options,
    invalidReplyBody: flowCtx.gate.invalidReplyBody,
  };
}

type EligibleRow = {
  conversationId: string;
  connectionId: string;
  phoneDigits: string;
  contactName: string;
  contactId: string | null;
  replyText: string;
  classification: 'hot' | 'blacklist';
  queroThenSair: boolean;
};

async function analyzeConversation(
  tenantId: string,
  conv: Conversation,
  excludeWarmup: boolean
): Promise<
  | { kind: 'no_inbound' }
  | { kind: 'warmup' }
  | { kind: 'neutral' }
  | { kind: 'eligible'; row: EligibleRow }
> {
  const connectionId = String(conv.connectionId || '').trim();
  const phoneDigits = phoneFromConversation(conv);
  if (!connectionId || phoneDigits.length < 8) return { kind: 'no_inbound' };

  const messages = await resolveMergedMessagesForScan(tenantId, conv);
  const inboundTexts = inboundTextsFromMessages(messages, 30);
  if (inboundTexts.length === 0) return { kind: 'no_inbound' };

  let campaignId = resolveActiveReplyFlowCampaignId(connectionId, phoneDigits) || '';
  const contact = (await findContactByPhoneKey(tenantId, normPhoneKey(phoneDigits))) || null;
  if (!campaignId && contact?.campaignTablePreview?.campaignId) {
    campaignId = contact.campaignTablePreview.campaignId;
  }

  const flowCtx = campaignId ? await loadReplyFlowStepContext(tenantId, campaignId) : null;
  const ctx = flowCtx ? flowInputFromCtx(flowCtx) : undefined;
  const actionable = findActionableReplyInHistory(inboundTexts, ctx);

  if (!actionable) {
    if (excludeWarmup && isWarmupOnlyThread(messages)) return { kind: 'warmup' };
    return { kind: 'neutral' };
  }

  return {
    kind: 'eligible',
    row: {
      conversationId: conv.id,
      connectionId,
      phoneDigits,
      contactName: conv.contactName || conv.contactPhone || phoneDigits,
      contactId: contact?.id || null,
      replyText: actionable.replyText,
      classification: actionable.classification,
      queroThenSair: actionable.queroThenSair,
    },
  };
}

export async function autoApplyReplyIntentsForTenant(
  tenantId: string,
  opts?: { excludeWarmup?: boolean; dryRun?: boolean }
): Promise<AutoApplyReplyIntentResult> {
  const excludeWarmup = opts?.excludeWarmup !== false;
  const dryRun = opts?.dryRun === true;

  const convs = await collectScopedConversationsForIntent(tenantId);
  const eligible: EligibleRow[] = [];
  let withInbound = 0;
  let skippedWarmup = 0;
  let skippedNeutral = 0;

  for (const conv of convs) {
    const result = await analyzeConversation(tenantId, conv, excludeWarmup);
    if (result.kind === 'no_inbound') continue;
    withInbound += 1;
    if (result.kind === 'warmup') {
      skippedWarmup += 1;
      continue;
    }
    if (result.kind === 'neutral') {
      skippedNeutral += 1;
      continue;
    }
    eligible.push(result.row);
  }

  const preview = eligible.map((row) => ({
    contactName: row.contactName,
    phoneDigits: row.phoneDigits,
    lastInboundText: row.replyText,
    classification: row.classification,
    queroThenSair: row.queroThenSair,
  }));

  const base = {
    scanned: convs.length,
    withInbound,
    eligible: eligible.length,
    appliedHot: eligible.filter((e) => e.classification === 'hot').length,
    appliedBlacklist: eligible.filter((e) => e.classification === 'blacklist').length,
    skippedNoContact: 0,
    skippedWarmup,
    skippedNeutral,
    queroThenSair: eligible.filter((e) => e.queroThenSair).length,
    errors: [] as Array<{ phoneDigits: string; error: string }>,
    preview,
  };

  if (dryRun) return base;

  let appliedHot = 0;
  let appliedBlacklist = 0;
  let skippedNoContact = 0;
  const errors: Array<{ phoneDigits: string; error: string }> = [];

  for (const row of eligible) {
    const result = await applyLeadClassificationForTenant(tenantId, {
      contactId: row.contactId || undefined,
      phoneDigits: row.phoneDigits,
      connectionId: row.connectionId,
      classification: row.classification,
      replyText: row.replyText,
      reprocessFlow: row.classification === 'hot',
      incomingConvId: row.conversationId,
    });
    if (result.ok === true) {
      if (row.classification === 'hot') appliedHot += 1;
      else appliedBlacklist += 1;
    } else if (result.ok === false) {
      skippedNoContact += 1;
      errors.push({ phoneDigits: result.phoneDigits, error: result.error });
    }
  }

  return {
    ...base,
    appliedHot,
    appliedBlacklist,
    skippedNoContact,
    errors,
    preview: preview.slice(0, 30),
  };
}
