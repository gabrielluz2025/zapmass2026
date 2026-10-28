import {
  CHANNEL_TIER_PRICES_ANNUAL,
  CHANNEL_TIER_PRICES_MONTHLY,
  type ChannelTier
} from './channelTierPricing.js';

export const BILLING_PRICE_MIN_BRL = 0.01;
export const BILLING_PRICE_MAX_BRL = 99_999.99;

export const CHANNEL_TIERS: ChannelTier[] = [1, 2, 3, 4, 5];

/** Overrides persistidos em `app_config_global` (Postgres) — editáveis no Painel do criador. */
export type BillingPricingConfig = {
  channelTiersMonthly: Partial<Record<ChannelTier, number>>;
  channelTiersAnnual: Partial<Record<ChannelTier, number>>;
  /** Slot extra além do plano por canais (legado add-on). */
  channelAddonMonthly: number | null;
};

export type BillingPricingPutInput = {
  channelTiersMonthly?: Partial<Record<ChannelTier, number>>;
  channelTiersAnnual?: Partial<Record<ChannelTier, number>>;
  channelAddonMonthly?: number | null;
};

export type BillingPricingValidationResult =
  | { ok: true; data: BillingPricingPutInput }
  | { ok: false; errors: Partial<Record<string, string>> & { form?: string } };

function parsePriceField(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return 'invalid';
  if (n < BILLING_PRICE_MIN_BRL || n > BILLING_PRICE_MAX_BRL) return 'invalid';
  return Math.round(n * 100) / 100;
}

function parseTierMap(
  raw: unknown,
  prefix: string,
  errors: Record<string, string>,
  out: Partial<Record<ChannelTier, number>>
): void {
  if (raw === undefined) return;
  if (!raw || typeof raw !== 'object') {
    errors.form = 'Formato de preços por canal inválido.';
    return;
  }
  const o = raw as Record<string, unknown>;
  for (const tier of CHANNEL_TIERS) {
    const key = String(tier);
    if (!(key in o)) continue;
    const parsed = parsePriceField(o[key]);
    if (parsed === 'invalid') {
      errors[`${prefix}${tier}`] = `Tier ${tier}: use valor entre ${BILLING_PRICE_MIN_BRL} e ${BILLING_PRICE_MAX_BRL}.`;
    } else if (parsed != null) {
      out[tier] = parsed;
    }
  }
}

export function emptyBillingPricingConfig(): BillingPricingConfig {
  return { channelTiersMonthly: {}, channelTiersAnnual: {}, channelAddonMonthly: null };
}

export function mergeBillingPricingFromDoc(raw: unknown): BillingPricingConfig {
  if (!raw || typeof raw !== 'object') return emptyBillingPricingConfig();
  const o = raw as Record<string, unknown>;
  const monthly: Partial<Record<ChannelTier, number>> = {};
  const annual: Partial<Record<ChannelTier, number>> = {};
  parseTierMap(o.channelTiersMonthly, 'm', {}, monthly);
  parseTierMap(o.channelTiersAnnual, 'a', {}, annual);
  let channelAddonMonthly: number | null = null;
  if ('channelAddonMonthly' in o) {
    const p = parsePriceField(o.channelAddonMonthly);
    if (typeof p === 'number') channelAddonMonthly = p;
  }
  return { channelTiersMonthly: monthly, channelTiersAnnual: annual, channelAddonMonthly };
}

export function validateBillingPricingPut(partial: BillingPricingPutInput): BillingPricingValidationResult {
  const errors: Record<string, string> = {};
  const data: BillingPricingPutInput = {};

  if (partial.channelTiersMonthly !== undefined) {
    const monthly: Partial<Record<ChannelTier, number>> = {};
    parseTierMap(partial.channelTiersMonthly, 'channelTiersMonthly.', errors, monthly);
    if (Object.keys(monthly).length > 0) data.channelTiersMonthly = monthly;
  }
  if (partial.channelTiersAnnual !== undefined) {
    const annual: Partial<Record<ChannelTier, number>> = {};
    parseTierMap(partial.channelTiersAnnual, 'channelTiersAnnual.', errors, annual);
    if (Object.keys(annual).length > 0) data.channelTiersAnnual = annual;
  }
  if (partial.channelAddonMonthly !== undefined) {
    if (partial.channelAddonMonthly === null) {
      data.channelAddonMonthly = null;
    } else {
      const p = parsePriceField(partial.channelAddonMonthly);
      if (p === 'invalid' || p == null) {
        errors.channelAddonMonthly = `Use valor entre ${BILLING_PRICE_MIN_BRL} e ${BILLING_PRICE_MAX_BRL}.`;
      } else {
        data.channelAddonMonthly = p;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  if (
    !data.channelTiersMonthly &&
    !data.channelTiersAnnual &&
    data.channelAddonMonthly === undefined
  ) {
    return { ok: false, errors: { form: 'Nenhum preço de cobrança informado.' } };
  }
  return { ok: true, data };
}

/** Matriz efetiva (defaults + env aplicados pelo servidor) para exibir no admin. */
export type ResolvedBillingPricing = {
  channelTiersMonthly: Record<ChannelTier, number>;
  channelTiersAnnual: Record<ChannelTier, number>;
  channelAddonMonthly: number;
  /** Tier base Pro (2 canais) — compatível com monthly/annual legado. */
  monthly: number;
  annual: number;
};

export function defaultResolvedBillingPricing(): ResolvedBillingPricing {
  const channelTiersMonthly = { ...CHANNEL_TIER_PRICES_MONTHLY };
  const channelTiersAnnual = { ...CHANNEL_TIER_PRICES_ANNUAL };
  const base: ChannelTier = 2;
  return {
    channelTiersMonthly,
    channelTiersAnnual,
    channelAddonMonthly: 100,
    monthly: channelTiersMonthly[base],
    annual: channelTiersAnnual[base]
  };
}
