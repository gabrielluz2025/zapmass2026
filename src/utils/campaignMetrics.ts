import { Campaign } from '../types';

/** Métricas derivadas alinhando `processedCount` (Firestore) com sucesso+ falha. */
export function getCampaignProgressMetrics(campaign: Campaign) {
  const total = Math.max(0, Math.floor(Number(campaign.totalContacts) || 0));
  const ok = Math.max(0, Math.floor(Number(campaign.successCount) || 0));
  const fail = Math.max(0, Math.floor(Number(campaign.failedCount) || 0));
  const reported = Math.max(0, Math.floor(Number(campaign.processedCount) || 0));
  // O progresso em tempo real (`campaign-progress`) preenche `processedCount`, mas no
  // `campaign-complete` / Firestore ele às vezes fica 0 enquanto `successCount` já foi atualizado.
  const effectiveProcessed = Math.min(total, Math.max(reported, ok + fail));
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
