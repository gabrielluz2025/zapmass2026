import { getZapmassPool } from './db/postgres.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import * as evolutionService from './evolutionService.js';
import * as waService from './whatsappService.js';
import {
  classifySubscriptionBilling,
  courtesyChannelAddonSlots,
  paidChannelAddonSlots,
  planForMrrEstimate,
  type SubscriptionBillingKind,
  type SubscriptionDocLike
} from '../shared/subscriptionBillingKind.js';
import { getLegacyFlatPricesSync, channelAddonUnitPriceBrlSync } from './billingPricingSnapshot.js';
import { usesEvolutionMotor } from './evolutionConfig.js';

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
    mercadopagoActive: number;
    manualBonus: number;
    manualPaidExternal: number;
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
    /** Receita recorrente estimada só Mercado Pago (+ add-ons MP). */
    estimatedMrrPaidBrl: number;
    /** Valor de referência (não faturado pelo MP) — liberações cortesia. */
    estimatedMrrCourtesyBrl: number;
    /** Estimativa de planos liberados manualmente mas cobrados fora do MP. */
    estimatedMrrManualPaidBrl: number;
    /** @deprecated Use estimatedMrrPaidBrl — mantido = MRR pago MP. */
    estimatedMrrBrl: number;
    activeMonthlyPlansPaid: number;
    activeAnnualPlansPaid: number;
    activeMonthlyPlansCourtesy: number;
    activeAnnualPlansCourtesy: number;
    activeMonthlyPlansManualPaid: number;
    activeAnnualPlansManualPaid: number;
    channelAddonSlotsPaid: number;
    channelAddonSlotsCourtesy: number;
    /** @deprecated */
    activeMonthlyPlans: number;
    /** @deprecated */
    activeAnnualPlans: number;
    /** @deprecated */
    channelAddonSlots: number;
  };
  recentSignups: Array<{
    uid: string;
    email: string;
    createdAt: string | null;
    status: string;
    plan: string | null;
    billingKind: SubscriptionBillingKind;
    connectionsConnected: number;
  }>;
};

function readPrices(): { monthly: number; annual: number } {
  return getLegacyFlatPricesSync();
}

function useEvolutionEngine(): boolean {
  return usesEvolutionMotor();
}

function listAllConnections() {
  return useEvolutionEngine() ? evolutionService.getConnections() : waService.getConnections();
}

function connectionOwnerUid(id: string): string | null {
  if (useEvolutionEngine()) return evolutionService.resolveConnectionOwnerUid(id) ?? null;
  const idx = id.indexOf('__');
  return idx > 0 ? id.slice(0, idx) : null;
}

function docFromRow(raw: unknown): SubscriptionDocLike {
  if (!raw || typeof raw !== 'object') return {};
  return raw as SubscriptionDocLike;
}

function addPlanMrr(
  plan: 'monthly' | 'annual' | null,
  prices: { monthly: number; annual: number }
): number {
  if (plan === 'monthly') return prices.monthly;
  if (plan === 'annual') return prices.annual / 12;
  return 0;
}

