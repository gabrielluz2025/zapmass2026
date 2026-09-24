import { findActionableReplyInHistory, type ReplyIntentContext } from '../shared/replyFlowMatch.js';
import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { contactIsBlacklisted, leadTempFromContact } from '../src/utils/contactTemperature.js';
import { applyLeadClassificationForTenant } from './replyIntentApply.js';
import { isContactOptedOut } from './contactOptOutService.js';
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
import { routeInboundReplyWithoutSession } from './replyFlowCatchUp.js';
import type { Contact, Conversation } from '../src/types.js';

export type AutoApplyReplyIntentResult = {
  scanned: number;
  withInbound: number;
  eligible: number;
  appliedHot: number;
  appliedBlacklist: number;
  skippedAlreadyApplied: number;
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

function dedupeEligibleRows(rows: EligibleRow[]): EligibleRow[] {
  const byKey = new Map<string, EligibleRow>();
  for (const row of rows) {
    const key = `${row.phoneDigits}:${row.classification}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function replyIntentAlreadyApplied(
  tenantId: string,
  phoneDigits: string,
  contact: Contact | null,
  classification: 'hot' | 'blacklist'
): Promise<boolean> {
  if (classification === 'blacklist') {
    if (await isContactOptedOut(tenantId, phoneDigits)) return true;
    if (contact && contactIsBlacklisted(contact)) return true;
    return false;
  }
  if (contact && contactIsBlacklisted(contact)) return true;
  if (contact && leadTempFromContact(contact) === 'hot') return true;
  return false;
}

async function analyzeConversation(
  tenantId: string,
  conv: Conversation,
  excludeWarmup: boolean
): Promise<
  | { kind: 'no_inbound' }
  | { kind: 'warmup' }
  | { kind: 'neutral' }
  | { kind: 'already_applied' }
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

  if (await replyIntentAlreadyApplied(tenantId, phoneDigits, contact, actionable.classification)) {
    return { kind: 'already_applied' };
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
  let skippedAlreadyApplied = 0;

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
    if (result.kind === 'already_applied') {
      skippedAlreadyApplied += 1;
      continue;
    }
    eligible.push(result.row);
  }

  const deduped = dedupeEligibleRows(eligible);

  const preview = deduped.map((row) => ({
    contactName: row.contactName,
    phoneDigits: row.phoneDigits,
    lastInboundText: row.replyText,
    classification: row.classification,
    queroThenSair: row.queroThenSair,
  }));

  const base = {
    scanned: convs.length,
    withInbound,
    eligible: deduped.length,
    appliedHot: deduped.filter((e) => e.classification === 'hot').length,
    appliedBlacklist: deduped.filter((e) => e.classification === 'blacklist').length,
    skippedAlreadyApplied,
    skippedNoContact: 0,
    skippedWarmup,
    skippedNeutral,
    queroThenSair: deduped.filter((e) => e.queroThenSair).length,
    errors: [] as Array<{ phoneDigits: string; error: string }>,
    preview,
  };

  if (dryRun) return base;

  let appliedHot = 0;
  let appliedBlacklist = 0;
  let skippedNoContact = 0;
  const errors: Array<{ phoneDigits: string; error: string }> = [];

  for (const row of deduped) {
    const result = await applyLeadClassificationForTenant(tenantId, {
      contactId: row.contactId || undefined,
      phoneDigits: row.phoneDigits,
      connectionId: row.connectionId,
      classification: row.classification,
      replyText: row.replyText,
      reprocessFlow: false,
      incomingConvId: row.conversationId,
    });
    if (result.ok === true) {
      if (row.classification === 'hot') appliedHot += 1;
      else appliedBlacklist += 1;
      continue;
    }
    if (result.ok === false && result.error === 'Contato não encontrado.' && row.classification === 'hot') {
      const routed = await routeInboundReplyWithoutSession({
        tenantId,
        connectionId: row.connectionId,
        phoneDigits: row.phoneDigits,
        bodyText: row.replyText,
        incomingConvId: row.conversationId,
        cancelJobs: async () => 0,
      });
      if (routed.handled) {
        if (row.classification === 'hot') appliedHot += 1;
        continue;
      }
    }
    if (result.ok === false) {
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
