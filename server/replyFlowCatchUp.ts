import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import {
  classifyReplyIntent,
  findBestMatchingOption,
  type ReplyMatchMode,
} from '../shared/replyFlowMatch.js';
import { fetchCampaignDoc } from './campaignStore.js';
import { processContactOptOut } from './contactOptOutService.js';
import { getZapmassPool, isZapmassPostgresConfigured } from './db/postgres.js';
import { resolvePostgresTenantId } from './auth/firebaseUidMap.js';
import {
  parseReplyFlowDefFromCampaignDoc,
  sanitizeReplyFlowMeta,
  type ReplyFlowStepDef,
} from './replyFlowEngine.js';
import { findContactByPhoneKey, updateContact } from './repositories/contactsRepository.js';
import { tryAutoEnrollHotLead } from './nurture/nurtureHotLeads.js';
import { tryAutoEnrollOnOptIn } from './nurture/nurtureEngine.js';
import { resolveLatestCampaignForReply } from './whatsappService.js';

const LEAD_TAG = {
  hot: 'lead:quente',
  blacklist: 'lead:lista-negra',
} as const;

export type ResolveCampaignForReply = {
  campaignId: string;
  ownerUid?: string;
  connectionId?: string;
};

async function resolveCampaignFromPostgres(
  tenantId: string,
  connectionId: string,
  phoneDigits: string
): Promise<ResolveCampaignForReply | null> {
  if (!isZapmassPostgresConfigured()) return null;
  const pool = getZapmassPool();
  if (!pool) return null;
  const tid = resolvePostgresTenantId(tenantId);
  const phone = normalizePhoneDigits(phoneDigits);
  if (phone.length < 8) return null;
  const suffix = phone.slice(-8);
  try {
    const r = await pool.query<{ campaign_id: string; connection_id: string }>(
      `SELECT campaign_id::text, connection_id
         FROM zapmass.campaign_jobs
        WHERE tenant_id = $1::uuid
          AND status = 'sent'
          AND connection_id = $2
          AND (
            regexp_replace(to_number, '\\D', '', 'g') = $3
            OR right(regexp_replace(to_number, '\\D', '', 'g'), 8) = $4
          )
        ORDER BY sent_at DESC NULLS LAST
        LIMIT 1`,
      [tid, connectionId, phone, suffix]
    );
    const row = r.rows[0];
    if (!row?.campaign_id) return null;
    return { campaignId: row.campaign_id, ownerUid: tenantId, connectionId: row.connection_id };
  } catch {
    return null;
  }
}

export async function resolveCampaignForInboundReply(
  tenantId: string,
  connectionId: string,
  phoneDigits: string
): Promise<ResolveCampaignForReply | null> {
  const fromRam = resolveLatestCampaignForReply(connectionId, phoneDigits);
  if (fromRam.campaignId) {
    return {
      campaignId: fromRam.campaignId,
      ownerUid: fromRam.ownerUid || tenantId,
      connectionId,
    };
  }
  const fromPg = await resolveCampaignFromPostgres(tenantId, connectionId, phoneDigits);
  return fromPg;
}

async function loadGateStep(
  tenantId: string,
  campaignId: string
): Promise<{ steps: ReplyFlowStepDef[]; gate: ReplyFlowStepDef; meta: ReturnType<typeof sanitizeReplyFlowMeta> } | null> {
  const doc = await fetchCampaignDoc(tenantId, campaignId);
  const parsed = parseReplyFlowDefFromCampaignDoc(doc);
  if (!parsed?.steps?.length) return null;
  const gate = parsed.steps[0];
  if (!gate) return null;
  return { steps: parsed.steps, gate, meta: parsed.meta };
}

