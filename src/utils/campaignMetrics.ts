import { Campaign, CampaignStatus } from '../types';

/** Métricas derivadas alinhando `processedCount` (Firestore) com sucesso+ falha. */
export function getCampaignProgressMetrics(campaign: Campaign) {
  const total = Math.max(0, Math.floor(Number(campaign.totalContacts) || 0));
  const ok = Math.max(0, Math.floor(Number(campaign.successCount) || 0));
  const fail = Math.max(0, Math.floor(Number(campaign.failedCount) || 0));
  const reported = Math.max(0, Math.floor(Number(campaign.processedCount) || 0));
  // O progresso em tempo real (`campaign-progress`) preenche `processedCount`, mas no
  // `campaign-complete` / Firestore ele às vezes fica 0 enquanto `successCount` já foi atualizado.
  let effectiveProcessed = Math.min(total, Math.max(reported, ok + fail));
  // Legado / falha de persistencia: status concluido no Firestore sem nenhum contador salvo
  // (tudo 0) — para a UI, trata como fila 100% processada.
  if (
    campaign.status === CampaignStatus.COMPLETED &&
    total > 0 &&
    effectiveProcessed === 0
  ) {
    effectiveProcessed = total;
  }
  const pending = Math.max(0, total - effectiveProcessed);
  const progressPct = total > 0 ? Math.round((effectiveProcessed / total) * 100) : 0;
  const successRatePct = effectiveProcessed > 0 ? Math.round((ok / effectiveProcessed) * 100) : 0;
  return {
    total,
    ok,
    fail,
    reported,
    effectiveProcessed,
    pending,
    progressPct,
    successRatePct
  };
}

/**
 * O servidor conclui a fila e o evento `campaign-complete` ou a escrita no Firestore
 * pode falhar; o documento fica `RUNNING` com contadores que já batem 100% da fila.
 * A UI nesse caso deve tratar a campanha como concluída.
 */
export function isRunningStatusButWorkComplete(c: Campaign): boolean {
  if (c.status !== CampaignStatus.RUNNING) return false;
  const m = getCampaignProgressMetrics(c);
  if (m.total <= 0) return false;
  return m.pending === 0;
}

/**
 * Ajusta em memória `RUNNING` → `COMPLETED` quando a fila já foi toda contabilizada.
 */
export function healStuckRunningCampaign(c: Campaign): Campaign {
  if (!isRunningStatusButWorkComplete(c)) return c;
  const m = getCampaignProgressMetrics(c);
  return {
    ...c,
    status: CampaignStatus.COMPLETED,
    processedCount: m.effectiveProcessed,
    successCount: m.ok,
    failedCount: m.fail
  };
}

export function healStuckRunningCampaignsList(list: Campaign[]): Campaign[] {
  return list.map(healStuckRunningCampaign);
}

export type CampaignProgressMetrics = ReturnType<typeof getCampaignProgressMetrics>;

/**
 * Quando o documento da campanha no Firestore vem com contadores zerados mas o relatório
 * (logs + conversas) já mostra envios, alinha o hero/gauge com a realidade.
 */
export function mergeCampaignMetricsWithReport(
  base: CampaignProgressMetrics,
  report: { totalRows: number; failedCount: number }
): CampaignProgressMetrics {
  const { totalRows, failedCount } = report;
  if (totalRows <= 0) return base;
  const nonFailed = Math.max(0, totalRows - failedCount);
  const total = base.total;
  let effectiveProcessed = Math.max(base.effectiveProcessed, totalRows);
  if (total > 0) {
    effectiveProcessed = Math.min(total, effectiveProcessed);
  }
  const ok = Math.max(base.ok, nonFailed);
  const fail = Math.max(base.fail, failedCount);
  const progressDen = total > 0 ? total : Math.max(totalRows, 1);
  const pending = total > 0 ? Math.max(0, total - effectiveProcessed) : 0;
  const progressPct = Math.min(100, Math.round((effectiveProcessed / progressDen) * 100));
  const successRatePct = effectiveProcessed > 0 ? Math.round((ok / effectiveProcessed) * 100) : 0;
  return {
    ...base,
    ok,
    fail,
    effectiveProcessed,
    pending,
    progressPct,
    successRatePct
  };
}
