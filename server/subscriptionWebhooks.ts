import type { Express, Request, Response } from 'express';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import {
  extendPaidSubscription,
  mergeUserSubscription,
  type SubscriptionPlan
} from './subscriptionFirestore.js';
import { sendPaymentConfirmationEmail } from './emailService.js';
import { issueInvoice, isNfeEnabled } from './nfeService.js';

const MP_API = 'https://api.mercadopago.com';

type ParsedMpRef =
  | { kind: 'plan'; uid: string; plan: SubscriptionPlan }
  | { kind: 'chaddon_once'; uid: string; extraSlots: number }
  | { kind: 'chaddon_recur'; uid: string; extraSlots: number }
  | { kind: 'none' };

/**
 * `uid:monthly|annual` (plano) ou `uid:chaddon_once:1` / `uid:chaddon_recur:2` (canais extras).
 */
function parseExternalReference(ref: string | undefined | null): ParsedMpRef {
  if (!ref || typeof ref !== 'string') return { kind: 'none' };
  const parts = ref.split(':').map((s) => s.trim());
  const uid = parts[0] || '';
  if (!uid) return { kind: 'none' };
  const mid = (parts[1] || '').toLowerCase();
  if (mid === 'chaddon_once' || mid === 'chaddon-once') {
    const n = Math.min(3, Math.max(1, parseInt(parts[2] || '0', 10) || 0));
    if (n >= 1 && n <= 3) return { kind: 'chaddon_once', uid, extraSlots: n };
  }
  if (mid === 'chaddon_recur' || mid === 'chaddon-recur') {
    const n = Math.min(3, Math.max(1, parseInt(parts[2] || '0', 10) || 0));
    if (n >= 1 && n <= 3) return { kind: 'chaddon_recur', uid, extraSlots: n };
  }
  const p = mid;
  const plan: SubscriptionPlan =
    p === 'monthly' || p === 'mensal' ? 'monthly' : p === 'annual' || p === 'anual' ? 'annual' : null;
  return { kind: 'plan', uid, plan };
}

