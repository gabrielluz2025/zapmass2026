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
/** Status final ao esgotar a fila: sem entregas e só falhas → FAILED (mantém botão Retomar). */
export function getCampaignSkippedCount(
  campaign: Pick<Campaign, 'skippedCount'>
): number {
  return Math.max(0, Math.floor(Number(campaign.skippedCount) || 0));
}

/**
 * Concluída com 100% e zero entregas/falhas/skips explícitos — contador fantasma ou job nunca enviou.
 */
export function isPhantomZeroOutcomeCampaign(campaign: Campaign): boolean {
  const m = getCampaignProgressMetrics(campaign);
  if (m.plannedSendTotal <= 0) return false;
  if (m.ok > 0 || m.fail > 0) return false;
  if (getCampaignSkippedCount(campaign) > 0) return false;
  if (m.effectiveProcessed < m.plannedSendTotal) return false;
  return true;
}

export function resolveCampaignTerminalStatus(params: {
  successCount: number;
  failCount: number;
  skipCount?: number;
}): CampaignStatus.COMPLETED | CampaignStatus.FAILED {
  const ok = Math.max(0, Math.floor(Number(params.successCount) || 0));
  const fail = Math.max(0, Math.floor(Number(params.failCount) || 0));
  if (ok > 0) return CampaignStatus.COMPLETED;
  if (fail > 0) return CampaignStatus.FAILED;
  const skip = Math.max(0, Math.floor(Number(params.skipCount) || 0));
  if (skip > 0) return CampaignStatus.COMPLETED;
  return CampaignStatus.FAILED;
}

/** Campanha marcada concluída no passado mas só com falhas — reclassifica para FAILED na UI. */
export function reclassifyFalseCompletedCampaign(c: Campaign): Campaign {
  if (c.status !== CampaignStatus.COMPLETED) return c;
  const ok = c.successCount ?? 0;
  const fail = c.failedCount ?? 0;
  if (ok === 0 && fail > 0) return { ...c, status: CampaignStatus.FAILED };
  if (isPhantomZeroOutcomeCampaign(c)) {
    return { ...c, status: CampaignStatus.FAILED };
  }
  const planned = getCampaignPlannedSendTotal(c);
  if (ok === 0 && fail === 0 && getCampaignSkippedCount(c) === 0 && planned > 0) {
    return { ...c, status: CampaignStatus.FAILED };
  }
  return c;
}

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
    (campaign.status === CampaignStatus.COMPLETED || campaign.status === CampaignStatus.FAILED) &&
    plannedSendTotal > 0 &&
    effectiveProcessed >= plannedSendTotal
  ) {
    // Fila esgotada nos contadores — não exibir pendentes fantasmas.
    effectiveProcessed = plannedSendTotal;
  }
  // Restantes = 0 para campanhas COMPLETED (forçado pela igualação acima)
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
  if (c.status === CampaignStatus.COMPLETED || c.status === CampaignStatus.FAILED) return true;
  if (c.status === CampaignStatus.SCHEDULED) return false;
  const m = getCampaignProgressMetrics(c);
  if (m.plannedSendTotal <= 0) return false;
  if (m.pending > 0) return false;
  if (m.effectiveProcessed < m.plannedSendTotal) return false;
  if (isPhantomZeroOutcomeCampaign(c)) return false;

  if (isConversationalMultiStepCampaign(c)) {
    // Fila inicial (1 msg/contato) esgotada nos contadores — não deixar RUNNING com 100% e 0 entregues.
    if ((c.successCount ?? 0) > 0) return false;
    return true;
  }
  return m.effectiveProcessed > 0;
}

/** @deprecated Use isCampaignQueueWorkComplete */
export function isRunningStatusButWorkComplete(c: Campaign): boolean {
  if (c.status !== CampaignStatus.RUNNING && c.status !== CampaignStatus.DRAFT) return false;
  return isCampaignQueueWorkComplete(c);
}

/**
 * Ajusta em memória status → `COMPLETED` quando a fila já foi toda contabilizada.
 */
export function healCampaignCounters(c: Campaign): Campaign {
  const m = getCampaignProgressMetrics(c);
  if (
    m.ok === (c.successCount ?? 0) &&
    m.fail === (c.failedCount ?? 0) &&
    m.effectiveProcessed === (c.processedCount ?? 0)
  ) {
    return c;
  }
  return {
    ...c,
    successCount: m.ok,
    failedCount: m.fail,
    processedCount: m.effectiveProcessed
  };
}

