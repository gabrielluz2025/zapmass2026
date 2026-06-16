/**
 * Detecção e comparação de campanhas A/B.
 *
 * Campanhas criadas pelo Laboratório A/B do wizard recebem o sufixo
 * " — Var A" / " — Var B" no nome. Aqui reagrupamos esses pares e calculamos
 * métricas comparativas (entrega e resposta) para apontar a variante vencedora.
 */
import { Campaign } from '../types';
import { getCampaignProgressMetrics } from './campaignMetrics';

const VAR_A_SUFFIX = ' — Var A';
const VAR_B_SUFFIX = ' — Var B';

export type AbVariantMetrics = {
  campaign: Campaign;
  variant: 'A' | 'B';
  sent: number;
  delivered: number;
  replied: number;
  failed: number;
  /** % de respostas sobre enviados. */
  replyRatePct: number;
  /** % de entregas sobre enviados. */
  deliveryRatePct: number;
};

export type AbPair = {
  baseName: string;
  a: AbVariantMetrics;
  b: AbVariantMetrics;
  /** Variante com melhor taxa de resposta; null em empate ou sem dados. */
  winner: 'A' | 'B' | null;
  /** Diferença absoluta de taxa de resposta entre as variantes (pontos %). */
  replyRateGapPct: number;
};

function variantMetrics(campaign: Campaign, variant: 'A' | 'B'): AbVariantMetrics {
  const progress = getCampaignProgressMetrics(campaign);
  const totals = campaign.reportSnapshot?.totals;
  const sent = Math.max(totals?.sent ?? 0, progress.ok);
  const delivered = totals?.delivered ?? 0;
  const replied = totals?.replied ?? 0;
  const failed = progress.fail;
  const replyRatePct = sent > 0 ? Math.round((replied / sent) * 100) : 0;
  const deliveryRatePct = sent > 0 ? Math.round((Math.max(delivered, sent - failed) / sent) * 100) : 0;
  return { campaign, variant, sent, delivered, replied, failed, replyRatePct, deliveryRatePct };
}

/** Reagrupa a lista em pares A/B; ignora variantes órfãs (sem o par). */
export function detectAbPairs(campaigns: Campaign[]): AbPair[] {
  const byBase = new Map<string, { a?: Campaign; b?: Campaign }>();
  for (const c of campaigns) {
    const name = c.name || '';
    if (name.endsWith(VAR_A_SUFFIX)) {
      const base = name.slice(0, -VAR_A_SUFFIX.length);
      const entry = byBase.get(base) || {};
      entry.a = c;
      byBase.set(base, entry);
    } else if (name.endsWith(VAR_B_SUFFIX)) {
      const base = name.slice(0, -VAR_B_SUFFIX.length);
      const entry = byBase.get(base) || {};
      entry.b = c;
      byBase.set(base, entry);
    }
  }

  const pairs: AbPair[] = [];
  for (const [baseName, { a, b }] of byBase) {
    if (!a || !b) continue;
    const am = variantMetrics(a, 'A');
    const bm = variantMetrics(b, 'B');
    const gap = Math.abs(am.replyRatePct - bm.replyRatePct);
    let winner: 'A' | 'B' | null = null;
    if (am.sent > 0 || bm.sent > 0) {
      if (am.replyRatePct > bm.replyRatePct) winner = 'A';
      else if (bm.replyRatePct > am.replyRatePct) winner = 'B';
    }
    pairs.push({ baseName, a: am, b: bm, winner, replyRateGapPct: gap });
  }
  // Mais recentes primeiro (pela data da variante A).
  pairs.sort(
    (p1, p2) =>
      new Date(p2.a.campaign.createdAt).getTime() - new Date(p1.a.campaign.createdAt).getTime()
  );
  return pairs;
}