function marketingEffectFromGateMatch(
  gate: ReplyFlowStepDef,
  bodyText: string
): 'opt_in' | 'opt_out' | null {
  const options = gate.options || [];
  if (options.length === 0) return null;
  const hit = findBestMatchingOption(
    options,
    bodyText,
    (gate.matchMode as ReplyMatchMode) || 'word'
  );
  if (hit == null) return null;
  const opt = options[hit.optionIndex];
  const me = String(opt?.marketingEffect || 'none').toLowerCase();
  if (me === 'opt_in' || me === 'opt_out') return me;
  if (me === 'none') {
    const tokens = (opt?.tokens || []).join(' ').toLowerCase();
    if (/sair|parar|stop|nao|não/.test(tokens)) return 'opt_out';
    if (/quero|sim|confirm/.test(tokens)) return 'opt_in';
  }
  return null;
}

function effectFromClassify(
  tenantId: string,
  campaignId: string,
  gate: ReplyFlowStepDef,
  meta: ReturnType<typeof sanitizeReplyFlowMeta>,
  bodyText: string
): 'opt_in' | 'opt_out' | null {
  const fromOption = marketingEffectFromGateMatch(gate, bodyText);
  if (fromOption) return fromOption;
  const intent = classifyReplyIntent(bodyText, {
    globalOptOutKeywords: meta.globalOptOutKeywords,
    acceptAnyReply: gate.acceptAnyReply,
    validTokens: gate.validTokens,
    matchMode: gate.matchMode,
    options: gate.options,
    invalidReplyBody: gate.invalidReplyBody,
  });
  if (intent.kind === 'opt_out') return 'opt_out';
  if (intent.kind === 'opt_in' || intent.kind === 'flow_match') return 'opt_in';
  void campaignId;
  void tenantId;
  return null;
}

async function mergeLeadTagOnContact(
  tenantId: string,
  phoneDigits: string,
  classification: 'hot' | 'blacklist',
  replySnippet: string
): Promise<void> {
  const contact = (await findContactByPhoneKey(tenantId, normPhoneKey(phoneDigits))) || null;
  if (!contact) return;
  const tags = contact.tags || [];
  const without = tags.filter(
    (t) => t !== LEAD_TAG.hot && t !== LEAD_TAG.blacklist
  );
  const at = new Date().toISOString();
  if (classification === 'blacklist') {
    await updateContact(tenantId, contact.id, {
      marketingOptOut: true,
      marketingOptIn: false,
      marketingConsentAt: at,
      marketingConsentText: replySnippet.slice(0, 200),
      tags: [...without, LEAD_TAG.blacklist],
    });
  } else {
    await updateContact(tenantId, contact.id, {
      marketingOptOut: false,
      marketingOptIn: true,
      marketingConsentAt: at,
      marketingConsentText: replySnippet.slice(0, 200),
      tags: [...without, LEAD_TAG.hot],
    });
  }
}

export type RouteWithoutSessionParams = {
  tenantId: string;
  connectionId: string;
  phoneDigits: string;
  bodyText: string;
  incomingConvId?: string;
  cancelJobs: (tenantId: string, phone: string) => Promise<number>;
  publishConsent?: (payload: {
    campaignId: string;
    effect: 'opt_in' | 'opt_out';
    replyText: string;
  }) => void;
};

