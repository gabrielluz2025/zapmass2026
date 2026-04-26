import { useEffect, useMemo, useState } from 'react';
import type { AppConfigGlobal } from '../types/appConfig';
import {
  computeAnnualSavingsPercent,
  FALLBACK_MARKETING_LABEL_ANNUAL,
  FALLBACK_MARKETING_LABEL_MONTHLY,
  formatEquivalentPerMonth,
  formatMarketingBRL,
  formatPixSublabel,
  formatPriceAnnualLabel,
  formatPriceMonthlyLabel,
  type ServerBillingPrices,
  parseMarketingPriceBRL,
  roundMoneyBRL,
  fetchServerBillingPrices
} from '../utils/marketingPrices';

const DEFAULT_PIX = 0.05;

/**
 * Garante que os valores exibidos coincidam com o checkout (MERCADOPAGO_PRICE_* no servidor)
 * via GET /api/billing/mercadopago/prices. Cai no texto de marketing (Firestore/VITE) se a API falhar.
 */
export function useProBillingPrices(
  isOpen: boolean,
  config: AppConfigGlobal
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

  const configMonthly = config.marketingPriceMonthly.trim() || FALLBACK_MARKETING_LABEL_MONTHLY;
  const configAnnual = config.marketingPriceAnnual.trim() || FALLBACK_MARKETING_LABEL_ANNUAL;

  return useMemo(() => {
    const pixDisc = server?.pixDiscountPct ?? DEFAULT_PIX;
    const mNum = server != null ? server.monthly : parseMarketingPriceBRL(configMonthly);
    const aNum = server != null ? server.annual : parseMarketingPriceBRL(configAnnual);

    const priceMonthlyLabel =
      server != null
        ? server.displayMonthly ?? formatPriceMonthlyLabel(server.monthly)
        : configMonthly;
    const priceAnnualLabel =
      server != null
        ? server.displayAnnual ?? formatPriceAnnualLabel(server.annual)
        : configAnnual;

    const pixMonthlySub =
      mNum != null
        ? formatPixSublabel(
            formatMarketingBRL(roundMoneyBRL(mNum * (1 - pixDisc))),
            pixDisc
          )
        : null;
    const pixAnnualSub =
      aNum != null
        ? formatPixSublabel(
            formatMarketingBRL(roundMoneyBRL(aNum * (1 - pixDisc))),
            pixDisc
          )
        : null;

    const sav =
      mNum != null && aNum != null ? computeAnnualSavingsPercent(mNum, aNum) : null;
    const annualSavingsBadge = sav != null ? `Economize ~${sav}%` : null;
    const annualEquivalencyHint = aNum != null ? formatEquivalentPerMonth(aNum) : '';

    return {
      priceMonthlyLabel,
      priceAnnualLabel,
      pixMonthlySub,
      pixAnnualSub,
      annualSavingsBadge,
      annualEquivalencyHint,
      fromServer: server != null
    };
  }, [configAnnual, configMonthly, server]);
}
