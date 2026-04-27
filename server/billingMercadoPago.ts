import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { mergeUserSubscription } from './subscriptionFirestore.js';
import { channelAddonUnitPriceBrl } from './connectionLimits.js';
import { getMercadoPagoAccessToken, requireMercadoPagoAccessToken } from './mercadoPagoAccess.js';

type Plan = 'monthly' | 'annual';
type Method = 'pix' | 'card' | 'recurring';
type ChannelTier = 1 | 2 | 3 | 4 | 5;

const PIX_DISCOUNT_PCT = 0.05;
const MP_API = 'https://api.mercadopago.com';
const CHANNEL_TIER_PRICES_MONTHLY: Record<ChannelTier, number> = {
  1: 149.9,
  2: 249.9,
  3: 329.9,
  4: 399.9,
  5: 459.9
};
const CHANNEL_TIER_PRICES_ANNUAL: Record<ChannelTier, number> = {
  1: 1529,
  2: 2549,
  3: 3365,
  4: 4079,
  5: 4691
};

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Alinhado ao Vite (Intl pt-BR) — devolve o mesmo texto que a UI com GET /prices. */
function formatPriceLabelBrl(amount: number, kind: 'monthly' | 'annual'): string {
  const s = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
  return kind === 'monthly' ? `${s} / mês` : `${s} / ano`;
}

function getPrices(): { monthly: number; annual: number } {
  const monthly = parseFloat(process.env.MERCADOPAGO_PRICE_MONTHLY || '49.9');
  const annual = parseFloat(process.env.MERCADOPAGO_PRICE_ANNUAL || '479.9');
  if (!Number.isFinite(monthly) || monthly <= 0) throw new Error('MERCADOPAGO_PRICE_MONTHLY invalido.');
  if (!Number.isFinite(annual) || annual <= 0) throw new Error('MERCADOPAGO_PRICE_ANNUAL invalido.');
  return { monthly, annual };
}

function getBackUrl(): string {
  const raw = (process.env.MERCADOPAGO_BACK_URL || '').trim();
  const fallback = 'http://localhost:8000';
  const candidate = raw || fallback;
  try {
    const u = new URL(candidate);
    if (!u.protocol.startsWith('http')) throw new Error('invalid protocol');
    return candidate.replace(/\/+$/, '');
  } catch {
    console.warn(
      `[billing] MERCADOPAGO_BACK_URL inválido (${JSON.stringify(raw)}). Usando fallback ${fallback}.`
    );
    return fallback;
  }
}

function parseChannelTier(v: unknown): ChannelTier | null {
  const n = Math.floor(Number(v) || 0);
  return n >= 1 && n <= 5 ? (n as ChannelTier) : null;
}

function channelTierMonthlyPrice(channels: ChannelTier): number {
  const envKey = `MERCADOPAGO_CHANNEL_TIER_${channels}`;
  const envVal = parseFloat(process.env[envKey] || '');
  if (Number.isFinite(envVal) && envVal > 0) return envVal;
  return CHANNEL_TIER_PRICES_MONTHLY[channels];
}

function channelTierAnnualPrice(channels: ChannelTier): number {
  const envKey = `MERCADOPAGO_CHANNEL_TIER_${channels}_ANNUAL`;
  const envVal = parseFloat(process.env[envKey] || '');
  if (Number.isFinite(envVal) && envVal > 0) return envVal;
  return CHANNEL_TIER_PRICES_ANNUAL[channels];
}

