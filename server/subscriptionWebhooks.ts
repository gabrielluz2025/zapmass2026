import type { Express, Request, Response } from 'express';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import {
  extendPaidSubscription,
  getUserSubscription,
  mergeUserSubscription,
  readAccessEndsAtDate,
  usePostgresSubscriptions,
  type SubscriptionPlan
} from './subscriptionStore.js';
import { userHasFullAppAccess } from './subscriptionAccess.js';
import {
  isPaymentAlreadyProcessed,
  isPreapprovalAlreadyActivated,
  shouldConsumePreapprovalBridge,
  withProcessedPaymentId,
  withTenantLock
} from './subscriptionIdempotency.js';
import { resolveMercadoPagoBackUrl } from './mercadoPagoBackUrl.js';
import { sendPaymentConfirmationEmail } from './emailService.js';
import { issueInvoice, isNfeEnabled } from './nfeService.js';
import { getMercadoPagoAccessToken } from './mercadoPagoAccess.js';
import { parseExternalReference, type ParsedMpExternalReference } from './mpExternalReference.js';
import { mercadoWebhookLimiter } from './httpRateLimit.js';
import { verifyMercadoPagoWebhookSignature } from './mercadoPagoWebhookSignature.js';
import { structuredLog } from './structuredLog.js';
import { enqueueProvisionAfterPaidIfNeeded } from './provisionQueue.js';

const MP_API = 'https://api.mercadopago.com';

let warnedMercadoPagoUnsignedProduction = false;

