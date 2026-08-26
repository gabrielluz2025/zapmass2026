import { applyLeadClassificationForTenant } from './replyIntentApply.js';
import { scanReplyIntentsForTenant, type ReplyIntentScanItem } from './replyIntentScan.js';

export type AutoApplyReplyIntentResult = {
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
    classification: 'hot' | 'blacklist';
    queroThenSair: boolean;
  }>;
};

function toApplyPayload(row: ReplyIntentScanItem, classification: 'hot' | 'blacklist') {
  return {
    contactId: row.contactId || undefined,
    phoneDigits: row.phoneDigits,
    connectionId: row.connectionId,
    classification,
    replyText: row.lastInboundText || undefined,
    reprocessFlow: classification === 'hot',
    incomingConvId: row.conversationId,
  };
}

export async function autoApplyReplyIntentsForTenant(
  tenantId: string,
  opts?: { excludeWarmup?: boolean; dryRun?: boolean }
): Promise<AutoApplyReplyIntentResult> {
  const excludeWarmup = opts?.excludeWarmup !== false;
  const dryRun = opts?.dryRun === true;

  const all: ReplyIntentScanItem[] = [];
  let startIndex = 0;
  for (;;) {
    const page = await scanReplyIntentsForTenant(tenantId, {
      startIndex,
      limit: 80,
      onlyWithInbound: true,
      excludeWarmup,
    });
    all.push(...page.items);
    if (!page.hasMore) break;
    startIndex = page.nextStartIndex;
  }

  const eligible: Array<{ row: ReplyIntentScanItem; classification: 'hot' | 'blacklist' }> = [];
  for (const row of all) {
    if (row.intentKind === 'opt_in' || row.intentKind === 'flow_match') {
      eligible.push({ row, classification: 'hot' });
      continue;
    }
    if (row.intentKind === 'opt_out') {
      eligible.push({ row, classification: 'blacklist' });
    }
  }

  const preview = eligible.map(({ row, classification }) => ({
    contactName: row.contactName,
    phoneDigits: row.phoneDigits,
    lastInboundText: row.lastInboundText,
    classification,
    queroThenSair: row.queroThenSair,
  }));

  if (dryRun) {
    return {
      scanned: all.length,
      eligible: eligible.length,
      appliedHot: eligible.filter((e) => e.classification === 'hot').length,
      appliedBlacklist: eligible.filter((e) => e.classification === 'blacklist').length,
      skippedNoContact: 0,
      queroThenSair: eligible.filter((e) => e.row.queroThenSair).length,
      errors: [],
      preview,
    };
  }

  let appliedHot = 0;
  let appliedBlacklist = 0;
  let skippedNoContact = 0;
  const errors: Array<{ phoneDigits: string; error: string }> = [];

  for (const { row, classification } of eligible) {
    const result = await applyLeadClassificationForTenant(tenantId, toApplyPayload(row, classification));
    if (result.ok === true) {
      if (classification === 'hot') appliedHot += 1;
      else appliedBlacklist += 1;
    } else if (result.ok === false) {
      skippedNoContact += 1;
      errors.push({ phoneDigits: result.phoneDigits, error: result.error });
    }
  }

  return {
    scanned: all.length,
    eligible: eligible.length,
    appliedHot,
    appliedBlacklist,
    skippedNoContact,
    queroThenSair: eligible.filter((e) => e.row.queroThenSair).length,
    errors,
    preview: preview.slice(0, 30),
  };
}
