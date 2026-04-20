import type { Express, Request, Response } from 'express';
import {
  extendPaidSubscription,
  mergeUserSubscription,
  type SubscriptionPlan
} from './subscriptionFirestore.js';

const MP_API = 'https://api.mercadopago.com';

function parseExternalReference(ref: string | undefined | null): { uid: string; plan: SubscriptionPlan } {
  if (!ref || typeof ref !== 'string') return { uid: '', plan: null };
  const parts = ref.split(':').map((s) => s.trim());
  const uid = parts[0] || '';
  const p = (parts[1] || '').toLowerCase();
  const plan: SubscriptionPlan =
    p === 'monthly' || p === 'mensal'
      ? 'monthly'
      : p === 'annual' || p === 'anual'
        ? 'annual'
        : null;
  return { uid, plan };
}

async function mpGetJson(path: string): Promise<Record<string, unknown> | null> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!token) {
    console.warn('[MP Webhook] MERCADOPAGO_ACCESS_TOKEN nao configurado — nao foi possivel consultar o recurso.');
    return null;
  }
  const res = await fetch(`${MP_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    console.error('[MP Webhook] Erro API', path, res.status, await res.text());
    return null;
  }
  return (await res.json()) as Record<string, unknown>;
}

async function handleMercadoPagoPayment(paymentId: string): Promise<void> {
  const data = await mpGetJson(`/v1/payments/${paymentId}`);
  if (!data) return;
  const status = String(data.status || '');
  const ext = data.external_reference as string | undefined;
  const { uid, plan } = parseExternalReference(ext);
  if (!uid) {
    console.warn('[MP Webhook] Pagamento sem external_reference valido (use UID do Firebase ou UID:monthly|annual).', paymentId);
    return;
  }
  if (status === 'approved') {
    const billingPlan: 'monthly' | 'annual' = plan === 'annual' ? 'annual' : 'monthly';
    await extendPaidSubscription(uid, billingPlan, {
      provider: 'mercadopago',
      plan: billingPlan,
      mercadoPagoLastPaymentId: paymentId
    });
    console.log('[MP Webhook] Assinatura ativa para', uid, paymentId);
  } else if (status === 'rejected' || status === 'cancelled') {
    await mergeUserSubscription(uid, {
      status: 'past_due',
      provider: 'mercadopago',
      plan: plan || null,
      mercadoPagoLastPaymentId: paymentId
    });
    console.log('[MP Webhook] Pagamento nao aprovado — marcado past_due', uid, status);
  }
}

async function handleMercadoPagoPreapproval(preapprovalId: string): Promise<void> {
  const data = await mpGetJson(`/preapproval/${preapprovalId}`);
  if (!data) return;
  const status = String(data.status || '');
  const ext = data.external_reference as string | undefined;
  const { uid, plan } = parseExternalReference(ext);
  if (!uid) {
    console.warn('[MP Webhook] Preapproval sem external_reference valido.', preapprovalId);
    return;
  }
  if (status === 'authorized') {
    const billingPlan: 'monthly' | 'annual' = plan === 'annual' ? 'annual' : 'monthly';
    await extendPaidSubscription(uid, billingPlan, {
      provider: 'mercadopago',
      plan: billingPlan,
      mercadoPagoPreapprovalId: preapprovalId
    });
    console.log('[MP Webhook] Preapproval autorizado — ativo', uid);
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
    console.log('[MP Webhook] Sem data.id — ignorado.', JSON.stringify(body).slice(0, 500));
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
  /** Mercado Pago envia POST JSON (notificacoes). Responda 200 rapidamente para evitar reenvios. */
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

  /** Alguns fluxos da MP testam GET na URL — retorne 200. */
  app.get('/api/webhooks/mercadopago', (_req: Request, res: Response) => {
    res.status(200).send('ok');
  });

  /**
   * Infinite Pay — webhook apos pagamento (URL publica; repasse em INFINITEPAY_WEBHOOK_URL ao criar o link).
   * Opcional: INFINITEPAY_WEBHOOK_SECRET — se definido, exige header x-infinitepay-secret igual.
   * Identificacao do usuario: external_reference ou order_nsu no formato "firebaseUid:monthly|annual".
   * Pagamento aprovado: status paid/approved/completed, paid true, ou paid_amount >= amount (ver codigo).
   */
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
      '[Assinaturas] Firebase Admin nao configurado — webhooks nao persistem no Firestore. Defina FIREBASE_SERVICE_ACCOUNT_PATH ou FIREBASE_SERVICE_ACCOUNT_JSON.'
    );
  }
}
