import { getZapmassPool } from './db/postgres.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import * as evolutionService from './evolutionService.js';
import * as waService from './whatsappService.js';

export type AdminPlatformStats = {
  generatedAt: string;
  users: {
    total: number;
    newLast7Days: number;
    newLast30Days: number;
  };
  subscriptions: {
    active: number;
    trialing: number;
    manualGrant: number;
    blocked: number;
    none: number;
  };
  connections: {
    total: number;
    connected: number;
    tenantsWithConnection: number;
  };
  revenue: {
    priceMonthlyBrl: number;
    priceAnnualBrl: number;
    estimatedMrrBrl: number;
    activeMonthlyPlans: number;
    activeAnnualPlans: number;
    channelAddonSlots: number;
  };
  recentSignups: Array<{
    uid: string;
    email: string;
    createdAt: string | null;
    status: string;
    plan: string | null;
    connectionsConnected: number;
  }>;
};

function readPrices(): { monthly: number; annual: number } {
  const monthly = parseFloat(process.env.MERCADOPAGO_PRICE_MONTHLY || '49.9');
  const annual = parseFloat(process.env.MERCADOPAGO_PRICE_ANNUAL || '479.9');
  return {
    monthly: Number.isFinite(monthly) && monthly > 0 ? monthly : 49.9,
    annual: Number.isFinite(annual) && annual > 0 ? annual : 479.9
  };
}

function useEvolutionEngine(): boolean {
  return String(process.env.ZAPMASS_WHATSAPP_ENGINE || 'evolution').toLowerCase() === 'evolution';
}

function listAllConnections() {
  return useEvolutionEngine() ? evolutionService.getConnections() : waService.getConnections();
}

function connectionOwnerUid(id: string): string | null {
  if (useEvolutionEngine()) return evolutionService.resolveConnectionOwnerUid(id) ?? null;
  const idx = id.indexOf('__');
  return idx > 0 ? id.slice(0, idx) : null;
}

