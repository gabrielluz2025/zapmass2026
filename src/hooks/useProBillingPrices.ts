import { useEffect, useMemo, useState } from 'react';
import type { AppConfigGlobal } from '../types/appConfig';
import {
  computeAnnualSavingsPercent,
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

const ENV_MONTHLY =
  (import.meta.env.VITE_MARKETING_PRICE_MONTHLY as string | undefined)?.trim() || 'R$ 49,90 / mês';
const ENV_ANNUAL =
  (import.meta.env.VITE_MARKETING_PRICE_ANNUAL as string | undefined)?.trim() || 'R$ 479,90 / ano';

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

  const configMonthly = config.marketingPriceMonthly.trim() || ENV_MONTHLY;
  const configAnnual = config.marketingPriceAnnual.trim() || ENV_ANNUAL;

  return useMemo(() => {
    const pixDisc = server?.pixDiscountPct ?? DEFAULT_PIX;
    const mNum = server != null ? server.monthly : parseMarketingPriceBRL(configMonthly);
    const aNum = server != null ? server.annual : parseMarketingPriceBRL(configAnnual);

    const priceMonthlyLabel =
      server != null ? formatPriceMonthlyLabel(server.monthly) : configMonthly;
    const priceAnnualLabel = server != null ? formatPriceAnnualLabel(server.annual) : configAnnual;

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
