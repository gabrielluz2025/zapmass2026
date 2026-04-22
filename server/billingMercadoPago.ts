import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { mergeUserSubscription } from './subscriptionFirestore.js';

type Plan = 'monthly' | 'annual';
type Method = 'pix' | 'card' | 'recurring';

const PIX_DISCOUNT_PCT = 0.05;
const MP_API = 'https://api.mercadopago.com';

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

function getPrices(): { monthly: number; annual: number } {
  const monthly = parseFloat(process.env.MERCADOPAGO_PRICE_MONTHLY || '49.9');
  const annual = parseFloat(process.env.MERCADOPAGO_PRICE_ANNUAL || '479.9');
  if (!Number.isFinite(monthly) || monthly <= 0) throw new Error('MERCADOPAGO_PRICE_MONTHLY invalido.');
  if (!Number.isFinite(annual) || annual <= 0) throw new Error('MERCADOPAGO_PRICE_ANNUAL invalido.');
  return { monthly, annual };
}

function getBackUrl(): string {
  return (process.env.MERCADOPAGO_BACK_URL || 'http://localhost:8000').trim().replace(/\/+$/, '');
}

interface CreateParams {
  uid: string;
  email: string;
  plan: Plan;
  method: Method;
}

/**
 * Cria uma preferencia one-time (Pix ou cartao a vista/parcelado).
 * - Pix: checkout exclusivo, 5% de desconto.
 * - Cartao: checkout com Pix, cartao, debito e carteira MP. Ate 12x no anual.
 */
