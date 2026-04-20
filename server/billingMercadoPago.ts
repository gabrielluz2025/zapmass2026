import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';

type Plan = 'monthly' | 'annual';

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

async function createPreapproval(params: {
  uid: string;
  email: string;
  plan: Plan;
}): Promise<{ id: string; init_point: string }> {
  const access = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!access) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN nao configurado no servidor.');
  }

  const monthly = parseFloat(process.env.MERCADOPAGO_PRICE_MONTHLY || '49.9');
  const annual = parseFloat(process.env.MERCADOPAGO_PRICE_ANNUAL || '479.9');
  if (!Number.isFinite(monthly) || monthly <= 0) throw new Error('MERCADOPAGO_PRICE_MONTHLY invalido.');
  if (!Number.isFinite(annual) || annual <= 0) throw new Error('MERCADOPAGO_PRICE_ANNUAL invalido.');

  const backUrl = (process.env.MERCADOPAGO_BACK_URL || 'http://localhost:8000').trim();

  const startDate = new Date().toISOString();

  const auto_recurring =
    params.plan === 'monthly'
      ? {
          frequency: 1,
          frequency_type: 'months' as const,
          start_date: startDate,
          transaction_amount: Math.round(monthly * 100) / 100,
          currency_id: 'BRL'
        }
      : {
          frequency: 12,
          frequency_type: 'months' as const,
          start_date: startDate,
          transaction_amount: Math.round(annual * 100) / 100,
          currency_id: 'BRL'
        };

  const body = {
    reason: params.plan === 'monthly' ? 'ZapMass — Plano mensal' : 'ZapMass — Plano anual',
    external_reference: `${params.uid}:${params.plan}`,
    payer_email: params.email,
    back_url: backUrl,
    auto_recurring,
    status: 'pending'
  };

  const res = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${params.uid}-${params.plan}-${Date.now()}`
    },
    body: JSON.stringify(body)
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.message === 'string' ? data.message : JSON.stringify(data).slice(0, 400);
    throw new Error(`Mercado Pago: ${res.status} — ${msg}`);
  }

  const id = String(data.id || '');
  const init_point = String(data.init_point || '');
  if (!init_point) {
    throw new Error('Resposta do MP sem init_point. Verifique a conta e o modo (sandbox/producao).');
  }
  return { id, init_point };
}

/**
 * Inicia assinatura Mercado Pago: valida o usuario via Firebase ID token e devolve URL (init_point) para o checkout MP.
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

      const { id, init_point } = await createPreapproval({ uid, email, plan });
      return res.json({ ok: true, init_point, preapproval_id: id, plan });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[billing/mercadopago/start]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
