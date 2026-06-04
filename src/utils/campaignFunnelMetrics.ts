/** Garante funil coerente: entregue/lida/resposta nunca passam de enviadas. */
export function clampCampaignFunnelMetrics(
  sent: number,
  delivered: number,
  read: number,
  replied: number
): { sent: number; delivered: number; read: number; replied: number } {
  const s = Math.max(0, Math.round(sent));
  const rep = Math.min(Math.max(0, Math.round(replied)), s);
  // No WhatsApp, resposta implica entrega (e quase sempre leitura do nosso envio).
  const d = Math.min(Math.max(Math.max(0, Math.round(delivered)), rep), s);
  const r = Math.min(Math.max(Math.max(0, Math.round(read)), rep), d);
  return { sent: s, delivered: d, read: r, replied: rep };
}

const STATUS_RANK: Record<string, number> = {
  REPLIED: 5,
  READ: 4,
  DELIVERED: 3,
  SENT: 2,
  PENDING: 1,
  FAILED: 0
};

/** Conta funil a partir do relatório por contato (status já deduplicado). */
export function aggregateFunnelFromReportRows(
  rows: Array<{ status: string }>
): { sent: number; delivered: number; read: number; replied: number } {
  let delivered = 0;
  let read = 0;
  let replied = 0;
  for (const row of rows) {
    const rank = STATUS_RANK[row.status] ?? 0;
    if (rank >= STATUS_RANK.DELIVERED) delivered++;
    if (rank >= STATUS_RANK.READ) read++;
    if (row.status === 'REPLIED') replied++;
  }
  return clampCampaignFunnelMetrics(rows.length, delivered, read, replied);
}

export function funnelPct(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.min(100, Math.round((num / den) * 100));
}
