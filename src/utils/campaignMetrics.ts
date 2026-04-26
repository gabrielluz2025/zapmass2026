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
