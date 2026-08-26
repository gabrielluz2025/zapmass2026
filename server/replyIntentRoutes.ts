import type { Express, Request, Response } from 'express';
import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { classifyReplyIntent, classifyReplyIntentFromHistory } from '../shared/replyFlowMatch.js';
import { fetchCampaignDoc } from './campaignStore.js';
import { requireTenant } from './httpTenant.js';
import { resolveActiveReplyFlowCampaignId } from './evolutionService.js';
import { findContactByPhoneKey } from './repositories/contactsRepository.js';
import {
  sanitizeReplyFlowMeta,
  sanitizeReplyFlowSteps,
} from './replyFlowEngine.js';
import { scanReplyIntentsForTenant } from './replyIntentScan.js';
import type { ReplyIntentKind } from '../shared/replyFlowMatch.js';
import {
  applyLeadClassificationBatchForTenant,
  applyLeadClassificationForTenant,
  APPLY_BATCH_MAX,
  type LeadClassification,
} from './replyIntentApply.js';
import { autoApplyReplyIntentsForTenant } from './replyIntentAutoApply.js';

export type { LeadClassification } from './replyIntentApply.js';

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

    const inboundOrdered: string[] = [];
    if (body.messages?.length) {
      for (const m of body.messages) {
        if (m.sender === 'them' && String(m.text || '').trim()) {
          inboundOrdered.push(String(m.text).trim());
        }
      }
    }
    if (body.bodyText?.trim()) inboundOrdered.push(body.bodyText.trim());
    if (inboundOrdered.length === 0) {
      return res.json({
        ok: true,
        campaignId: campaignId || null,
        campaignName: flowCtx?.campaignName || null,
        hasActiveSession: Boolean(resolveActiveReplyFlowCampaignId(connectionId, phoneDigits)),
        results: [],
        message: 'Nenhuma mensagem inbound para analisar.',
      });
    }

    const flowInput = flowCtx
      ? {
          globalOptOutKeywords: flowCtx.meta.globalOptOutKeywords,
          acceptAnyReply: flowCtx.gate.acceptAnyReply,
          validTokens: flowCtx.gate.validTokens,
          matchMode: flowCtx.gate.matchMode,
          options: flowCtx.gate.options,
          invalidReplyBody: flowCtx.gate.invalidReplyBody,
        }
      : undefined;

    const historyIntent = classifyReplyIntentFromHistory(inboundOrdered.slice(-12), flowInput);
    const displayTexts = inboundOrdered.slice(-8);
    const results = displayTexts.map((text, idx) => {
      const isLatest = idx === displayTexts.length - 1;
      return {
        text,
        intent: isLatest
          ? historyIntent
          : classifyReplyIntent(text, flowInput),
      };
    });

    const autoApplyClass =
      historyIntent.kind === 'opt_in' || historyIntent.kind === 'flow_match'
        ? 'hot'
        : historyIntent.kind === 'opt_out'
          ? 'blacklist'
          : null;

    return res.json({
      ok: true,
      campaignId: campaignId || null,
      campaignName: flowCtx?.campaignName || null,
      hasActiveSession: Boolean(resolveActiveReplyFlowCampaignId(connectionId, phoneDigits)),
      contactId: contact?.id || null,
      marketingOptIn: contact?.marketingOptIn ?? false,
      marketingOptOut: contact?.marketingOptOut ?? false,
      results,
      suggested: historyIntent.suggestedLeadClass || 'warm',
      queroThenSair: Boolean(historyIntent.queroThenSair),
      autoApplyClass,
    });
  });

  app.post('/api/reply-intent/auto-apply', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;

    const body = (req.body || {}) as { excludeWarmup?: boolean; dryRun?: boolean };

    try {
      const result = await autoApplyReplyIntentsForTenant(ctx.tenantId, {
        excludeWarmup: body.excludeWarmup,
        dryRun: body.dryRun,
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.warn('[reply-intent/auto-apply]', (e as Error)?.message || e);
      return res.status(500).json({ ok: false, error: 'Falha na classificação automática.' });
    }
  });

  app.post('/api/reply-intent/scan', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;

    const body = (req.body || {}) as {
      startIndex?: number;
      limit?: number;
      onlyWithInbound?: boolean;
      excludeWarmup?: boolean;
      intentKind?: ReplyIntentKind | 'no_inbound';
      search?: string;
    };

    try {
      const result = await scanReplyIntentsForTenant(ctx.tenantId, {
        startIndex: body.startIndex,
        limit: body.limit,
        onlyWithInbound: body.onlyWithInbound,
        excludeWarmup: body.excludeWarmup,
        intentKind: body.intentKind,
        search: body.search,
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.warn('[reply-intent/scan]', (e as Error)?.message || e);
      return res.status(500).json({ ok: false, error: 'Falha ao analisar conversas.' });
    }
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
    const result = await applyLeadClassificationForTenant(ctx.tenantId, {
      contactId: body.contactId,
      phoneDigits,
      connectionId: body.connectionId,
      classification,
      replyText: body.replyText,
      reprocessFlow: body.reprocessFlow,
      incomingConvId: body.incomingConvId,
    });

    if (result.ok === false) {
      return res.status(result.error === 'Contato não encontrado.' ? 404 : 400).json({
        ok: false,
        error: result.error,
      });
    }

    return res.json({
      ok: true,
      contact: result.contact,
      classification: result.classification,
    });
  });

  app.post('/api/reply-intent/apply-batch', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;

    const body = (req.body || {}) as {
      items?: Array<{
        contactId?: string;
        phoneDigits?: string;
        connectionId?: string;
        classification?: LeadClassification;
        replyText?: string;
        reprocessFlow?: boolean;
        incomingConvId?: string;
      }>;
    };

    const raw = Array.isArray(body.items) ? body.items : [];
    if (raw.length === 0) {
      return res.status(400).json({ ok: false, error: 'Informe ao menos um item.' });
    }
    if (raw.length > APPLY_BATCH_MAX) {
      return res.status(400).json({
        ok: false,
        error: `Máximo de ${APPLY_BATCH_MAX} contatos por lote.`,
      });
    }

    const items = raw
      .map((row) => {
        const classification = row.classification;
        const phoneDigits = normalizePhoneDigits(String(row.phoneDigits || ''));
        if (!classification || !LEAD_TAG[classification] || phoneDigits.length < 8) return null;
        return {
          contactId: row.contactId,
          phoneDigits,
          connectionId: row.connectionId,
          classification,
          replyText: row.replyText,
          reprocessFlow: row.reprocessFlow,
          incomingConvId: row.incomingConvId,
        };
      })
      .filter(Boolean) as Parameters<typeof applyLeadClassificationBatchForTenant>[1];

    if (items.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum item válido no lote.' });
    }

    try {
      const batch = await applyLeadClassificationBatchForTenant(ctx.tenantId, items);
      return res.json({ ok: true, ...batch });
    } catch (e) {
      console.warn('[reply-intent/apply-batch]', (e as Error)?.message || e);
      return res.status(500).json({ ok: false, error: 'Falha ao aplicar classificações.' });
    }
  });
}