async function mpGetJson(path: string): Promise<Record<string, unknown> | null> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!token) {
    console.warn('[MP Webhook] MERCADOPAGO_ACCESS_TOKEN nao configurado.');
    return null;
  }
  const res = await fetch(`${MP_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error('[MP Webhook] Erro API', path, res.status, await res.text());
    return null;
  }
  return (await res.json()) as Record<string, unknown>;
}

function getBackUrl(): string {
  return (process.env.MERCADOPAGO_BACK_URL || 'http://localhost:8000').trim().replace(/\/+$/, '');
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
  const app = getFirebaseAdmin();
  if (!app) return null;
  const db = getFirestore(app);
  const snap = await db.collection('userSubscriptions').doc(uid).get();
  const data = snap.data() as { accessEndsAt?: Timestamp | null } | undefined;
  const ts = data?.accessEndsAt;
  if (!ts) return null;
  return ts.toDate();
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

async function handleMercadoPagoPayment(paymentId: string): Promise<void> {
  const data = await mpGetJson(`/v1/payments/${paymentId}`);
  if (!data) return;
  const status = String(data.status || '');
  const ext = data.external_reference as string | undefined;
  const parsed = parseExternalReference(ext);
  if (parsed.kind === 'none' || !parsed.uid) {
    console.warn('[MP Webhook] Pagamento sem external_reference valido.', paymentId);
    return;
  }
  const { uid } = parsed;

  if (parsed.kind === 'chaddon_once' && status === 'approved') {
    await mergeUserSubscription(uid, {
      provider: 'mercadopago',
      extraChannelSlots: parsed.extraSlots,
      mercadoPagoLastPaymentId: paymentId
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

  const plan = parsed.kind === 'plan' ? parsed.plan : null;
  if (status === 'approved') {
    const billingPlan: 'monthly' | 'annual' = plan === 'annual' ? 'annual' : 'monthly';
    await extendPaidSubscription(uid, billingPlan, {
      provider: 'mercadopago',
      plan: billingPlan,
      mercadoPagoLastPaymentId: paymentId
    });
    console.log('[MP Webhook] Assinatura ativa para', uid, paymentId);
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
    await mergeUserSubscription(uid, {
      status: 'past_due',
      provider: 'mercadopago',
      plan: plan || null,
      mercadoPagoLastPaymentId: paymentId
    });
    console.log('[MP Webhook] Pagamento nao aprovado - marcado past_due', uid, status);
  }
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
  const { uid } = parsed;

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
        mercadoPagoChannelAddonPreapprovalId: FieldValue.delete()
      } as any);
      console.log('[MP Webhook] Preapproval canais extras cancelado', uid, status);
    }
    return;
  }

  if (parsed.kind !== 'plan') {
    return;
  }

  const { plan } = parsed;
  if (status === 'authorized') {
    const billingPlan: 'monthly' | 'annual' = plan === 'annual' ? 'annual' : 'monthly';
    await extendPaidSubscription(uid, billingPlan, {
      provider: 'mercadopago',
      plan: billingPlan,
      mercadoPagoPreapprovalId: preapprovalId
    });
    console.log('[MP Webhook] Preapproval autorizado - ativo', uid);
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
    await mergeUserSubscription(uid, {
      status: 'canceled',
      provider: 'mercadopago',
      plan: plan || null,
      mercadoPagoPreapprovalId: preapprovalId
    });
    console.log('[MP Webhook] Preapproval cancelado/pausado', uid, status);
  }
}

async function processMercadoPagoBody(body: Record<string, unknown>): Promise<void> {
  const type = String(body.type || body.topic || '');
  const data = body.data as { id?: string } | undefined;
  const id = data?.id != null ? String(data.id) : '';
  if (!id) {
    console.log('[MP Webhook] Sem data.id - ignorado.', JSON.stringify(body).slice(0, 500));
    return;
  }
  const t = type.toLowerCase();
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
  app.post('/api/webhooks/mercadopago', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      console.log('[MP Webhook] Recebido:', body.type || body.topic || body.action, body.data || '');
      await processMercadoPagoBody(body);
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[MP Webhook] Erro:', e);
      res.status(500).json({ ok: false });
    }
  });

  app.get('/api/webhooks/mercadopago', (_req: Request, res: Response) => {
    res.status(200).send('ok');
  });

  app.post('/api/webhooks/infinitepay', async (req: Request, res: Response) => {
    try {
      const secret = process.env.INFINITEPAY_WEBHOOK_SECRET?.trim();
      if (secret) {
        const got = String(req.headers['x-infinitepay-secret'] || req.headers['x-webhook-secret'] || '');
        if (got !== secret) {
          return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
        }
      }

      const body = (req.body || {}) as Record<string, unknown>;
      console.log('[InfinitePay Webhook]', JSON.stringify(body).slice(0, 800));

      const ext = (body.external_reference ||
        body.externalReference ||
        body.order_nsu ||
        body.orderNsu) as string | undefined;
      const status = String(body.status || body.payment_status || '').toLowerCase();
      const { uid, plan } = parseExternalReference(ext);

      const paidAmount = typeof body.paid_amount === 'number' ? body.paid_amount : Number(body.paid_amount);
      const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
      const looksPaid =
        status === 'paid' ||
        status === 'approved' ||
        status === 'completed' ||
        body.paid === true ||
        (Number.isFinite(paidAmount) && Number.isFinite(amount) && amount > 0 && paidAmount >= amount) ||
        (Number.isFinite(paidAmount) && paidAmount > 0 && (body.transaction_nsu != null || body.invoice_slug != null));

      if (uid && looksPaid) {
        const billingPlan: 'monthly' | 'annual' = plan === 'annual' ? 'annual' : 'monthly';
        await extendPaidSubscription(uid, billingPlan, {
          provider: 'infinitepay',
          plan: billingPlan,
          infinitePayReference: String(body.order_nsu || body.orderNsu || body.transaction_nsu || body.id || '')
        });
      } else if (uid && (status === 'canceled' || status === 'cancelled' || status === 'failed')) {
        await mergeUserSubscription(uid, {
          status: 'canceled',
          provider: 'infinitepay',
          plan: plan || null
        });
      }

      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[InfinitePay Webhook] Erro:', e);
      res.status(500).json({ ok: false });
    }
  });

  app.get('/api/webhooks/infinitepay', (_req: Request, res: Response) => {
    res.status(200).send('ok');
  });

  const hasAdmin = !!(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()
  );
  if (!hasAdmin) {
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