export function healStuckCampaignStatus(c: Campaign): Campaign {
  const reclassified = reclassifyFalseCompletedCampaign(c);
  const m = getCampaignProgressMetrics(reclassified);

  if (
    isConversationalMultiStepCampaign(reclassified) &&
    m.pending === 0 &&
    m.effectiveProcessed >= m.plannedSendTotal &&
    (reclassified.successCount ?? 0) > 0 &&
    reclassified.status === CampaignStatus.RUNNING
  ) {
    return {
      ...healCampaignCounters(reclassified),
      status: CampaignStatus.WAITING_REPLY,
    };
  }

  if (isCampaignQueueWorkComplete(reclassified)) {
    if (
      reclassified.status === CampaignStatus.COMPLETED ||
      reclassified.status === CampaignStatus.FAILED
    ) {
      const healed = healCampaignCounters(reclassified);
      if (
        healed.status === CampaignStatus.COMPLETED &&
        (healed.successCount ?? 0) === 0 &&
        (healed.failedCount ?? 0) > 0
      ) {
        return { ...healed, status: CampaignStatus.FAILED };
      }
      return healed;
    }
    const failTally = Math.max(m.fail, reclassified.failedCount ?? 0);
    const skipTally = getCampaignSkippedCount(reclassified);
    if (isPhantomZeroOutcomeCampaign(reclassified)) {
      return {
        ...healCampaignCounters(reclassified),
        status: CampaignStatus.FAILED,
        processedCount: m.effectiveProcessed,
        successCount: m.ok,
        failedCount: m.fail
      };
    }
    const terminal = resolveCampaignTerminalStatus({
      successCount: m.ok,
      failCount: failTally,
      skipCount: skipTally,
    });
    return {
      ...reclassified,
      status: terminal,
      processedCount: m.effectiveProcessed,
      successCount: m.ok,
      failedCount: m.fail,
      skippedCount: skipTally > 0 ? skipTally : reclassified.skippedCount
    };
  }
  const counters = healCampaignCounters(c);
  if (
    counters.status === CampaignStatus.DRAFT &&
    ((counters.processedCount ?? 0) > 0 ||
      (counters.successCount ?? 0) > 0 ||
      (counters.failedCount ?? 0) > 0)
  ) {
    return { ...counters, status: CampaignStatus.RUNNING };
  }
  if (
    isPhantomZeroOutcomeCampaign(counters) &&
    counters.status !== CampaignStatus.SCHEDULED &&
    counters.status !== CampaignStatus.DRAFT
  ) {
    return { ...counters, status: CampaignStatus.FAILED };
  }
  return counters;
}

/** Aplica cura de status preso e normalização de contadores (ok/fail/processed). */
export function healCampaignDocument(c: Campaign): Campaign {
  return healCampaignCounters(healStuckCampaignStatus(reclassifyFalseCompletedCampaign(c)));
}

/** @deprecated Use healStuckCampaignStatus */
export function healStuckRunningCampaign(c: Campaign): Campaign {
  return healStuckCampaignStatus(c);
}

export function healStuckRunningCampaignsList(list: Campaign[]): Campaign[] {
  return list.map(healCampaignDocument);
}

/** Campanha já saiu do rascunho ou já registrou envios — útil após timeout de ACK do socket. */
/** UI: campanha terminou (status explícito ou fila esgotada nos contadores). */
export function isCampaignEffectivelyDone(c: Campaign): boolean {
  if (c.status === CampaignStatus.FAILED) return false;
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
    status === CampaignStatus.PAUSED ||
    status === CampaignStatus.FAILED
  );
}

export function isCampaignPauseAction(status: CampaignStatus): boolean {
  return status === CampaignStatus.RUNNING || status === CampaignStatus.WAITING_REPLY;
}

/**
 * Progresso de um job não pode desfazer pausa, agenda ou conclusão.
 * Sem isso o cartão volta para Executando depois do usuário clicar em Parar,
 * e o botão deixa de oferecer Retomar.
 */
export function campaignStatusAfterProgress(current: CampaignStatus): CampaignStatus {
  if (
    current === CampaignStatus.PAUSED ||
    current === CampaignStatus.WAITING_REPLY ||
    current === CampaignStatus.COMPLETED ||
    current === CampaignStatus.SCHEDULED ||
    current === CampaignStatus.FAILED
  ) {
    return current;
  }
  return CampaignStatus.RUNNING;
}

export type CampaignProgressMetrics = ReturnType<typeof getCampaignProgressMetrics>;

/**
 * Quando o documento da campanha vem com contadores zerados mas o relatório
 * (logs + conversas) já mostra envios, alinha o hero/gauge com a realidade.
 *
 * IMPORTANTE: `totalRows` NÃO deve incluir PENDING — quem ainda não saiu
 * inflava progresso para 100% com a lista inteira materializada.
 * Prefira passar `processedRows` (enviados + falhas + pulados).
 */
export function mergeCampaignMetricsWithReport(
  base: CampaignProgressMetrics,
  report: { totalRows: number; failedCount: number; pendingCount?: number; processedRows?: number }
): CampaignProgressMetrics {
  const { failedCount } = report;
  const pendingInReport = Math.max(0, Math.floor(Number(report.pendingCount) || 0));
  const processedFromReport =
    report.processedRows != null
      ? Math.max(0, Math.floor(Number(report.processedRows) || 0))
      : Math.max(0, Math.floor(Number(report.totalRows) || 0) - pendingInReport);
  if (processedFromReport <= 0 && failedCount <= 0) return base;
  const nonFailed = Math.max(0, processedFromReport - failedCount);
  const planned = base.plannedSendTotal;
  let effectiveProcessed = Math.max(base.effectiveProcessed, processedFromReport);
  if (planned > 0) {
    effectiveProcessed = Math.min(planned, effectiveProcessed);
  }
  let ok = Math.max(base.ok, nonFailed);
  const fail = Math.max(base.fail, failedCount);
  ok = Math.min(ok, effectiveProcessed);
  const failAdj = Math.min(fail, Math.max(0, effectiveProcessed - ok));
  const progressDen = planned > 0 ? planned : Math.max(processedFromReport, 1);
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