async function createPreference(params: CreateParams): Promise<{ id: string; init_point: string }> {
  const access = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!access) throw new Error('MERCADOPAGO_ACCESS_TOKEN nao configurado no servidor.');

  const { monthly, annual } = getPrices();
  const basePrice = params.plan === 'monthly' ? monthly : annual;
  const finalPrice = params.method === 'pix' ? roundMoney(basePrice * (1 - PIX_DISCOUNT_PCT)) : roundMoney(basePrice);

  const backUrl = getBackUrl();
  const notificationUrl = `${backUrl}/api/webhooks/mercadopago`;

  const planLabel = params.plan === 'monthly' ? 'Mensal' : 'Anual';
  const title = `ZapMass Pro - ${planLabel}`;
  const maxInstallments = params.method === 'pix' ? 1 : params.plan === 'annual' ? 12 : 1;

  const payment_methods =
    params.method === 'pix'
      ? {
          excluded_payment_types: [
            { id: 'credit_card' },
            { id: 'debit_card' },
            { id: 'prepaid_card' },
            { id: 'ticket' },
            { id: 'atm' },
            { id: 'digital_wallet' }
          ],
          installments: 1,
          default_installments: 1
        }
      : {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }],
          installments: maxInstallments,
          default_installments: 1
        };

  const body = {
    items: [
      {
        id: `zapmass-${params.plan}-${params.method}`,
        title,
        description:
          params.method === 'pix'
            ? `Assinatura ZapMass Pro (${planLabel}) via Pix com 5% de desconto.`
            : `Assinatura ZapMass Pro (${planLabel}).`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: finalPrice
      }
    ],
    payer: { email: params.email },
    external_reference: `${params.uid}:${params.plan}`,
    back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
    auto_return: 'approved',
    notification_url: notificationUrl,
    statement_descriptor: 'ZAPMASS',
    payment_methods,
    metadata: {
      uid: params.uid,
      plan: params.plan,
      method: params.method,
      base_price: roundMoney(basePrice),
      final_price: finalPrice
    }
  };

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${params.uid}-${params.plan}-${params.method}-${Date.now()}`
    },
    body: JSON.stringify(body)
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.message === 'string' ? data.message : JSON.stringify(data).slice(0, 400);
    throw new Error(`Mercado Pago: ${res.status} - ${msg}`);
  }
  const id = String(data.id || '');
  const init_point = String(data.init_point || '');
  if (!init_point) throw new Error('Resposta do MP sem init_point. Verifique a conta e o modo (sandbox/producao).');
  return { id, init_point };
}

/**
 * Cria uma assinatura recorrente (preapproval) no MP. O cartao do cliente e autorizado
 * e cobrado automaticamente a cada ciclo (mensal ou anual) ate o utilizador cancelar.
 *
 * Apos o cliente confirmar, o webhook `preapproval` autoriza e marca status=active.
 * Os webhooks `authorized_payment` (um por ciclo) mantem accessEndsAt a ser estendido
 * automaticamente em cada renovacao.
 */
async function createPreapproval(params: CreateParams): Promise<{ id: string; init_point: string }> {
  const access = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!access) throw new Error('MERCADOPAGO_ACCESS_TOKEN nao configurado no servidor.');

  const { monthly, annual } = getPrices();
  const basePrice = params.plan === 'monthly' ? monthly : annual;

  const backUrl = getBackUrl();
  const planLabel = params.plan === 'monthly' ? 'Mensal' : 'Anual';

  const frequency = params.plan === 'monthly' ? 1 : 12;
  const frequency_type: 'months' = 'months';

  const body = {
    reason: `ZapMass Pro - ${planLabel} (debito automatico)`,
    external_reference: `${params.uid}:${params.plan}`,
    payer_email: params.email,
    back_url: backUrl,
    status: 'pending',
    auto_recurring: {
      frequency,
      frequency_type,
      transaction_amount: roundMoney(basePrice),
      currency_id: 'BRL',
      /** Buffer de 5 min para evitar "start_date no passado" por latencia/clock skew. */
      start_date: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    }
  };

  const res = await fetch(`${MP_API}/preapproval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${params.uid}-${params.plan}-recurring-${Date.now()}`
    },
    body: JSON.stringify(body)
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.message === 'string' ? data.message : JSON.stringify(data).slice(0, 400);
    throw new Error(`Mercado Pago: ${res.status} - ${msg}`);
  }

  const id = String(data.id || '');
  const init_point = String(data.init_point || '');
  if (!init_point) throw new Error('Resposta do MP sem init_point para preapproval.');
  return { id, init_point };
}

/**
 * Rotas de cobrança Mercado Pago.
 *
 * POST /api/billing/mercadopago/start
 *   Body: { plan: 'monthly'|'annual', method: 'pix'|'card'|'recurring' }
 *   Devolve `init_point` para redirecionar o navegador.
 *
 * POST /api/billing/mercadopago/cancel-subscription
 *   Cancela o preapproval ativo do utilizador (so aplica a quem tem debito automatico).
 */
export function registerBillingMercadoPagoRoutes(app: Express): void {
  app.post('/api/billing/mercadopago/start', async (req: Request, res: Response) => {
    try {
      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }

      const idToken = parseBearer(req);
      if (!idToken) {
        return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <Firebase ID token>.' });
      }

      let uid: string;
      let email: string;
      try {
        const decoded = await getAuth(adminApp).verifyIdToken(idToken);
        uid = decoded.uid;
        const bodyEmail = typeof req.body?.payer_email === 'string' ? req.body.payer_email.trim() : '';
        email = (decoded.email || bodyEmail || '').trim();
      } catch {
        return res.status(401).json({ ok: false, error: 'Token Firebase invalido ou expirado.' });
      }

      if (!email || !email.includes('@')) {
        return res.status(400).json({
          ok: false,
          error: 'Conta sem e-mail. Use login Google com e-mail ou envie payer_email no JSON do corpo.'
        });
      }

      const plan = (req.body?.plan as Plan) || 'monthly';
      if (plan !== 'monthly' && plan !== 'annual') {
        return res.status(400).json({ ok: false, error: 'plan deve ser monthly ou annual.' });
      }

      const methodRaw = (req.body?.method as string | undefined)?.toLowerCase() || 'card';
      const method: Method =
        methodRaw === 'pix' ? 'pix' : methodRaw === 'recurring' ? 'recurring' : 'card';

      const result =
        method === 'recurring'
          ? await createPreapproval({ uid, email, plan, method })
          : await createPreference({ uid, email, plan, method });

      return res.json({
        ok: true,
        init_point: result.init_point,
        preference_id: result.id,
        plan,
        method
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[billing/mercadopago/start]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  /**
   * Cancela a assinatura recorrente (preapproval) do utilizador no MP.
   * O acesso pago continua ate o fim do ciclo atual (accessEndsAt nao e alterado aqui).
   */
  app.post('/api/billing/mercadopago/cancel-subscription', async (req: Request, res: Response) => {
    try {
      const adminApp = getFirebaseAdmin();
      if (!adminApp) return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado.' });

      const idToken = parseBearer(req);
      if (!idToken) return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <token>.' });

      let uid: string;
      try {
        const decoded = await getAuth(adminApp).verifyIdToken(idToken);
        uid = decoded.uid;
      } catch {
        return res.status(401).json({ ok: false, error: 'Token invalido.' });
      }

      const access = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
      if (!access) return res.status(503).json({ ok: false, error: 'MERCADOPAGO_ACCESS_TOKEN ausente.' });

      const db = getFirestore(adminApp);
      const snap = await db.collection('userSubscriptions').doc(uid).get();
      const data = snap.data() as { mercadoPagoPreapprovalId?: string } | undefined;
      const preapprovalId = data?.mercadoPagoPreapprovalId;
      if (!preapprovalId) {
        return res.status(404).json({ ok: false, error: 'Nenhuma assinatura recorrente ativa.' });
      }

      const mpRes = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' })
      });
      if (!mpRes.ok) {
        const text = await mpRes.text();
        console.error('[billing/mercadopago/cancel] MP retornou', mpRes.status, text);
        return res.status(502).json({ ok: false, error: 'MP recusou o cancelamento.' });
      }

      await mergeUserSubscription(uid, { status: 'canceled' });
      return res.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[billing/mercadopago/cancel]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