function allowMercadoPagoUnsignedInProduction(): boolean {
  const raw = (process.env.MERCADOPAGO_WEBHOOK_ALLOW_UNSIGNED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Pré-voo: produção exige segredo MP ou excepção explícita; com segredo valida HMAC oficial. */
function assertMercadoPagoWebhookAllowed(
  req: Request,
  body: Record<string, unknown>,
  res: Response
): boolean {
  const prod = process.env.NODE_ENV === 'production';
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() || '';
  if (prod && !secret && !allowMercadoPagoUnsignedInProduction()) {
    res.status(503).json({
      ok: false,
      error:
        'Webhook MP: defina MERCADOPAGO_WEBHOOK_SECRET (Painel Mercado Pago → Suas integrações → Webhooks → assinatura secreta) ou transitório MERCADOPAGO_WEBHOOK_ALLOW_UNSIGNED=1'
    });
    return false;
  }
  if (secret) {
    const v = verifyMercadoPagoWebhookSignature(req, body, secret);
    if (v.ok === false) {
      structuredLog('warn', 'webhook.mercadopago.signature_rejected', { reason: v.reason });
      res
        .status(401)
        .json({ ok: false, error: 'Assinatura do webhook Mercado Pago inválida ou cabeçalhos em falta.' });
      return false;
    }
    return true;
  }
  if (prod && !secret && allowMercadoPagoUnsignedInProduction()) {
    if (!warnedMercadoPagoUnsignedProduction) {
      warnedMercadoPagoUnsignedProduction = true;
      structuredLog('warn', 'webhook.mercadopago.unsigned_allowed_production', {});
    }
  }
  return true;
}

/**
 * Consulta a API do MP. 404/4xx "de negócio" → null (nada a fazer). Falhas transitórias (rede, 5xx, 429) e token
 * ausente LANÇAM erro: o webhook responde 500 e o Mercado Pago reenvia — antes devolvia 200 e o pagamento se perdia.
 */
async function mpGetJson(path: string): Promise<Record<string, unknown> | null> {
  const token = getMercadoPagoAccessToken();
  if (!token) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN nao configurado — webhook nao pode confirmar o pagamento.');
  }
  const res = await fetch(`${MP_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[MP Webhook] Erro API', path, res.status, text.slice(0, 300));
    if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 403) {
      throw new Error(`Mercado Pago API ${res.status} em ${path}`);
    }
    return null;
  }
  return (await res.json()) as Record<string, unknown>;
}

function getBackUrl(): string {
  return resolveMercadoPagoBackUrl();
}

/** Extrai o email do payer ou do tomador em payloads do MP (variados). */
function extractPayerEmail(data: Record<string, unknown>): string | null {
  const p = data.payer as Record<string, unknown> | undefined;
  if (!p) return null;
  const email = typeof p.email === 'string' ? p.email : null;
  return email && email.includes('@') ? email : null;
}

function extractPayerName(data: Record<string, unknown>): string {
  const p = data.payer as Record<string, unknown> | undefined;
  if (!p) return '';
  const first = typeof p.first_name === 'string' ? p.first_name : '';
  const last = typeof p.last_name === 'string' ? p.last_name : '';
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return typeof p.email === 'string' ? p.email.split('@')[0] : '';
}

function extractPayerTaxId(data: Record<string, unknown>): string | null {
  const p = data.payer as Record<string, unknown> | undefined;
  const ident = p?.identification as Record<string, unknown> | undefined;
  if (!ident) return null;
  const num = typeof ident.number === 'string' ? ident.number : null;
  return num ? num.replace(/\D/g, '') : null;
}

function mpPaymentMethodToOurMethod(paymentMethodId: string | undefined): 'pix' | 'card' | 'recurring' {
  if (!paymentMethodId) return 'card';
  if (paymentMethodId === 'pix') return 'pix';
  return 'card';
}

/**
 * Busca a data de expiracao atualizada do Firestore (apos extendPaidSubscription).
 * Usamos esse valor no email para nao calcular errado.
 */
async function readAccessEndsAt(uid: string): Promise<Date | null> {
  return readAccessEndsAtDate(uid);
}

/**
 * Notificacoes pos-pagamento (email + NFS-e). Nao quebra o webhook em caso de falha.
 */
async function notifyAfterPayment(params: {
  uid: string;
  paymentData: Record<string, unknown>;
  plan: 'monthly' | 'annual';
  method: 'pix' | 'card' | 'recurring';
  externalId: string;
}) {
  const { uid, paymentData, plan, method, externalId } = params;
  const email = extractPayerEmail(paymentData);
  const name = extractPayerName(paymentData);
  const taxId = extractPayerTaxId(paymentData);
  const amount =
    typeof paymentData.transaction_amount === 'number'
      ? (paymentData.transaction_amount as number)
      : Number(paymentData.transaction_amount || 0);

  const accessEndsAt = await readAccessEndsAt(uid);

  if (email) {
    await sendPaymentConfirmationEmail({
      to: email,
      name,
      plan,
      method,
      amount,
      accessEndsAt,
      subscriptionUrl: `${getBackUrl()}/?view=subscription`,
      nfeEnabled: isNfeEnabled()
    });
  } else {
    console.warn('[MP Webhook] Pagamento sem email do payer - email nao enviado', externalId);
  }

  if (isNfeEnabled() && email && name && taxId) {
    const description =
      plan === 'annual'
        ? 'Assinatura ZapMass Pro - Plano Anual (acesso por 12 meses).'
        : 'Assinatura ZapMass Pro - Plano Mensal (acesso por 30 dias).';
    const result = await issueInvoice({
      uid,
      description,
      amount,
      externalId,
      borrower: { email, name, federalTaxNumber: taxId }
    });
    if (result) {
      await mergeUserSubscription(uid, {
        nfeLastInvoiceId: result.id,
        nfeLastInvoiceStatus: result.status,
        nfeLastInvoicePdfUrl: result.pdfUrl
      });
    }
  } else if (isNfeEnabled()) {
    console.warn(
      '[MP Webhook] NFE.io ativo mas dados do payer incompletos (email/name/taxId). Nao emitido.',
      externalId
    );
  }
}

/** Pagamentos que não pertencem a um débito automático de cartão (não consomem o "bridge" do preapproval). */
const NON_PREAPPROVAL_PAYMENT_TYPES = new Set(['bank_transfer', 'account_money', 'ticket', 'atm']);

async function handleMercadoPagoPayment(
  paymentId: string,
  opts: { fallbackExternalReference?: string } = {}
): Promise<void> {
  const data = await mpGetJson(`/v1/payments/${paymentId}`);
  if (!data) return;
  const status = String(data.status || '');
  const ext = (data.external_reference as string | undefined) || opts.fallbackExternalReference;
  const parsed = parseExternalReference(ext);
  if (parsed.kind === 'none' || !parsed.uid) {
    console.warn('[MP Webhook] Pagamento sem external_reference valido.', paymentId);
    return;
  }
  // Serializa por tenant: created/updated chegam quase juntos e antes liam o mesmo accessEndsAt.
  await withTenantLock(parsed.uid, () => applyMercadoPagoPayment(parsed.uid, paymentId, status, parsed, data));
}

async function applyMercadoPagoPayment(
  uid: string,
  paymentId: string,
  status: string,
  parsed: ParsedMpExternalReference,
  data: Record<string, unknown>
): Promise<void> {
  const sub = await getUserSubscription(uid);

  // Estorno / chargeback do último pagamento: encerra o acesso pago (antes ficava ativo até o fim do ciclo).
  if (status === 'refunded' || status === 'charged_back') {
    if (String(sub?.mercadoPagoLastPaymentId || '') === paymentId && sub?.status !== 'canceled') {
      await mergeUserSubscription(uid, {
        status: 'canceled',
        accessEndsAt: new Date().toISOString()
      });
      structuredLog('warn', 'webhook.mercadopago.payment_reversed', { uid, paymentId, status });
    }
    return;
  }

  if (status === 'approved' && isPaymentAlreadyProcessed(sub, paymentId)) {
    console.log('[MP Webhook] Pagamento ja processado (idempotente) — ignorado', uid, paymentId);
    return;
  }
  const processedIds = withProcessedPaymentId(sub, paymentId);

  if (parsed.kind === 'chaddon_once' && status === 'approved') {
    await mergeUserSubscription(uid, {
      provider: 'mercadopago',
      extraChannelSlots: parsed.extraSlots,
      mercadoPagoLastPaymentId: paymentId,
      mercadoPagoProcessedPaymentIds: processedIds,
      mercadoPagoChannelAddonOneTimePaymentId: paymentId
    });
    console.log('[MP Webhook] Canais extras (avulso) ativados', uid, parsed.extraSlots, paymentId);
    return;
  }
  if (parsed.kind === 'chaddon_once' && (status === 'rejected' || status === 'cancelled')) {
    console.log('[MP Webhook] chaddon avulso nao aprovado', uid, status);
    return;
  }
  if (parsed.kind === 'chaddon_recur' || parsed.kind === 'chaddon_once') {
    return;
  }
  if (parsed.kind === 'tier_upgrade') {
    if (status === 'approved') {
      const toChannels = Math.max(1, Math.min(5, parsed.toChannels));
      await mergeUserSubscription(uid, {
        status: 'active',
        provider: 'mercadopago',
        plan: parsed.plan || 'monthly',
        includedChannels: toChannels,
        extraChannelSlots: Math.max(0, toChannels - 1),
        mercadoPagoLastPaymentId: paymentId,
        mercadoPagoProcessedPaymentIds: processedIds
      });
      console.log('[MP Webhook] Upgrade pro-rata de canais aplicado', uid, parsed.fromChannels, '->', toChannels);
    } else if (status === 'rejected' || status === 'cancelled') {
      console.log('[MP Webhook] Upgrade pro-rata nao aprovado', uid, status);
    }
    return;
  }

  const plan = parsed.kind === 'plan' || parsed.kind === 'tier_plan' ? parsed.plan : null;
  const includedChannels = parsed.kind === 'tier_plan' ? Math.max(1, Math.min(5, parsed.channels)) : null;
  if (status === 'approved') {
    const billingPlan: 'monthly' | 'annual' = plan === 'annual' ? 'annual' : 'monthly';
    const channels = includedChannels ?? 1;
    const tierFields =
      includedChannels != null
        ? {
            includedChannels,
            extraChannelSlots: Math.max(0, includedChannels - 1)
          }
        : {};
    const consumeBridge =
      shouldConsumePreapprovalBridge(sub) &&
      !NON_PREAPPROVAL_PAYMENT_TYPES.has(String(data.payment_type_id || ''));

    let extended: { ok: boolean; wasRenewal: boolean };
    if (consumeBridge) {
      // A autorização do débito já concedeu o 1º ciclo: este pagamento só é registado.
      const ok = await mergeUserSubscription(uid, {
        provider: 'mercadopago',
        plan: billingPlan,
        mercadoPagoLastPaymentId: paymentId,
        mercadoPagoProcessedPaymentIds: processedIds,
        mercadoPagoPreapprovalBridgePending: false,
        ...tierFields
      });
      extended = { ok, wasRenewal: true };
    } else {
      extended = await extendPaidSubscription(uid, billingPlan, {
        provider: 'mercadopago',
        plan: billingPlan,
        mercadoPagoLastPaymentId: paymentId,
        mercadoPagoProcessedPaymentIds: processedIds,
        ...tierFields
      });
    }
    console.log('[MP Webhook] Assinatura ativa para', uid, paymentId, consumeBridge ? '(1o pagamento do debito)' : '');
    if (extended.ok && !extended.wasRenewal) {
      const enqueued = enqueueProvisionAfterPaidIfNeeded({
        uid,
        email: extractPayerEmail(data) || '',
        displayName: extractPayerName(data),
        plan: billingPlan,
        channels,
        wasRenewal: extended.wasRenewal
      });
      if (enqueued) {
        structuredLog('info', 'provision.queue.mp_payment_enqueued', { uid, channels });
      }
    }
    const method = mpPaymentMethodToOurMethod(
      typeof data.payment_method_id === 'string' ? data.payment_method_id : undefined
    );
    try {
      await notifyAfterPayment({
        uid,
        paymentData: data,
        plan: billingPlan,
        method,
        externalId: paymentId
      });
    } catch (e) {
      console.error('[MP Webhook] notifyAfterPayment falhou (nao critico):', e);
    }
  } else if (status === 'rejected' || status === 'cancelled') {
    // Uma tentativa recusada (outro cartão, Pix expirado, upgrade) NÃO pode tirar o acesso de quem já tem
    // período pago/teste válido — só marca past_due quando não há acesso vigente.
    if (userHasFullAppAccess(sub, Date.now())) {
      console.log('[MP Webhook] Pagamento nao aprovado, mas acesso vigente — status mantido', uid, status);
      return;
    }
    await mergeUserSubscription(uid, {
      status: 'past_due',
      provider: 'mercadopago',
      plan: plan || null,
      mercadoPagoLastPaymentId: paymentId
    });
    console.log('[MP Webhook] Pagamento nao aprovado - marcado past_due', uid, status);
  }
}

/**
 * Cobrança recorrente (topic `subscription_authorized_payment`): resolve o pagamento real e a referência
 * da assinatura. A idempotência por payment id evita dupla contagem com a notificação `payment` do mesmo débito.
 */
async function handleMercadoPagoAuthorizedPayment(authorizedPaymentId: string): Promise<void> {
  const ap = await mpGetJson(`/authorized_payments/${authorizedPaymentId}`);
  if (!ap) return;
  const payment = ap.payment as Record<string, unknown> | undefined;
  const paymentId = payment?.id != null ? String(payment.id) : '';
  if (!paymentId) {
    console.log('[MP Webhook] authorized_payment sem pagamento ainda', authorizedPaymentId);
    return;
  }
  const preapprovalId = ap.preapproval_id != null ? String(ap.preapproval_id) : '';
  let fallbackExternalReference: string | undefined;
  if (preapprovalId) {
    const pre = await mpGetJson(`/preapproval/${preapprovalId}`);
    fallbackExternalReference =
      typeof pre?.external_reference === 'string' ? (pre.external_reference as string) : undefined;
  }
  await handleMercadoPagoPayment(paymentId, { fallbackExternalReference });
}

async function handleMercadoPagoPreapproval(preapprovalId: string): Promise<void> {
  const data = await mpGetJson(`/preapproval/${preapprovalId}`);
  if (!data) return;
  const status = String(data.status || '');
  const ext = data.external_reference as string | undefined;
  const parsed = parseExternalReference(ext);
  if (parsed.kind === 'none' || !parsed.uid) {
    console.warn('[MP Webhook] Preapproval sem external_reference valido.', preapprovalId);
    return;
  }
  await withTenantLock(parsed.uid, () => applyMercadoPagoPreapproval(parsed.uid, preapprovalId, status, parsed, data));
}

async function applyMercadoPagoPreapproval(
  uid: string,
  preapprovalId: string,
  status: string,
  parsed: ParsedMpExternalReference,
  data: Record<string, unknown>
): Promise<void> {
  if (parsed.kind === 'chaddon_recur') {
    if (status === 'authorized') {
      await mergeUserSubscription(uid, {
        provider: 'mercadopago',
        extraChannelSlots: parsed.extraSlots,
        mercadoPagoChannelAddonPreapprovalId: preapprovalId
      });
      console.log('[MP Webhook] Preapproval canais extras ativo', uid, parsed.extraSlots);
    } else if (status === 'cancelled' || status === 'paused') {
      await mergeUserSubscription(uid, {
        extraChannelSlots: 0,
        mercadoPagoChannelAddonPreapprovalId: FieldValue.delete(),
        mercadoPagoChannelAddonOneTimePaymentId: FieldValue.delete()
      } as any);
      console.log('[MP Webhook] Preapproval canais extras cancelado', uid, status);
    }
    return;
  }

  if (parsed.kind !== 'plan' && parsed.kind !== 'tier_plan') {
    return;
  }

  const sub = await getUserSubscription(uid);
  const plan = parsed.plan;
  const includedChannels =
    parsed.kind === 'tier_plan' ? Math.max(1, Math.min(5, parsed.channels)) : null;
  if (status === 'authorized') {
    // O MP reenvia "authorized" a cada atualização da assinatura: só a primeira concede o ciclo inicial.
    if (isPreapprovalAlreadyActivated(sub, preapprovalId)) {
      console.log('[MP Webhook] Preapproval ja ativado (idempotente) — ignorado', uid, preapprovalId);
      return;
    }
    const billingPlan: 'monthly' | 'annual' = plan === 'annual' ? 'annual' : 'monthly';
    const channels = includedChannels ?? 1;
    const extended = await extendPaidSubscription(uid, billingPlan, {
      provider: 'mercadopago',
      plan: billingPlan,
      mercadoPagoPreapprovalId: preapprovalId,
      mercadoPagoPreapprovalActivatedId: preapprovalId,
      // O 1º pagamento aprovado depois da autorização só é registado (evita 2 períodos por 1 cobrança).
      mercadoPagoPreapprovalBridgePending: true,
      ...(includedChannels != null
        ? {
            includedChannels,
            extraChannelSlots: Math.max(0, includedChannels - 1)
          }
        : {})
    });
    console.log('[MP Webhook] Preapproval autorizado - ativo', uid);
    if (extended.ok && !extended.wasRenewal) {
      const payerEmail = typeof data.payer_email === 'string' ? data.payer_email : '';
      const enqueued = enqueueProvisionAfterPaidIfNeeded({
        uid,
        email: payerEmail,
        displayName: payerEmail ? payerEmail.split('@')[0] : '',
        plan: billingPlan,
        channels,
        wasRenewal: extended.wasRenewal
      });
      if (enqueued) {
        structuredLog('info', 'provision.queue.mp_preapproval_enqueued', { uid, channels });
      }
    }
    // Email avulso "debito auto ativado". NFS-e nao e emitida aqui - espera o payment event.
    const email = typeof data.payer_email === 'string' ? data.payer_email : null;
    const amount =
      (data.auto_recurring as Record<string, unknown> | undefined)?.transaction_amount as number | undefined;
    if (email && typeof amount === 'number') {
      try {
        const accessEndsAt = await readAccessEndsAt(uid);
        await sendPaymentConfirmationEmail({
          to: email,
          plan: billingPlan,
          method: 'recurring',
          amount,
          accessEndsAt,
          subscriptionUrl: `${getBackUrl()}/?view=subscription`,
          nfeEnabled: isNfeEnabled()
        });
      } catch (e) {
        console.error('[MP Webhook] Email de preapproval falhou:', e);
      }
    }
  } else if (status === 'cancelled' || status === 'paused') {
    // Ignora preapprovals antigos/abandonados: só o débito atual do cliente pode cancelar a assinatura.
    const currentId = String(sub?.mercadoPagoPreapprovalId || '');
    if (currentId && currentId !== preapprovalId) {
      console.log('[MP Webhook] Preapproval antigo cancelado — assinatura atual preservada', uid, preapprovalId);
      return;
    }
    await mergeUserSubscription(uid, {
      status: 'canceled',
      provider: 'mercadopago',
      plan: plan || null,
      mercadoPagoPreapprovalId: preapprovalId
    });
    console.log('[MP Webhook] Preapproval cancelado/pausado', uid, status);
  }
}

function firstQueryValue(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
  return '';
}

/**
 * Aceita o formato Webhooks (`{ type, data: { id } }`) e o legado IPN (`?topic=payment&id=123`
 * ou `?type=payment&data.id=123`) — a assinatura já tolerava query, o processamento não.
 */
export async function processMercadoPagoBody(
  body: Record<string, unknown>,
  query: Record<string, unknown> = {}
): Promise<void> {
  const type =
    String(body.type || body.topic || '').trim() || firstQueryValue(query.type) || firstQueryValue(query.topic);
  const data = body.data as { id?: string | number } | undefined;
  const id =
    data?.id != null
      ? String(data.id)
      : firstQueryValue(query['data.id']) || firstQueryValue(query.id);
  if (!id) {
    console.log('[MP Webhook] Sem data.id - ignorado.', JSON.stringify(body).slice(0, 500));
    return;
  }
  const t = type.toLowerCase();
  if (t.includes('authorized_payment')) {
    await handleMercadoPagoAuthorizedPayment(id);
    return;
  }
  if (t.includes('payment')) {
    await handleMercadoPagoPayment(id);
    return;
  }
  if (t.includes('preapproval') || t.includes('subscription')) {
    await handleMercadoPagoPreapproval(id);
    return;
  }
  console.log('[MP Webhook] Tipo nao tratado:', type, 'id=', id);
}

export function registerSubscriptionWebhooks(app: Express): void {
  app.post('/api/webhooks/mercadopago', mercadoWebhookLimiter, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      if (!assertMercadoPagoWebhookAllowed(req, body, res)) return;
      console.log('[MP Webhook] Recebido:', body.type || body.topic || body.action, body.data || '');
      await processMercadoPagoBody(body, req.query as Record<string, unknown>);
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[MP Webhook] Erro:', e);
      res.status(500).json({ ok: false });
    }
  });

  app.get('/api/webhooks/mercadopago', (_req: Request, res: Response) => {
    res.status(200).send('ok');
  });

  const hasAdmin = !!(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()
  );
  if (!hasAdmin && !usePostgresSubscriptions()) {
    console.warn(
      '[Assinaturas] Firebase Admin nao configurado - webhooks nao persistem no Firestore. Defina FIREBASE_SERVICE_ACCOUNT_PATH ou FIREBASE_SERVICE_ACCOUNT_JSON.'
    );
  }
  if (!process.env.RESEND_API_KEY?.trim()) {
    console.warn('[Assinaturas] RESEND_API_KEY ausente - emails de confirmacao nao serao enviados.');
  }
  if (!isNfeEnabled()) {
    console.log('[Assinaturas] NFE.io desativado - NFS-e nao sera emitida. Configure NFE_IO_* quando tiveres CNPJ.');
  }
}
