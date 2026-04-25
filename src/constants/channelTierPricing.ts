export type ChannelTier = 1 | 2 | 3 | 4 | 5;

export const CHANNEL_TIER_PRICES_MONTHLY: Record<ChannelTier, number> = {
  1: 149.9,
  2: 249.9,
  3: 329.9,
  4: 399.9,
  5: 459.9
};

export const CHANNEL_TIER_PRICES_ANNUAL: Record<ChannelTier, number> = {
  1: 1529,
  2: 2549,
  3: 3365,
  4: 4079,
  5: 4691
};

export const brl = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