/** Só classifica (quente / lista negra) — não envia texto do fluxo. */
export async function routeInboundReplyWithoutSession(
  params: RouteWithoutSessionParams
): Promise<{ handled: boolean; marketingEffect?: 'opt_in' | 'opt_out' }> {
  const bodyText = String(params.bodyText || '').trim();
  if (bodyText.length === 0) return { handled: false };

  const resolved = await resolveCampaignForInboundReply(
    params.tenantId,
    params.connectionId,
    params.phoneDigits
  );
  if (!resolved?.campaignId) return { handled: false };

  const gateCtx = await loadGateStep(params.tenantId, resolved.campaignId);
  if (!gateCtx) return { handled: false };

  const effect = effectFromClassify(
    params.tenantId,
    resolved.campaignId,
    gateCtx.gate,
    gateCtx.meta,
    bodyText
  );
  if (!effect) return { handled: false };

  const replySnippet = bodyText.slice(0, 200);

  if (effect === 'opt_out') {
    await processContactOptOut({
      tenantId: params.tenantId,
      phoneDigits: params.phoneDigits,
      reason: `Roteamento retroativo (sem sessão) — campanha ${resolved.campaignId}`,
      source: 'reply_flow_catchup',
      keyword: replySnippet.slice(0, 60),
      cancelJobs: params.cancelJobs,
    });
    await mergeLeadTagOnContact(params.tenantId, params.phoneDigits, 'blacklist', replySnippet);
    params.publishConsent?.({ campaignId: resolved.campaignId, effect: 'opt_out', replyText: bodyText });
    void import('./contactIdentity/contactIdentityHooks.js').then(({ recordContactOptOutEvent }) =>
      recordContactOptOutEvent({
        tenantId: params.tenantId,
        phone: params.phoneDigits,
        connectionId: params.connectionId,
        source: 'reply_flow_catchup',
      })
    );
    return { handled: true, marketingEffect: 'opt_out' };
  }

  await mergeLeadTagOnContact(params.tenantId, params.phoneDigits, 'hot', replySnippet);
  void tryAutoEnrollOnOptIn({
    tenantId: params.tenantId,
    phoneDigits: params.phoneDigits,
    connectionId: params.connectionId,
    conversationId: params.incomingConvId,
  });
  void tryAutoEnrollHotLead({
    tenantId: params.tenantId,
    phoneDigits: params.phoneDigits,
    connectionId: params.connectionId,
    conversationId: params.incomingConvId,
    treatReplyAsHot: true,
  });
  params.publishConsent?.({ campaignId: resolved.campaignId, effect: 'opt_in', replyText: bodyText });
  void import('./contactIdentity/contactIdentityHooks.js').then(({ recordContactInboundReply }) =>
    recordContactInboundReply({
      tenantId: params.tenantId,
      phone: params.phoneDigits,
      connectionId: params.connectionId,
      campaignId: resolved.campaignId,
      preview: bodyText,
    })
  );
  return { handled: true, marketingEffect: 'opt_in' };
}

/** Reabre sessão quando o contato já recebeu disparo mas a sessão caiu (respostas novas com texto do fluxo). */
export async function bootstrapReplyFlowSessionForInbound(params: {
  tenantId: string;
  connectionId: string;
  phoneDigits: string;
  incomingConvId?: string;
  hasSession: boolean;
  openSession: (p: {
    connectionId: string;
    phoneDigits: string;
    campaignId: string;
    ownerUid?: string;
    vars: Record<string, string>;
    toRaw: string;
    convKey?: string;
    remoteJid?: string;
  }) => void;
}): Promise<boolean> {
  if (params.hasSession) return false;
  const resolved = await resolveCampaignForInboundReply(
    params.tenantId,
    params.connectionId,
    params.phoneDigits
  );
  if (!resolved?.campaignId) return false;

  const doc = await fetchCampaignDoc(params.tenantId, resolved.campaignId);
  const parsed = parseReplyFlowDefFromCampaignDoc(doc);
  if (!parsed?.steps?.length) return false;

  const phone = normalizePhoneDigits(params.phoneDigits);
  const remoteJid =
    params.incomingConvId?.includes(':') && params.incomingConvId.includes('@')
      ? params.incomingConvId.slice(params.incomingConvId.indexOf(':') + 1)
      : phone.length >= 8
        ? `${phone}@s.whatsapp.net`
        : undefined;

  params.openSession({
    connectionId: params.connectionId,
    phoneDigits: phone,
    campaignId: resolved.campaignId,
    ownerUid: resolved.ownerUid || params.tenantId,
    vars: {},
    toRaw: phone,
    convKey: params.incomingConvId || `${params.connectionId}:${phone}`,
    remoteJid,
  });
  return true;
}
