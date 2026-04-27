import { useEffect, useMemo, useState } from 'react';
import {
  CHANNEL_TIER_PRICES_ANNUAL,
  CHANNEL_TIER_PRICES_MONTHLY,
  type ChannelTier
} from '../constants/channelTierPricing';
import type { AppConfigGlobal } from '../types/appConfig';
import {
  computeAnnualSavingsPercent,
  formatEquivalentPerMonth,
  formatMarketingBRL,
  formatPixSublabel,
  formatPriceAnnualLabel,
  formatPriceMonthlyLabel,
  type ServerBillingPrices,
  roundMoneyBRL,
  fetchServerBillingPrices
} from '../utils/marketingPrices';

const DEFAULT_PIX = 0.05;

/**
 * Garante que os valores exibidos coincidam com o checkout (`channelTiers` no servidor)
 * via GET /api/billing/mercadopago/prices. Cai em constantes locais ou texto de marketing se a API falhar.
 */
export function useProBillingPrices(
  isOpen: boolean,
  _config: AppConfigGlobal,
  channelTier: ChannelTier = 2
): {
  priceMonthlyLabel: string;
  priceAnnualLabel: string;
  pixMonthlySub: string | null;
  pixAnnualSub: string | null;
  annualSavingsBadge: string | null;
  annualEquivalencyHint: string;
  fromServer: boolean;
} {
  const [server, setServer] = useState<ServerBillingPrices | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    fetchServerBillingPrices().then((p) => {
      if (alive) setServer(p);
    });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  return useMemo(() => {
    const pixDisc = server?.pixDiscountPct ?? DEFAULT_PIX;
    const row = server?.channelTiers?.[String(channelTier)];

    const mNum =
      row != null
        ? row.monthly
        : server != null && server.channelTiers == null
          ? server.monthly
          : CHANNEL_TIER_PRICES_MONTHLY[channelTier];
    const aNum =
      row != null
        ? row.annual
        : server != null && server.channelTiers == null
          ? server.annual
          : CHANNEL_TIER_PRICES_ANNUAL[channelTier];

    const priceMonthlyLabel =
      row != null
        ? row.displayMonthly ?? formatPriceMonthlyLabel(row.monthly)
        : server != null && server.channelTiers == null
          ? server.displayMonthly ?? formatPriceMonthlyLabel(server.monthly)
          : formatPriceMonthlyLabel(CHANNEL_TIER_PRICES_MONTHLY[channelTier]);

    const priceAnnualLabel =
      row != null
        ? row.displayAnnual ?? formatPriceAnnualLabel(row.annual)
        : server != null && server.channelTiers == null
          ? server.displayAnnual ?? formatPriceAnnualLabel(server.annual)
          : formatPriceAnnualLabel(CHANNEL_TIER_PRICES_ANNUAL[channelTier]);

    const pixMonthlySub = formatPixSublabel(
      formatMarketingBRL(roundMoneyBRL(mNum * (1 - pixDisc))),
      pixDisc
    );
    const pixAnnualSub = formatPixSublabel(
      formatMarketingBRL(roundMoneyBRL(aNum * (1 - pixDisc))),
      pixDisc
    );

    const sav = computeAnnualSavingsPercent(mNum, aNum);
    const annualSavingsBadge = sav != null ? `Economize ~${sav}%` : null;
    const annualEquivalencyHint = formatEquivalentPerMonth(aNum);

    return {
      priceMonthlyLabel,
      priceAnnualLabel,
      pixMonthlySub,
      pixAnnualSub,
      annualSavingsBadge,
      annualEquivalencyHint,
      fromServer: server != null
    };
  }, [channelTier, server]);
}
