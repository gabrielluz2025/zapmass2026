import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';

type Plan = 'monthly' | 'annual';
type Method = 'pix' | 'card';

const PIX_DISCOUNT_PCT = 0.05;

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

interface CreatePreferenceParams {
  uid: string;
  email: string;
  plan: Plan;
  method: Method;
}

/**
 * Cria uma preferencia de pagamento one-time no Mercado Pago.
 *
 * - Mensal: 1x no cartao ou Pix (com desconto de 5%). Libera 30 dias de acesso via webhook.
 * - Anual: ate 12x no cartao (juros do MP quando > 1x) ou Pix (com desconto de 5%). Libera 12 meses.
 *
 * A identificacao do utilizador vai em `external_reference` no formato `uid:plan`, que o webhook
 * em `/api/webhooks/mercadopago` usa para prolongar a assinatura no Firestore.
 */
async function createPreference(params: CreatePreferenceParams): Promise<{ id: string; init_point: string }> {
  const access = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!access) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN nao configurado no servidor.');
  }

  const baseMonthly = parseFloat(process.env.MERCADOPAGO_PRICE_MONTHLY || '49.9');
  const baseAnnual = parseFloat(process.env.MERCADOPAGO_PRICE_ANNUAL || '479.9');
  if (!Number.isFinite(baseMonthly) || baseMonthly <= 0) throw new Error('MERCADOPAGO_PRICE_MONTHLY invalido.');
  if (!Number.isFinite(baseAnnual) || baseAnnual <= 0) throw new Error('MERCADOPAGO_PRICE_ANNUAL invalido.');

  const basePrice = params.plan === 'monthly' ? baseMonthly : baseAnnual;
  const finalPrice = params.method === 'pix' ? roundMoney(basePrice * (1 - PIX_DISCOUNT_PCT)) : roundMoney(basePrice);

  const backUrl = (process.env.MERCADOPAGO_BACK_URL || 'http://localhost:8000').trim();
  const notificationUrl = `${backUrl.replace(/\/+$/, '')}/api/webhooks/mercadopago`;

  const planLabel = params.plan === 'monthly' ? 'Mensal' : 'Anual';
  const title = `ZapMass Pro - ${planLabel}`;

  const maxInstallments = params.method === 'pix' ? 1 : params.plan === 'annual' ? 12 : 1;

  /**
   * Regras:
   * - 'pix': checkout exclusivo do Pix com 5% de desconto (atalho rapido).
   * - 'card': checkout com TODOS os metodos habilitados (cartao, Pix, debito,
   *   carteira MP, etc.) sem desconto. Deixamos boleto/ATM de fora para evitar
   *   fluxos com compensacao lenta ou caros. O MP decide o que mostrar pelo pais/conta.
   */
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
        description: `Assinatura ZapMass Pro (${planLabel}) paga via ${methodLabel}.`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: finalPrice
      }
    ],
    payer: { email: params.email },
    external_reference: `${params.uid}:${params.plan}`,
    back_urls: {
      success: backUrl,
      failure: backUrl,
      pending: backUrl
    },
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

  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
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
  if (!init_point) {
    throw new Error('Resposta do MP sem init_point. Verifique a conta e o modo (sandbox/producao).');
  }
  return { id, init_point };
}

/**
 * POST /api/billing/mercadopago/start
 * Body: { plan: 'monthly'|'annual', method: 'pix'|'card' }
 * Valida o utilizador via Firebase ID token e devolve o `init_point` do checkout do MP.
 *
 * Mantemos o metodo default como 'card' para retrocompatibilidade com clientes antigos.
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
      const method: Method = methodRaw === 'pix' ? 'pix' : 'card';

      const { id, init_point } = await createPreference({ uid, email, plan, method });
      return res.json({ ok: true, init_point, preference_id: id, plan, method });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[billing/mercadopago/start]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