function resolveCurrentChannelsFromSub(sub: Record<string, unknown> | undefined): ChannelTier {
  const included = Math.floor(Number(sub?.includedChannels) || 0);
  if (included >= 1 && included <= 5) return included as ChannelTier;
  const legacy = 2 + Math.max(0, Math.floor(Number(sub?.extraChannelSlots) || 0));
  return Math.max(1, Math.min(5, legacy)) as ChannelTier;
}

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (v as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

interface CreateParams {
  uid: string;
  email: string;
  plan: Plan;
  method: Method;
  /** Quando definido, o valor cobrado segue o plano por canais (tier 1–5). */
  channels?: ChannelTier;
}

/**
 * Cria uma preferencia one-time (Pix ou cartao a vista/parcelado).
 * - Pix: checkout exclusivo, 5% de desconto.
 * - Cartao: checkout com Pix, cartao, debito e carteira MP. Ate 12x no anual.
 */
async function createPreference(params: CreateParams): Promise<{ id: string; init_point: string }> {
  const access = requireMercadoPagoAccessToken();

  if (params.channels != null) {
    if (params.method !== 'pix' && params.method !== 'card') {
      throw new Error('Checkout por canais aceita apenas method pix ou card.');
    }
    return createChannelTierPreference({
      uid: params.uid,
      email: params.email,
      channels: params.channels,
      method: params.method,
      plan: params.plan
    });
  }

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
  const access = requireMercadoPagoAccessToken();

  const basePrice =
    params.channels != null
      ? params.plan === 'monthly'
        ? channelTierMonthlyPrice(params.channels)
        : channelTierAnnualPrice(params.channels)
      : (() => {
          const { monthly, annual } = getPrices();
          return params.plan === 'monthly' ? monthly : annual;
        })();

  const backUrl = getBackUrl();
  const planLabel = params.plan === 'monthly' ? 'Mensal' : 'Anual';
  const channelSuffix = params.channels != null ? ` - ${params.channels} canal(is)` : '';

  const frequency = params.plan === 'monthly' ? 1 : 12;
  const frequency_type: 'months' = 'months';

  const body = {
    reason: `ZapMass Pro - ${planLabel}${channelSuffix} (debito automatico)`,
    external_reference:
      params.channels != null
        ? `${params.uid}:tier:${params.channels}:${params.plan}`
        : `${params.uid}:${params.plan}`,
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
      'X-Idempotency-Key': `${params.uid}-${params.plan}-recurring-${params.channels ?? 'flat'}-${Date.now()}`
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

async function createChannelTierPreference(params: {
  uid: string;
  email: string;
  channels: ChannelTier;
  method: 'pix' | 'card';
  plan: Plan;
  externalReference?: string;
  title?: string;
  description?: string;
  amountOverride?: number;
}): Promise<{ id: string; init_point: string }> {
  const access = requireMercadoPagoAccessToken();
  const backUrl = getBackUrl();
  const notificationUrl = `${backUrl}/api/webhooks/mercadopago`;
  const baseByPlan = params.plan === 'annual' ? channelTierAnnualPrice(params.channels) : channelTierMonthlyPrice(params.channels);
  const basePrice =
    Number.isFinite(params.amountOverride) && (params.amountOverride || 0) > 0 ? Number(params.amountOverride) : baseByPlan;
  const finalPrice =
    params.method === 'pix' ? roundMoney(basePrice * (1 - PIX_DISCOUNT_PCT)) : roundMoney(basePrice);
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
          installments: params.plan === 'annual' ? 12 : 1,
          default_installments: 1
        };

  const body = {
    items: [
      {
        id: `zapmass-tier-${params.channels}-${params.method}`,
        title: params.title || `ZapMass Pro - ${params.channels} canal(is)`,
        description:
          params.description || `Plano ${params.plan === 'annual' ? 'anual' : 'mensal'} com ${params.channels} canal(is).`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: finalPrice
      }
    ],
    payer: { email: params.email },
    external_reference: params.externalReference || `${params.uid}:tier:${params.channels}:${params.plan}`,
    back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
    auto_return: 'approved',
    notification_url: notificationUrl,
    statement_descriptor: 'ZAPMASS TIER',
    payment_methods,
    metadata: {
      uid: params.uid,
      kind: 'tier',
      channels: params.channels,
      plan: params.plan,
      method: params.method,
      final_price: finalPrice
    }
  };

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${params.uid}-tier-${params.channels}-${params.method}-${Date.now()}`
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
  if (!init_point) throw new Error('Resposta do MP sem init_point (plano por canais).');
  return { id, init_point };
}

type ChannelAddonMethod = 'pix' | 'card' | 'recurring';

/**
 * Cada slot extra: MERCADOPAGO_CHANNEL_ADDON_MONTHLY (R$) × quantidade; máx. 3 extras (5 canais no total).
 */
async function createChannelAddonPreference(
  params: { uid: string; email: string; extraSlots: 1 | 2 | 3; method: 'pix' | 'card' }
): Promise<{ id: string; init_point: string }> {
  const access = requireMercadoPagoAccessToken();

  const unit = channelAddonUnitPriceBrl();
  const total = roundMoney(unit * params.extraSlots);
  const finalPrice = params.method === 'pix' ? roundMoney(total * (1 - PIX_DISCOUNT_PCT)) : total;
  const backUrl = getBackUrl();
  const notificationUrl = `${backUrl}/api/webhooks/mercadopago`;
  const maxInstallments = params.method === 'pix' ? 1 : 1;

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
        id: `zapmass-chaddon-${params.extraSlots}`,
        title: `ZapMass — Canais extras (+${params.extraSlots})`,
        description:
          params.method === 'pix'
            ? `Ate ${2 + params.extraSlots} canais (2 do plano + ${params.extraSlots} extras). Pagamento unico.`
            : `Ate ${2 + params.extraSlots} canais (2 do plano + ${params.extraSlots} extras).`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: finalPrice
      }
    ],
    payer: { email: params.email },
    external_reference: `${params.uid}:chaddon_once:${params.extraSlots}`,
    back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
    auto_return: 'approved',
    notification_url: notificationUrl,
    statement_descriptor: 'ZAPMASS CH',
    payment_methods,
    metadata: { uid: params.uid, chaddon: params.extraSlots, method: params.method, kind: 'chaddon_once' }
  };

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${params.uid}-chaddon-once-${params.extraSlots}-${Date.now()}`
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
  if (!init_point) throw new Error('Resposta do MP sem init_point (canais extras).');
  return { id, init_point };
}

async function createChannelAddonPreapproval(params: { uid: string; email: string; extraSlots: 1 | 2 | 3 }): Promise<{
  id: string;
  init_point: string;
}> {
  const access = requireMercadoPagoAccessToken();

  const unit = channelAddonUnitPriceBrl();
  const total = roundMoney(unit * params.extraSlots);
  const backUrl = getBackUrl();

  const body = {
    reason: `ZapMass — Canais extras (mensal) +${params.extraSlots}`,
    external_reference: `${params.uid}:chaddon_recur:${params.extraSlots}`,
    payer_email: params.email,
    back_url: backUrl,
    status: 'pending' as const,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months' as const,
      transaction_amount: total,
      currency_id: 'BRL',
      start_date: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    }
  };

  const res = await fetch(`${MP_API}/preapproval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${params.uid}-chaddon-recur-${params.extraSlots}-${Date.now()}`
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
  if (!init_point) throw new Error('Resposta do MP sem init_point (preapproval canais).');
  return { id, init_point };
}

/**
 * Rotas de cobrança Mercado Pago.
 *
 * POST /api/billing/mercadopago/start
 *   Body: { plan, method, channels?: 1..5 } — se `channels` vier, o valor segue o plano por canais (também no recurring).
 *   Devolve `init_point` para redirecionar o navegador.
 *
 * POST /api/billing/mercadopago/cancel-subscription
 *   Cancela o preapproval ativo do utilizador (so aplica a quem tem debito automatico).
 *
 * GET /api/billing/mercadopago/prices
 *   Matriz `channelTiers` (1–5) + `monthly`/`annual` no tier base (2). Publico; alinha a UI ao cobrado.
 */
export function registerBillingMercadoPagoRoutes(app: Express): void {
  app.get('/api/billing/mercadopago/prices', (_req: Request, res: Response) => {
    try {
      const channelTiers: Record<
        string,
        { monthly: number; annual: number; displayMonthly: string; displayAnnual: string }
      > = {};
      const tiers: ChannelTier[] = [1, 2, 3, 4, 5];
      for (const n of tiers) {
        const m = channelTierMonthlyPrice(n);
        const a = channelTierAnnualPrice(n);
        channelTiers[String(n)] = {
          monthly: m,
          annual: a,
          displayMonthly: formatPriceLabelBrl(m, 'monthly'),
          displayAnnual: formatPriceLabelBrl(a, 'annual')
        };
      }
      const baseTier: ChannelTier = 2;
      const monthly = channelTierMonthlyPrice(baseTier);
      const annual = channelTierAnnualPrice(baseTier);
      return res.json({
        ok: true,
        pricingModel: 'channel_tiers',
        defaultChannelTier: baseTier,
        channelTiers,
        /** Base Pro (2 canais) — compatível com clientes que só leem monthly/annual. */
        monthly,
        annual,
        pixDiscountPct: PIX_DISCOUNT_PCT,
        currency: 'BRL',
        displayMonthly: formatPriceLabelBrl(monthly, 'monthly'),
        displayAnnual: formatPriceLabelBrl(annual, 'annual')
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

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

      const channels = parseChannelTier(req.body?.channels);
      const tierArg = channels != null ? { channels } : {};

      const result =
        method === 'recurring'
          ? await createPreapproval({ uid, email, plan, method, ...tierArg })
          : await createPreference({
              uid,
              email,
              plan,
              method: method as 'pix' | 'card',
              ...tierArg
            });

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
   * Novo modelo comercial: plano por quantidade de canais (1..5), mensal ou anual.
   * Body: { channels: 1|2|3|4|5, plan: 'monthly'|'annual', method: 'pix'|'card' }
   */
  app.post('/api/billing/mercadopago/channel-plan', async (req: Request, res: Response) => {
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
          error: 'Conta sem e-mail. Use login com e-mail ou envie payer_email no JSON do corpo.'
        });
      }
      const channels = parseChannelTier(req.body?.channels);
      if (!channels) {
        return res.status(400).json({ ok: false, error: 'channels deve ser 1, 2, 3, 4 ou 5.' });
      }
      const planRaw = String(req.body?.plan || 'monthly').toLowerCase();
      const plan: Plan = planRaw === 'annual' ? 'annual' : 'monthly';
      const methodRaw = String(req.body?.method || 'card').toLowerCase();
      const method: 'pix' | 'card' = methodRaw === 'pix' ? 'pix' : 'card';
      const db = getFirestore(adminApp);
      const subSnap = await db.collection('userSubscriptions').doc(uid).get();
      const sub = (subSnap.data() || {}) as Record<string, unknown>;
      const currentChannels = resolveCurrentChannelsFromSub(sub);
      const currentPlan: Plan = String(sub.plan || '') === 'annual' ? 'annual' : 'monthly';
      const accessEndMs = toMillis(sub.accessEndsAt);
      const now = Date.now();
      const hasActiveCycle = String(sub.status || '') === 'active' && accessEndMs != null && accessEndMs > now;
      const isUpgrade = hasActiveCycle && channels > currentChannels && currentPlan === plan;

      let billedPrice = plan === 'annual' ? channelTierAnnualPrice(channels) : channelTierMonthlyPrice(channels);
      let prorataRatio = 1;
      let externalReference = `${uid}:tier:${channels}:${plan}`;
      let checkoutTitle = `ZapMass Pro - ${channels} canal(is)`;
      let checkoutDescription = `Plano ${plan === 'annual' ? 'anual' : 'mensal'} com ${channels} canal(is).`;

      if (isUpgrade && accessEndMs != null) {
        const cycleMs = currentPlan === 'annual' ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
        prorataRatio = Math.max(0.05, Math.min(1, (accessEndMs - now) / cycleMs));
        const diff = Math.max(
          0,
          (plan === 'annual' ? channelTierAnnualPrice(channels) : channelTierMonthlyPrice(channels)) -
            (plan === 'annual'
              ? channelTierAnnualPrice(currentChannels as ChannelTier)
              : channelTierMonthlyPrice(currentChannels as ChannelTier))
        );
        billedPrice = roundMoney(Math.max(1, diff * prorataRatio));
        externalReference = `${uid}:tier_upgrade:${currentChannels}:${channels}:${plan}`;
        checkoutTitle = `Upgrade ZapMass: ${currentChannels} → ${channels} canais`;
        checkoutDescription = `Upgrade pró-rata do ciclo atual (${Math.round(prorataRatio * 100)}% do período restante).`;
      }

      const result = await createChannelTierPreference({
        uid,
        email,
        channels,
        method,
        plan,
        externalReference,
        title: checkoutTitle,
        description: checkoutDescription,
        amountOverride: billedPrice
      });
      return res.json({
        ok: true,
        init_point: result.init_point,
        preference_id: result.id,
        channels,
        plan,
        method,
        monthly_price_brl: channelTierMonthlyPrice(channels),
        annual_price_brl: channelTierAnnualPrice(channels),
        charged_brl: billedPrice,
        is_upgrade_prorata: isUpgrade,
        from_channels: currentChannels,
        prorata_ratio: isUpgrade ? roundMoney(prorataRatio) : 1
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[billing/mercadopago/channel-plan]', msg);
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

      const access = getMercadoPagoAccessToken();
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

  app.post('/api/billing/mercadopago/channel-addon', (_req: Request, res: Response) => {
    return res.status(410).json({
      ok: false,
      error: 'Rota legada descontinuada. Use /api/billing/mercadopago/channel-plan com channels=1..5.'
    });
  });

  app.post('/api/billing/mercadopago/cancel-channel-addon', (_req: Request, res: Response) => {
    return res.status(410).json({
      ok: false,
      error: 'Rota legada descontinuada. O modelo atual usa plano por quantidade de canais.'
    });
  });

  try {
    const p = getPrices();
    console.log(
      `[mercadopago] Precos de checkout (MERCADOPAGO_PRICE_*): ${formatPriceLabelBrl(p.monthly, 'monthly')} | ${formatPriceLabelBrl(
        p.annual,
        'annual'
      )}`
    );
  } catch (e) {
    console.error('[mercadopago] MERCADOPAGO_PRICE_* invalido no arranque:', e);
  }
}