function aggregateSubscriptionDocs(
  docs: SubscriptionDocLike[],
  prices: { monthly: number; annual: number },
  channelTierPrice: number
) {
  const counts = {
    active: 0,
    trialing: 0,
    manualGrant: 0,
    mercadopagoActive: 0,
    manualBonus: 0,
    manualPaidExternal: 0,
    blocked: 0,
    none: 0
  };

  let mrrPaid = 0;
  let mrrCourtesy = 0;
  let mrrManualPaid = 0;
  let activeMonthlyPaid = 0;
  let activeAnnualPaid = 0;
  let activeMonthlyCourtesy = 0;
  let activeAnnualCourtesy = 0;
  let activeMonthlyManualPaid = 0;
  let activeAnnualManualPaid = 0;
  let channelPaid = 0;
  let channelCourtesy = 0;

  for (const doc of docs) {
    const status = String(doc.status || 'none').toLowerCase();
    if (doc.blocked === true) counts.blocked += 1;
    if (status === 'active') counts.active += 1;
    if (status === 'trialing') counts.trialing += 1;
    if (doc.manualGrant === true) counts.manualGrant += 1;
    const kind = classifySubscriptionBilling(doc);
    if (kind === 'none') counts.none += 1;
    if (kind === 'mercadopago') counts.mercadopagoActive += 1;
    if (kind === 'manual_bonus') counts.manualBonus += 1;
    if (kind === 'manual_paid') counts.manualPaidExternal += 1;

    const plan = planForMrrEstimate(doc);
    const paidSlots = paidChannelAddonSlots(doc);
    const courtesySlots = courtesyChannelAddonSlots(doc);

    if (kind === 'mercadopago') {
      if (plan === 'monthly') activeMonthlyPaid += 1;
      if (plan === 'annual') activeAnnualPaid += 1;
      mrrPaid += addPlanMrr(plan, prices);
      channelPaid += paidSlots;
      mrrPaid += paidSlots * channelTierPrice;
    } else if (kind === 'manual_paid') {
      if (plan === 'monthly') activeMonthlyManualPaid += 1;
      if (plan === 'annual') activeAnnualManualPaid += 1;
      mrrManualPaid += addPlanMrr(plan, prices);
      channelPaid += courtesySlots;
      mrrManualPaid += courtesySlots * channelTierPrice;
    } else if (kind === 'manual_bonus') {
      if (plan === 'monthly') activeMonthlyCourtesy += 1;
      if (plan === 'annual') activeAnnualCourtesy += 1;
      mrrCourtesy += addPlanMrr(plan, prices);
      channelCourtesy += courtesySlots;
      mrrCourtesy += courtesySlots * channelTierPrice;
    }
  }

  return {
    counts,
    revenue: {
      estimatedMrrPaidBrl: Math.round(mrrPaid * 100) / 100,
      estimatedMrrCourtesyBrl: Math.round(mrrCourtesy * 100) / 100,
      estimatedMrrManualPaidBrl: Math.round(mrrManualPaid * 100) / 100,
      activeMonthlyPlansPaid: activeMonthlyPaid,
      activeAnnualPlansPaid: activeAnnualPaid,
      activeMonthlyPlansCourtesy: activeMonthlyCourtesy,
      activeAnnualPlansCourtesy: activeAnnualCourtesy,
      activeMonthlyPlansManualPaid: activeMonthlyManualPaid,
      activeAnnualPlansManualPaid: activeAnnualManualPaid,
      channelAddonSlotsPaid: channelPaid,
      channelAddonSlotsCourtesy: channelCourtesy
    }
  };
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

  const channelPrice = channelAddonUnitPriceBrlSync();

  const emptyRevenue = {
    priceMonthlyBrl: prices.monthly,
    priceAnnualBrl: prices.annual,
    estimatedMrrPaidBrl: 0,
    estimatedMrrCourtesyBrl: 0,
    estimatedMrrManualPaidBrl: 0,
    estimatedMrrBrl: 0,
    activeMonthlyPlansPaid: 0,
    activeAnnualPlansPaid: 0,
    activeMonthlyPlansCourtesy: 0,
    activeAnnualPlansCourtesy: 0,
    activeMonthlyPlansManualPaid: 0,
    activeAnnualPlansManualPaid: 0,
    channelAddonSlotsPaid: 0,
    channelAddonSlotsCourtesy: 0,
    activeMonthlyPlans: 0,
    activeAnnualPlans: 0,
    channelAddonSlots: 0
  };

  const empty: AdminPlatformStats = {
    generatedAt: new Date().toISOString(),
    users: { total: 0, newLast7Days: 0, newLast30Days: 0 },
    subscriptions: {
      active: 0,
      trialing: 0,
      manualGrant: 0,
      mercadopagoActive: 0,
      manualBonus: 0,
      manualPaidExternal: 0,
      blocked: 0,
      none: 0
    },
    connections: {
      total: conns.length,
      connected: connected.length,
      tenantsWithConnection: ownerSet.size
    },
    revenue: emptyRevenue,
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

  const subsR = await pool.query<{ doc: Record<string, unknown> }>(
    `SELECT doc FROM zapmass.user_subscriptions`
  );
  const subDocs = subsR.rows.map((r) => docFromRow(r.doc));
  const agg = aggregateSubscriptionDocs(subDocs, prices, channelPrice);

  const recentR = await pool.query<{
    uid: string;
    email: string;
    created_at: Date;
    status: string;
    plan: string | null;
    doc: Record<string, unknown> | null;
  }>(
    `SELECT u.id::text AS uid, u.email, u.created_at,
            COALESCE(s.doc->>'status', 'none') AS status,
            NULLIF(s.doc->>'plan', '') AS plan,
            s.doc
     FROM zapmass.users u
     LEFT JOIN zapmass.user_subscriptions s ON s.tenant_id = u.id
     WHERE u.disabled_at IS NULL
     ORDER BY u.created_at DESC
     LIMIT 25`
  );

  const rev = agg.revenue;

  return {
    generatedAt: new Date().toISOString(),
    users: {
      total: Number(usersR.rows[0]?.total || 0),
      newLast7Days: Number(usersR.rows[0]?.d7 || 0),
      newLast30Days: Number(usersR.rows[0]?.d30 || 0)
    },
    subscriptions: agg.counts,
    connections: {
      total: conns.length,
      connected: connected.length,
      tenantsWithConnection: ownerSet.size
    },
    revenue: {
      priceMonthlyBrl: prices.monthly,
      priceAnnualBrl: prices.annual,
      estimatedMrrPaidBrl: rev.estimatedMrrPaidBrl,
      estimatedMrrCourtesyBrl: rev.estimatedMrrCourtesyBrl,
      estimatedMrrManualPaidBrl: rev.estimatedMrrManualPaidBrl,
      estimatedMrrBrl: rev.estimatedMrrPaidBrl,
      activeMonthlyPlansPaid: rev.activeMonthlyPlansPaid,
      activeAnnualPlansPaid: rev.activeAnnualPlansPaid,
      activeMonthlyPlansCourtesy: rev.activeMonthlyPlansCourtesy,
      activeAnnualPlansCourtesy: rev.activeAnnualPlansCourtesy,
      activeMonthlyPlansManualPaid: rev.activeMonthlyPlansManualPaid,
      activeAnnualPlansManualPaid: rev.activeAnnualPlansManualPaid,
      channelAddonSlotsPaid: rev.channelAddonSlotsPaid,
      channelAddonSlotsCourtesy: rev.channelAddonSlotsCourtesy,
      activeMonthlyPlans: rev.activeMonthlyPlansPaid,
      activeAnnualPlans: rev.activeAnnualPlansPaid,
      channelAddonSlots: rev.channelAddonSlotsPaid
    },
    recentSignups: recentR.rows.map((row) => {
      const doc = docFromRow(row.doc || undefined);
      return {
        uid: row.uid,
        email: row.email,
        createdAt: row.created_at ? row.created_at.toISOString() : null,
        status: row.status || 'none',
        plan: row.plan,
        billingKind: classifySubscriptionBilling(doc),
        connectionsConnected: byOwnerConnected.get(row.uid) || 0
      };
    })
  };
}