export async function buildAdminPlatformStats(): Promise<AdminPlatformStats> {
  const prices = readPrices();
  const conns = listAllConnections();
  const connected = conns.filter((c) => String(c.status || '').toUpperCase() === 'CONNECTED');
  const ownerSet = new Set<string>();
  for (const c of conns) {
    const owner = connectionOwnerUid(String(c.id || ''));
    if (owner) ownerSet.add(owner);
  }

  const byOwnerConnected = new Map<string, number>();
  for (const c of connected) {
    const owner = connectionOwnerUid(String(c.id || ''));
    if (!owner) continue;
    byOwnerConnected.set(owner, (byOwnerConnected.get(owner) || 0) + 1);
  }

  const empty: AdminPlatformStats = {
    generatedAt: new Date().toISOString(),
    users: { total: 0, newLast7Days: 0, newLast30Days: 0 },
    subscriptions: { active: 0, trialing: 0, manualGrant: 0, blocked: 0, none: 0 },
    connections: {
      total: conns.length,
      connected: connected.length,
      tenantsWithConnection: ownerSet.size
    },
    revenue: {
      priceMonthlyBrl: prices.monthly,
      priceAnnualBrl: prices.annual,
      estimatedMrrBrl: 0,
      activeMonthlyPlans: 0,
      activeAnnualPlans: 0,
      channelAddonSlots: 0
    },
    recentSignups: []
  };

  if (!vpsDataEnabled()) return empty;
  const pool = getZapmassPool();
  if (!pool) return empty;

  const usersR = await pool.query<{ total: string; d7: string; d30: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::text AS d7,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::text AS d30
     FROM zapmass.users
     WHERE disabled_at IS NULL`
  );

  const subR = await pool.query<{
    active: string;
    trialing: string;
    manual: string;
    blocked: string;
    none: string;
    monthly: string;
    annual: string;
    channel_slots: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE COALESCE(doc->>'status','') = 'active')::text AS active,
       COUNT(*) FILTER (WHERE COALESCE(doc->>'status','') = 'trialing')::text AS trialing,
       COUNT(*) FILTER (WHERE (doc->>'manualGrant')::boolean IS TRUE)::text AS manual,
       COUNT(*) FILTER (WHERE (doc->>'blocked')::boolean IS TRUE)::text AS blocked,
       COUNT(*) FILTER (WHERE doc IS NULL OR doc = '{}'::jsonb OR COALESCE(doc->>'status','') IN ('','none'))::text AS none,
       COUNT(*) FILTER (WHERE COALESCE(doc->>'status','') = 'active' AND COALESCE(doc->>'plan','monthly') = 'monthly')::text AS monthly,
       COUNT(*) FILTER (WHERE COALESCE(doc->>'status','') = 'active' AND doc->>'plan' = 'annual')::text AS annual,
       COALESCE(SUM(
         CASE WHEN COALESCE((doc->>'manualExtraChannelSlots')::int, 0) > 0
           THEN LEAST(3, GREATEST(0, (doc->>'manualExtraChannelSlots')::int))
           WHEN doc->>'mercadoPagoChannelAddonPreapprovalId' IS NOT NULL AND doc->>'mercadoPagoChannelAddonPreapprovalId' <> ''
           THEN 1
           ELSE 0 END
       ), 0)::text AS channel_slots
     FROM zapmass.user_subscriptions`
  );

  const recentR = await pool.query<{
    uid: string;
    email: string;
    created_at: Date;
    status: string;
    plan: string | null;
  }>(
    `SELECT u.id::text AS uid, u.email, u.created_at,
            COALESCE(s.doc->>'status', 'none') AS status,
            NULLIF(s.doc->>'plan', '') AS plan
     FROM zapmass.users u
     LEFT JOIN zapmass.user_subscriptions s ON s.tenant_id = u.id
     WHERE u.disabled_at IS NULL
     ORDER BY u.created_at DESC
     LIMIT 25`
  );

  const sub = subR.rows[0];
  const activeMonthly = Number(sub?.monthly || 0);
  const activeAnnual = Number(sub?.annual || 0);
  const channelSlots = Number(sub?.channel_slots || 0);
  const channelTierPrice = parseFloat(process.env.MERCADOPAGO_CHANNEL_TIER_1 || '29.9');
  const channelMrr =
    Number.isFinite(channelTierPrice) && channelTierPrice > 0
      ? channelSlots * channelTierPrice
      : 0;
  const estimatedMrr =
    activeMonthly * prices.monthly + activeAnnual * (prices.annual / 12) + channelMrr;

  return {
    generatedAt: new Date().toISOString(),
    users: {
      total: Number(usersR.rows[0]?.total || 0),
      newLast7Days: Number(usersR.rows[0]?.d7 || 0),
      newLast30Days: Number(usersR.rows[0]?.d30 || 0)
    },
    subscriptions: {
      active: Number(sub?.active || 0),
      trialing: Number(sub?.trialing || 0),
      manualGrant: Number(sub?.manual || 0),
      blocked: Number(sub?.blocked || 0),
      none: Number(sub?.none || 0)
    },
    connections: {
      total: conns.length,
      connected: connected.length,
      tenantsWithConnection: ownerSet.size
    },
    revenue: {
      priceMonthlyBrl: prices.monthly,
      priceAnnualBrl: prices.annual,
      estimatedMrrBrl: Math.round(estimatedMrr * 100) / 100,
      activeMonthlyPlans: activeMonthly,
      activeAnnualPlans: activeAnnual,
      channelAddonSlots: channelSlots
    },
    recentSignups: recentR.rows.map((row) => ({
      uid: row.uid,
      email: row.email,
      createdAt: row.created_at ? row.created_at.toISOString() : null,
      status: row.status || 'none',
      plan: row.plan,
      connectionsConnected: byOwnerConnected.get(row.uid) || 0
    }))
  };
}
