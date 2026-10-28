import {
  CHANNEL_TIER_PRICES_ANNUAL,
  CHANNEL_TIER_PRICES_MONTHLY,
  type ChannelTier
} from '../shared/channelTierPricing.js';
import {
  defaultResolvedBillingPricing,
  mergeBillingPricingFromDoc,
  type BillingPricingConfig,
  type ResolvedBillingPricing
} from '../shared/billingPricingConfig.js';
import { loadAppConfigGlobal } from './appConfigStore.js';

let snapshot: ResolvedBillingPricing = defaultResolvedBillingPricing();
let dbOverrides: BillingPricingConfig | null = null;

function envTierMonthly(tier: ChannelTier): number | null {
  const envVal = parseFloat(process.env[`MERCADOPAGO_CHANNEL_TIER_${tier}`] || '');
  return Number.isFinite(envVal) && envVal > 0 ? envVal : null;
}

function envTierAnnual(tier: ChannelTier): number | null {
  const envVal = parseFloat(process.env[`MERCADOPAGO_CHANNEL_TIER_${tier}_ANNUAL`] || '');
  return Number.isFinite(envVal) && envVal > 0 ? envVal : null;
}

function envLegacyMonthly(): number | null {
  const n = parseFloat(process.env.MERCADOPAGO_PRICE_MONTHLY || '');
  return Number.isFinite(n) && n > 0 ? n : null;
}

function envLegacyAnnual(): number | null {
  const n = parseFloat(process.env.MERCADOPAGO_PRICE_ANNUAL || '');
  return Number.isFinite(n) && n > 0 ? n : null;
}

function envChannelAddon(): number | null {
  const n = parseFloat(process.env.MERCADOPAGO_CHANNEL_ADDON_MONTHLY || '');
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveTierMonthly(tier: ChannelTier, overrides: BillingPricingConfig | null): number {
  const fromDb = overrides?.channelTiersMonthly?.[tier];
  if (typeof fromDb === 'number' && fromDb > 0) return fromDb;
  return envTierMonthly(tier) ?? CHANNEL_TIER_PRICES_MONTHLY[tier];
}

function resolveTierAnnual(tier: ChannelTier, overrides: BillingPricingConfig | null): number {
  const fromDb = overrides?.channelTiersAnnual?.[tier];
  if (typeof fromDb === 'number' && fromDb > 0) return fromDb;
  return envTierAnnual(tier) ?? CHANNEL_TIER_PRICES_ANNUAL[tier];
}

function buildSnapshot(overrides: BillingPricingConfig | null): ResolvedBillingPricing {
  const channelTiersMonthly = {} as Record<ChannelTier, number>;
  const channelTiersAnnual = {} as Record<ChannelTier, number>;
  const tiers: ChannelTier[] = [1, 2, 3, 4, 5];
  for (const t of tiers) {
    channelTiersMonthly[t] = resolveTierMonthly(t, overrides);
    channelTiersAnnual[t] = resolveTierAnnual(t, overrides);
  }
  const base: ChannelTier = 2;
  let monthly = channelTiersMonthly[base];
  let annual = channelTiersAnnual[base];
  const legacyM = envLegacyMonthly();
  const legacyA = envLegacyAnnual();
  if (!overrides?.channelTiersMonthly?.[base] && legacyM != null) monthly = legacyM;
  if (!overrides?.channelTiersAnnual?.[base] && legacyA != null) annual = legacyA;

  const addonFromDb = overrides?.channelAddonMonthly;
  const channelAddonMonthly =
    typeof addonFromDb === 'number' && addonFromDb > 0
      ? addonFromDb
      : envChannelAddon() ?? defaultResolvedBillingPricing().channelAddonMonthly;

  return { channelTiersMonthly, channelTiersAnnual, channelAddonMonthly, monthly, annual };
}

export function getBillingPricingSnapshot(): ResolvedBillingPricing {
  return snapshot;
}

export function getDbBillingOverrides(): BillingPricingConfig | null {
  return dbOverrides;
}

export async function refreshBillingPricingSnapshot(): Promise<ResolvedBillingPricing> {
  try {
    const cfg = await loadAppConfigGlobal();
    dbOverrides = cfg.billing ? mergeBillingPricingFromDoc(cfg.billing) : null;
  } catch {
    dbOverrides = null;
  }
  snapshot = buildSnapshot(dbOverrides);
  return snapshot;
}

export function channelTierMonthlyPriceSync(channels: ChannelTier): number {
  return snapshot.channelTiersMonthly[channels];
}

export function channelTierAnnualPriceSync(channels: ChannelTier): number {
  return snapshot.channelTiersAnnual[channels];
}

export function getLegacyFlatPricesSync(): { monthly: number; annual: number } {
  return { monthly: snapshot.monthly, annual: snapshot.annual };
}

export function channelAddonUnitPriceBrlSync(): number {
  return snapshot.channelAddonMonthly;
}
