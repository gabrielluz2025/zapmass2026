/** Preços reais de cobrança (Mercado Pago) expostos pelo backend — fonte de verdade para a UI. */
export type ServerBillingPrices = {
  monthly: number;
  annual: number;
  pixDiscountPct: number;
  currency: 'BRL';
};

const BRL_RE =
  /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/i;

/**
 * Extrai o primeiro valor em reais de um rótulo de marketing.
 * Usado como fallback quando a API de preços não está acessível.
 */
export function parseMarketingPriceBRL(label: string): number | null {
  const m1 = label.match(BRL_RE);
  const m = m1 || label.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
  if (!m) return null;
  const raw = m[1].replace(/\./g, '').replace(',', '.');
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function roundMoneyBRL(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMarketingBRL(n: number): string {
  return roundMoneyBRL(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatPriceMonthlyLabel(n: number): string {
  return `${formatMarketingBRL(n)} / mês`;
}

export function formatPriceAnnualLabel(n: number): string {
  return `${formatMarketingBRL(n)} / ano`;
}

/** % economizado no anual vs 12x o mensal (inteiro, para badge). */
export function computeAnnualSavingsPercent(
  monthly: number,
  annual: number
): number | null {
  if (!Number.isFinite(monthly) || !Number.isFinite(annual) || monthly <= 0) return null;
  const yearAtMonthly = monthly * 12;
  if (yearAtMonthly <= 0) return null;
  const pct = (1 - annual / yearAtMonthly) * 100;
  if (!Number.isFinite(pct) || pct < 0.5) return null;
  return Math.round(pct);
}

export function formatEquivalentPerMonth(annual: number): string {
  if (!Number.isFinite(annual) || annual <= 0) return '';
  return `${formatMarketingBRL(roundMoneyBRL(annual / 12))} / mês em média`;
}

export function formatPixSublabel(
  pixTotalFormatted: string,
  pixDiscountPct: number
): string {
  const pct = Math.round(pixDiscountPct * 100);
  return `${pixTotalFormatted} com ${pct}% de desconto no Pix`;
}

export async function fetchServerBillingPrices(): Promise<ServerBillingPrices | null> {
  try {
    const res = await fetch('/api/billing/mercadopago/prices', { method: 'GET' });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (data?.ok !== true) return null;
    const monthly = Number(data.monthly);
    const annual = Number(data.annual);
    const pixDiscountPct = Number(
      data.pixDiscountPct != null ? data.pixDiscountPct : 0.05
    );
    if (!Number.isFinite(monthly) || !Number.isFinite(annual) || monthly <= 0 || annual <= 0) {
      return null;
    }
    if (!Number.isFinite(pixDiscountPct) || pixDiscountPct < 0 || pixDiscountPct > 0.5) {
      return null;
    }
    return {
      monthly,
      annual,
      pixDiscountPct,
      currency: 'BRL'
    };
  } catch {
    return null;
  }
}
