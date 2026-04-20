import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';

type Plan = 'monthly' | 'annual';

const CHECKOUT_LINKS_URL = 'https://api.infinitepay.io/invoices/public/checkout/links';

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/^\$/, '');
}

function brlToCents(brl: number): number {
  if (!Number.isFinite(brl) || brl <= 0) return 0;
  return Math.round(brl * 100);
}

function planPriceCents(plan: Plan): number {
  const monthlyBrl = parseFloat(process.env.MERCADOPAGO_PRICE_MONTHLY || '49.9');
  const annualBrl = parseFloat(process.env.MERCADOPAGO_PRICE_ANNUAL || '479.9');

  const monthlyCents = parseInt(process.env.INFINITEPAY_PRICE_MONTHLY_CENTS || '', 10);
  const annualCents = parseInt(process.env.INFINITEPAY_PRICE_ANNUAL_CENTS || '', 10);

  if (plan === 'monthly') {
    if (Number.isFinite(monthlyCents) && monthlyCents > 0) return monthlyCents;
    const c = brlToCents(monthlyBrl);
    if (c <= 0) throw new Error('Preco mensal invalido (INFINITEPAY_PRICE_MONTHLY_CENTS ou MERCADOPAGO_PRICE_MONTHLY).');
    return c;
  }
  if (Number.isFinite(annualCents) && annualCents > 0) return annualCents;
  const c = brlToCents(annualBrl);
  if (c <= 0) throw new Error('Preco anual invalido (INFINITEPAY_PRICE_ANNUAL_CENTS ou MERCADOPAGO_PRICE_ANNUAL).');
  return c;
}

async function createInfinitePayCheckoutLink(params: {
  uid: string;
  email: string;
  name?: string;
  plan: Plan;
}): Promise<{ checkout_url: string; order_nsu: string }> {
  const handleRaw = process.env.INFINITEPAY_HANDLE?.trim();
  if (!handleRaw) {
    throw new Error('INFINITEPAY_HANDLE nao configurado (InfiniteTag no app, sem @).');
  }
  const handle = normalizeHandle(handleRaw);
  if (!handle) throw new Error('INFINITEPAY_HANDLE vazio apos normalizar.');

  const priceCents = planPriceCents(params.plan);
  const description =
    params.plan === 'monthly' ? 'ZapMass — Plano mensal' : 'ZapMass — Plano anual';

  const order_nsu = `${params.uid}:${params.plan}`;
  const redirect_url = (process.env.INFINITEPAY_REDIRECT_URL || process.env.MERCADOPAGO_BACK_URL || 'http://localhost:8000').trim();
  const webhook_url = process.env.INFINITEPAY_WEBHOOK_URL?.trim();

  const body: Record<string, unknown> = {
    handle,
    itens: [{ quantity: 1, price: priceCents, description }],
    order_nsu,
    redirect_url
  };

  if (webhook_url) {
    body.webhook_url = webhook_url;
  }

  if (params.email) {
    body.customer = {
      email: params.email,
      ...(params.name ? { name: params.name } : {})
    };
  }

  const res = await fetch(CHECKOUT_LINKS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.message === 'string' ? data.message : JSON.stringify(data).slice(0, 400);
    throw new Error(`Infinite Pay: ${res.status} — ${msg}`);
  }

  const checkout_url = String(data.link || data.checkout_url || data.url || '').trim();
  if (!checkout_url) {
    throw new Error('Resposta da Infinite Pay sem link de checkout (link/checkout_url).');
  }

  return { checkout_url, order_nsu };
}

/**
 * Checkout Infinite Pay: valida Firebase ID token e retorna URL publica de pagamento (cobranca avulsa por plano).
 * O webhook em /api/webhooks/infinitepay usa o mesmo formato order_nsu uid:plan para ativar o Firestore.
 */
export function registerBillingInfinitePayRoutes(app: Express): void {
  app.post('/api/billing/infinitepay/start', async (req: Request, res: Response) => {
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
      let name: string | undefined;
      try {
        const decoded = await getAuth(adminApp).verifyIdToken(idToken);
        uid = decoded.uid;
        const bodyEmail = typeof req.body?.payer_email === 'string' ? req.body.payer_email.trim() : '';
        email = (decoded.email || bodyEmail || '').trim();
        const dn = typeof decoded.name === 'string' ? decoded.name.trim() : '';
        name = dn || undefined;
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

      const { checkout_url, order_nsu } = await createInfinitePayCheckoutLink({ uid, email, name, plan });
      return res.json({ ok: true, checkout_url, order_nsu, plan });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[billing/infinitepay/start]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
