import type { Express, Request, Response } from 'express';
import type { Contact } from '../src/types.js';
import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { classifyReplyIntent } from '../shared/replyFlowMatch.js';
import { fetchCampaignDoc } from './campaignStore.js';
import { requireTenant } from './httpTenant.js';
import {
  reprocessReplyFlowInbound,
  resolveActiveReplyFlowCampaignId,
} from './evolutionService.js';
import { processContactOptOut } from './contactOptOutService.js';
import { findContactByPhoneKey, getContactById, updateContact } from './repositories/contactsRepository.js';
import { tryAutoEnrollOnOptIn } from './nurture/nurtureEngine.js';
import {
  sanitizeReplyFlowMeta,
  sanitizeReplyFlowSteps,
} from './replyFlowEngine.js';

export type LeadClassification = 'hot' | 'warm' | 'cold' | 'blacklist';

const LEAD_TAG: Record<LeadClassification, string> = {
  hot: 'lead:quente',
  warm: 'lead:morno',
  cold: 'lead:frio',
  blacklist: 'lead:lista-negra',
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
    steps,
    campaignName: String(doc?.name || doc?.title || campaignId),
  };
}

function mergeLeadTag(tags: string[], classification: LeadClassification): string[] {
  const without = tags.filter(
    (t) => !Object.values(LEAD_TAG).includes(String(t).trim().toLowerCase())
  );
  return [...without, LEAD_TAG[classification]];
}

export function registerReplyIntentRoutes(app: Express): void {
  app.post('/api/reply-intent/inspect', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;

    const body = (req.body || {}) as {
      connectionId?: string;
      phoneDigits?: string;
      bodyText?: string;
      campaignId?: string;
      messages?: Array<{ text?: string; sender?: string; timestamp?: string }>;
    };

    const connectionId = String(body.connectionId || '').trim();
    const phoneDigits = normalizePhoneDigits(String(body.phoneDigits || ''));
    if (!connectionId || phoneDigits.length < 8) {
      return res.status(400).json({ ok: false, error: 'connectionId e phoneDigits são obrigatórios.' });
    }

    let campaignId =
      String(body.campaignId || '').trim() ||
      resolveActiveReplyFlowCampaignId(connectionId, phoneDigits) ||
      '';

    const contact =
      (await findContactByPhoneKey(ctx.tenantId, normPhoneKey(phoneDigits))) || null;
    if (!campaignId && contact?.campaignTablePreview?.campaignId) {
      campaignId = contact.campaignTablePreview.campaignId;
    }

    const flowCtx = campaignId ? await loadReplyFlowStepContext(ctx.tenantId, campaignId) : null;

    const inboundTexts: string[] = [];
    if (body.messages?.length) {
      for (const m of body.messages) {
        if (m.sender === 'them' && String(m.text || '').trim()) {
          inboundTexts.push(String(m.text).trim());
        }
      }
    }
    if (body.bodyText?.trim()) inboundTexts.push(body.bodyText.trim());
    if (inboundTexts.length === 0) {
      return res.json({
        ok: true,
        campaignId: campaignId || null,
        campaignName: flowCtx?.campaignName || null,
        hasActiveSession: Boolean(resolveActiveReplyFlowCampaignId(connectionId, phoneDigits)),
        results: [],
        message: 'Nenhuma mensagem inbound para analisar.',
      });
    }

    const unique = [...new Set(inboundTexts)].slice(-8);
    const results = unique.map((text) => ({
      text,
      intent: classifyReplyIntent(text, flowCtx
        ? {
            globalOptOutKeywords: flowCtx.meta.globalOptOutKeywords,
            acceptAnyReply: flowCtx.gate.acceptAnyReply,
            validTokens: flowCtx.gate.validTokens,
            matchMode: flowCtx.gate.matchMode,
            options: flowCtx.gate.options,
            invalidReplyBody: flowCtx.gate.invalidReplyBody,
          }
        : undefined),
    }));

    const latest = results[results.length - 1];

    return res.json({
      ok: true,
      campaignId: campaignId || null,
      campaignName: flowCtx?.campaignName || null,
      hasActiveSession: Boolean(resolveActiveReplyFlowCampaignId(connectionId, phoneDigits)),
      contactId: contact?.id || null,
      marketingOptIn: contact?.marketingOptIn ?? false,
      marketingOptOut: contact?.marketingOptOut ?? false,
      results,
      suggested: latest?.intent.suggestedLeadClass || 'warm',
    });
  });

  app.post('/api/reply-intent/apply', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;

    const body = (req.body || {}) as {
      contactId?: string;
      phoneDigits?: string;
      connectionId?: string;
      classification?: LeadClassification;
      replyText?: string;
      reprocessFlow?: boolean;
      incomingConvId?: string;
    };

    const classification = body.classification;
    if (!classification || !LEAD_TAG[classification]) {
      return res.status(400).json({ ok: false, error: 'classification inválida.' });
    }

    const phoneDigits = normalizePhoneDigits(String(body.phoneDigits || ''));
    let contact: Contact | null = null;
    if (body.contactId) {
      contact = await getContactById(ctx.tenantId, String(body.contactId));
    }
    if (!contact && phoneDigits.length >= 8) {
      contact = (await findContactByPhoneKey(ctx.tenantId, normPhoneKey(phoneDigits))) || null;
    }
    if (!contact) {
      return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
    }

    const at = new Date().toISOString();
    const replySnippet = String(body.replyText || '').trim().slice(0, 200);
    let updated = contact;
    let reprocess: { hadSessionBefore: boolean; hasSessionAfter: boolean } | null = null;

    if (classification === 'blacklist') {
      await processContactOptOut({
        tenantId: ctx.tenantId,
        phoneDigits: contact.phone,
        reason: `Classificação manual: lista negra${replySnippet ? ` — "${replySnippet}"` : ''}`,
        source: 'manual_chat',
        keyword: replySnippet || 'lista negra',
      });
      updated =
        (await updateContact(ctx.tenantId, contact.id, {
          marketingOptOut: true,
          marketingOptIn: false,
          marketingConsentAt: at,
          marketingConsentText: replySnippet || 'Lista negra (manual no chat)',
          tags: mergeLeadTag(contact.tags || [], 'blacklist'),
        })) || updated;
    } else if (classification === 'hot') {
      updated =
        (await updateContact(ctx.tenantId, contact.id, {
          marketingOptOut: false,
          marketingOptIn: true,
          marketingConsentAt: at,
          marketingConsentText: replySnippet || 'Lead quente (manual no chat)',
          tags: mergeLeadTag(contact.tags || [], 'hot'),
        })) || updated;
      void tryAutoEnrollOnOptIn({
        tenantId: ctx.tenantId,
        phoneDigits: contact.phone,
        connectionId: body.connectionId,
      });
    } else if (classification === 'warm') {
      updated =
        (await updateContact(ctx.tenantId, contact.id, {
          tags: mergeLeadTag(contact.tags || [], 'warm'),
        })) || updated;
    } else {
      updated =
        (await updateContact(ctx.tenantId, contact.id, {
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
      reprocess = await reprocessReplyFlowInbound({
        connectionId: String(body.connectionId),
        phoneDigits,
        bodyText: replySnippet,
        incomingConvId: body.incomingConvId,
      });
    }

    return res.json({
      ok: true,
      contact: updated,
      classification,
      reprocess,
    });
  });
}
