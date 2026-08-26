import type { Contact } from '../src/types.js';
import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { reprocessReplyFlowInbound } from './evolutionService.js';
import { processContactOptOut } from './contactOptOutService.js';
import { findContactByPhoneKey, getContactById, updateContact } from './repositories/contactsRepository.js';
import { tryAutoEnrollOnOptIn } from './nurture/nurtureEngine.js';

export type LeadClassification = 'hot' | 'warm' | 'cold' | 'blacklist';

const LEAD_TAG: Record<LeadClassification, string> = {
  hot: 'lead:quente',
  warm: 'lead:morno',
  cold: 'lead:frio',
  blacklist: 'lead:lista-negra',
};

function mergeLeadTag(tags: string[], classification: LeadClassification): string[] {
  const without = tags.filter(
    (t) => !Object.values(LEAD_TAG).includes(String(t).trim().toLowerCase())
  );
  return [...without, LEAD_TAG[classification]];
}

export type ApplyLeadClassificationInput = {
  contactId?: string;
  phoneDigits: string;
  connectionId?: string;
  classification: LeadClassification;
  replyText?: string;
  reprocessFlow?: boolean;
  incomingConvId?: string;
};

export type ApplyLeadClassificationResult =
  | { ok: true; contact: Contact; classification: LeadClassification }
  | { ok: false; error: string; phoneDigits: string };

export async function applyLeadClassificationForTenant(
  tenantId: string,
  body: ApplyLeadClassificationInput
): Promise<ApplyLeadClassificationResult> {
  const classification = body.classification;
  if (!LEAD_TAG[classification]) {
    return { ok: false, error: 'classification inválida.', phoneDigits: body.phoneDigits };
  }

  const phoneDigits = normalizePhoneDigits(String(body.phoneDigits || ''));
  let contact: Contact | null = null;
  if (body.contactId) {
    contact = await getContactById(tenantId, String(body.contactId));
  }
  if (!contact && phoneDigits.length >= 8) {
    contact = (await findContactByPhoneKey(tenantId, normPhoneKey(phoneDigits))) || null;
  }
  if (!contact) {
    return { ok: false, error: 'Contato não encontrado.', phoneDigits };
  }

  const at = new Date().toISOString();
  const replySnippet = String(body.replyText || '').trim().slice(0, 200);
  let updated = contact;

  if (classification === 'blacklist') {
    await processContactOptOut({
      tenantId,
      phoneDigits: contact.phone,
      reason: `Classificação manual: lista negra${replySnippet ? ` — "${replySnippet}"` : ''}`,
      source: 'manual_chat',
      keyword: replySnippet || 'lista negra',
    });
    updated =
      (await updateContact(tenantId, contact.id, {
        marketingOptOut: true,
        marketingOptIn: false,
        marketingConsentAt: at,
        marketingConsentText: replySnippet || 'Lista negra (manual no chat)',
        tags: mergeLeadTag(contact.tags || [], 'blacklist'),
      })) || updated;
  } else if (classification === 'hot') {
    updated =
      (await updateContact(tenantId, contact.id, {
        marketingOptOut: false,
        marketingOptIn: true,
        marketingConsentAt: at,
        marketingConsentText: replySnippet || 'Lead quente (manual no chat)',
        tags: mergeLeadTag(contact.tags || [], 'hot'),
      })) || updated;
    void tryAutoEnrollOnOptIn({
      tenantId,
      phoneDigits: contact.phone,
      connectionId: body.connectionId,
    });
  } else if (classification === 'warm') {
    updated =
      (await updateContact(tenantId, contact.id, {
        tags: mergeLeadTag(contact.tags || [], 'warm'),
      })) || updated;
  } else {
    updated =
      (await updateContact(tenantId, contact.id, {
        marketingOptIn: false,
        tags: mergeLeadTag(contact.tags || [], 'cold'),
      })) || updated;
  }

  if (
    body.reprocessFlow &&
    body.connectionId &&
    phoneDigits.length >= 8 &&
    replySnippet &&
    classification !== 'blacklist'
  ) {
    await reprocessReplyFlowInbound({
      connectionId: String(body.connectionId),
      phoneDigits,
      bodyText: replySnippet,
      incomingConvId: body.incomingConvId,
    });
  }

  return { ok: true, contact: updated, classification };
}

export const APPLY_BATCH_MAX = 50;

export async function applyLeadClassificationBatchForTenant(
  tenantId: string,
  items: ApplyLeadClassificationInput[]
): Promise<{
  applied: number;
  skipped: number;
  errors: Array<{ phoneDigits: string; error: string }>;
}> {
  const capped = items.slice(0, APPLY_BATCH_MAX);
  let applied = 0;
  let skipped = 0;
  const errors: Array<{ phoneDigits: string; error: string }> = [];

  for (const item of capped) {
    const result = await applyLeadClassificationForTenant(tenantId, item);
    if (result.ok === true) {
      applied += 1;
      continue;
    }
    if (result.ok === false) {
      skipped += 1;
      errors.push({ phoneDigits: result.phoneDigits, error: result.error });
    }
  }

  return { applied, skipped, errors };
}
