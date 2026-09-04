/** Contadores de campanha: nunca recuar progresso já gravado. */

export type CampaignCounterTriple = {
  successCount: number;
  failedCount: number;
  processedCount: number;
};

function asCount(value: unknown): number {
  const n = Math.floor(Number(value) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function countersFromJobStatusCounts(counts: Record<string, number>): CampaignCounterTriple {
  const sent = asCount(counts.sent);
  const failed = asCount(counts.failed) + asCount(counts.dead);
  const sending = asCount(counts.sending);
  return {
    successCount: sent,
    failedCount: failed,
    processedCount: sent + failed + sending,
  };
}

export function mergeCampaignCounterTriple(
  a: CampaignCounterTriple,
  b: CampaignCounterTriple
): CampaignCounterTriple {
  const successCount = Math.max(asCount(a.successCount), asCount(b.successCount));
  const failedCount = Math.max(asCount(a.failedCount), asCount(b.failedCount));
  const processedCount = Math.max(
    asCount(a.processedCount),
    asCount(b.processedCount),
    successCount + failedCount
  );
  return { successCount, failedCount, processedCount };
}

export function countersFromCampaignDoc(doc: Record<string, unknown> | null | undefined): CampaignCounterTriple {
  if (!doc) return { successCount: 0, failedCount: 0, processedCount: 0 };
  return {
    successCount: asCount(doc.successCount),
    failedCount: asCount(doc.failedCount ?? doc.failCount),
    processedCount: asCount(doc.processedCount),
  };
}

/**
 * Persistência: se o incoming zera ou reduz o que já estava no documento,
 * mantém o maior valor (restart/retomada não pode apagar o card).
 */
export function pickCampaignProgressToPersist(
  existing: CampaignCounterTriple,
  incoming: CampaignCounterTriple
): CampaignCounterTriple {
  return mergeCampaignCounterTriple(existing, incoming);
}
