import { Campaign, CampaignStatus } from '../types';
import {
  isConversationalMultiStepCampaign,
  resolveCampaignEffectiveStageCount
} from './campaignStageCount';

/** Planejamento de envios: contactos × etapas (metadata ou inferido dos contadores). */
export function getCampaignPlannedSendTotal(
  campaign: Pick<
    Campaign,
    | 'totalContacts'
    | 'message'
    | 'messageStages'
    | 'replyFlow'
    | 'stageConfigs'
    | 'successCount'
    | 'failedCount'
  >
): number {
  const contacts = Math.max(0, Math.floor(Number(campaign.totalContacts) || 0));
  // Reply flow / multi-etapas lazy: só a etapa 1 entra na fila inicial.
  if (isConversationalMultiStepCampaign(campaign)) {
    return contacts;
  }
  const stages = resolveCampaignEffectiveStageCount(campaign);
  return contacts * stages;
}

/**
 * Taxa de entregas bem-sucedidas vs planejado (evita >100% em campanhas multi-etapa:
 * `successCount` soma um ponto por envio concluído, não por contacto).
 */
export function getCampaignDeliverySuccessRatePct(campaign: Campaign): number {
  const denom = getCampaignPlannedSendTotal(campaign);
  const ok = Math.max(0, Math.floor(Number(campaign.successCount) || 0));
  if (denom <= 0) return 0;
  return Math.min(100, Math.round((ok / denom) * 100));
}

/** Métricas derivadas: contadores do Firestore referem-se a envios por etapa; o envelope é contactos × etapas. */
export function getCampaignProgressMetrics(campaign: Campaign) {
  const total = Math.max(0, Math.floor(Number(campaign.totalContacts) || 0));
  const plannedSendTotal = Math.max(0, getCampaignPlannedSendTotal(campaign));
  let ok = Math.max(0, Math.floor(Number(campaign.successCount) || 0));
  let fail = Math.max(0, Math.floor(Number(campaign.failedCount) || 0));
  let reported = Math.max(0, Math.floor(Number(campaign.processedCount) || 0));
  let effectiveProcessed =
    plannedSendTotal <= 0 ? 0 : Math.min(plannedSendTotal, Math.max(reported, ok + fail));
  if (
    isConversationalMultiStepCampaign(campaign) &&
    campaign.status === CampaignStatus.WAITING_REPLY &&
    total > 0
  ) {
    ok = Math.min(ok, total);
    fail = Math.min(fail, total);
    effectiveProcessed = Math.min(effectiveProcessed, total);
    reported = Math.min(reported, total);
  }
  if (
    campaign.status === CampaignStatus.COMPLETED &&
    plannedSendTotal > 0 &&
    effectiveProcessed === 0
  ) {
    effectiveProcessed = plannedSendTotal;
  }
  const pending = Math.max(0, plannedSendTotal - effectiveProcessed);
  ok = Math.min(ok, plannedSendTotal, effectiveProcessed);
  fail = Math.min(fail, Math.max(0, effectiveProcessed - ok));
  const progressPct =
    plannedSendTotal > 0 ? Math.min(100, Math.round((effectiveProcessed / plannedSendTotal) * 100)) : 0;
  const successRatePct =
    effectiveProcessed > 0 ? Math.min(100, Math.round((ok / effectiveProcessed) * 100)) : 0;
  return {
    total,
    plannedSendTotal,
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
 * Fila inicial concluída (sem etapas conversacionais pendentes).
 * Inclui DRAFT/RUNNING/PAUSED com contadores 100% — comum quando o evento
 * `campaign-finished` não atualizou o documento.
 */
export function isCampaignQueueWorkComplete(c: Campaign): boolean {
  if (c.status === CampaignStatus.COMPLETED) return true;
  if (c.status === CampaignStatus.SCHEDULED) return false;
  if (isConversationalMultiStepCampaign(c)) return false;
  const m = getCampaignProgressMetrics(c);
  if (m.plannedSendTotal <= 0) return false;
  return m.pending === 0 && m.effectiveProcessed > 0;
}

/** @deprecated Use isCampaignQueueWorkComplete */
export function isRunningStatusButWorkComplete(c: Campaign): boolean {
  if (c.status !== CampaignStatus.RUNNING && c.status !== CampaignStatus.DRAFT) return false;
  return isCampaignQueueWorkComplete(c);
}

/**
 * Ajusta em memória status → `COMPLETED` quando a fila já foi toda contabilizada.
 */
export function healStuckCampaignStatus(c: Campaign): Campaign {
  if (!isCampaignQueueWorkComplete(c)) return c;
  if (c.status === CampaignStatus.COMPLETED) return c;
  const m = getCampaignProgressMetrics(c);
  return {
    ...c,
    status: CampaignStatus.COMPLETED,
    processedCount: m.effectiveProcessed,
    successCount: m.ok,
    failedCount: m.fail
  };
}

/** @deprecated Use healStuckCampaignStatus */
export function healStuckRunningCampaign(c: Campaign): Campaign {
  return healStuckCampaignStatus(c);
}

export function healStuckRunningCampaignsList(list: Campaign[]): Campaign[] {
  return list.map(healStuckCampaignStatus);
}

/** Campanha já saiu do rascunho ou já registrou envios — útil após timeout de ACK do socket. */
/** UI: campanha terminou (status explícito ou fila esgotada nos contadores). */
export function isCampaignEffectivelyDone(c: Campaign): boolean {
  return c.status === CampaignStatus.COMPLETED || isCampaignQueueWorkComplete(c);
}

export function isCampaignLikelyStartedOnServer(c: Campaign | undefined): boolean {
  if (!c) return false;
  if (
    c.status === CampaignStatus.RUNNING ||
    c.status === CampaignStatus.WAITING_REPLY ||
    c.status === CampaignStatus.PAUSED ||
    c.status === CampaignStatus.COMPLETED
  ) {
    return true;
  }
  return (c.processedCount ?? 0) > 0 || (c.successCount ?? 0) > 0 || (c.failedCount ?? 0) > 0;
}

/** Campanha em fila, aguardando resposta ou pausada — exibe Pausar/Retomar na UI. */
export function isCampaignPauseControlVisible(status: CampaignStatus): boolean {
  return (
    status === CampaignStatus.RUNNING ||
    status === CampaignStatus.WAITING_REPLY ||
    status === CampaignStatus.PAUSED
  );
}

export function isCampaignPauseAction(status: CampaignStatus): boolean {
  return status === CampaignStatus.RUNNING || status === CampaignStatus.WAITING_REPLY;
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
  const planned = base.plannedSendTotal;
  let effectiveProcessed = Math.max(base.effectiveProcessed, totalRows);
  if (planned > 0) {
    effectiveProcessed = Math.min(planned, effectiveProcessed);
  }
  let ok = Math.max(base.ok, nonFailed);
  const fail = Math.max(base.fail, failedCount);
  ok = Math.min(ok, effectiveProcessed);
  const failAdj = Math.min(fail, Math.max(0, effectiveProcessed - ok));
  const progressDen = planned > 0 ? planned : Math.max(totalRows, 1);
  const pending = planned > 0 ? Math.max(0, planned - effectiveProcessed) : 0;
  const progressPct = Math.min(100, Math.round((effectiveProcessed / progressDen) * 100));
  const successRatePct =
    effectiveProcessed > 0 ? Math.min(100, Math.round((ok / effectiveProcessed) * 100)) : 0;
  return {
    ...base,
    ok,
    fail: failAdj,
    effectiveProcessed,
    pending,
    progressPct,
    successRatePct
  };
}
