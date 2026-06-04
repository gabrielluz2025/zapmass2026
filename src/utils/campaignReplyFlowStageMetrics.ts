import type { Campaign, CampaignReplyFlowStep } from '../types';
import { recipientKeyForCampaignReport } from './campaignReportDedupe';
import {
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_SENT_LOG_MESSAGE,
  type CampaignLogPayloadLike
} from './campaignReportFromLogs';

export type ReplyFlowStageFunnel = {
  stageNumber: number;
  label: string;
  /** Contatos únicos que receberam o envio desta etapa. */
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  deliveryPct: number;
  readPct: number;
  replyPct: number;
};

type ReportRowLike = { phone: string; status: string };

const STATUS_RANK: Record<string, number> = {
  REPLIED: 5,
  READ: 4,
  DELIVERED: 3,
  SENT: 2,
  PENDING: 1,
  FAILED: 0
};

function pct(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.min(100, Math.round((num / den) * 100));
}

function logPayload(p: unknown): CampaignLogPayloadLike {
  return (p && typeof p === 'object' ? p : {}) as CampaignLogPayloadLike;
}

function sentStepFromLog(p: CampaignLogPayloadLike): number | null {
  const explicit = Number(p.replyFlowStep);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.floor(explicit);
  return null;
}

function replyStepFromLog(p: CampaignLogPayloadLike, logMessage: string): number | null {
  const step = Number(p.currentStep);
  if (logMessage === CAMPAIGN_REPLY_LOG_MESSAGE && Number.isFinite(step) && step >= 1) {
    return Math.floor(step);
  }
  return null;
}

function statusAtLeast(status: string, min: string): boolean {
  return (STATUS_RANK[status] ?? -1) >= (STATUS_RANK[min] ?? 99);
}

/**
 * Métricas por etapa do fluxo por resposta (contatos únicos, não total de envios na fila).
 * Etapa 1 usa também o relatório por contato para entregue/lido.
 */
export function buildReplyFlowStageFunnels(
  campaignId: string,
  campaign: Pick<Campaign, 'replyFlow' | 'totalContacts'>,
  logs: Array<{ timestamp: string; payload?: unknown }>,
  reportRows: ReportRowLike[]
): ReplyFlowStageFunnel[] {
  const steps = campaign.replyFlow?.enabled ? campaign.replyFlow.steps || [] : [];
  if (steps.length === 0) return [];

  const stageCount = steps.length;
  const sentByStage = Array.from({ length: stageCount }, () => new Set<string>());
  const repliedByStage = Array.from({ length: stageCount }, () => new Set<string>());
  const sendCountByPhone = new Map<string, number>();

  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const log of sortedLogs) {
    const p = logPayload(log.payload);
    if (p.campaignId && p.campaignId !== campaignId) continue;
    const msg = String(p.message || '');
    const phone = recipientKeyForCampaignReport(String(p.to || p.phoneDigits || ''));
    if (!phone) continue;

    let sentStep = sentStepFromLog(p);
    if (sentStep == null && msg === CAMPAIGN_SENT_LOG_MESSAGE) {
      const n = (sendCountByPhone.get(phone) || 0) + 1;
      sendCountByPhone.set(phone, n);
      sentStep = Math.min(n, stageCount);
    }
    if (sentStep != null && sentStep >= 1 && sentStep <= stageCount) {
      sentByStage[sentStep - 1].add(phone);
    }

    const replyStep = replyStepFromLog(p, msg);
    if (replyStep != null && replyStep >= 1 && replyStep <= stageCount) {
      repliedByStage[replyStep - 1].add(phone);
    }
  }

  const reportByPhone = new Map<string, string>();
  for (const row of reportRows) {
    const rk = recipientKeyForCampaignReport(row.phone);
    if (!rk) continue;
    const prev = reportByPhone.get(rk);
    if (!prev || (STATUS_RANK[row.status] ?? -1) > (STATUS_RANK[prev] ?? -1)) {
      reportByPhone.set(rk, row.status);
    }
  }

  return steps.map((step: CampaignReplyFlowStep, idx: number) => {
    const stageNumber = idx + 1;
    const sent = sentByStage[idx].size;
    const replied = repliedByStage[idx].size;

    let delivered = 0;
    let read = 0;
    if (stageNumber === 1) {
      for (const phone of sentByStage[idx]) {
        const st = reportByPhone.get(phone) || 'SENT';
        if (statusAtLeast(st, 'DELIVERED')) delivered++;
        if (statusAtLeast(st, 'READ')) read++;
      }
      if (sent === 0 && reportByPhone.size > 0) {
        delivered = [...reportByPhone.values()].filter((s) => statusAtLeast(s, 'DELIVERED')).length;
        read = [...reportByPhone.values()].filter((s) => statusAtLeast(s, 'READ')).length;
      }
    } else {
      for (const phone of sentByStage[idx]) {
        const st = reportByPhone.get(phone);
        if (st && statusAtLeast(st, 'DELIVERED')) delivered++;
        if (st && statusAtLeast(st, 'READ')) read++;
      }
    }

    const repliedFromReport =
      stageNumber === 1
        ? [...reportByPhone.values()].filter((s) => s === 'REPLIED').length
        : 0;
    const repliedFinal = Math.max(replied, repliedFromReport);

    const bodyPreview = String(step.body || '').trim();
    const label =
      bodyPreview.length > 28 ? `Etapa ${stageNumber} · ${bodyPreview.slice(0, 28)}…` : `Etapa ${stageNumber}`;

    return {
      stageNumber,
      label,
      sent,
      delivered,
      read,
      replied: repliedFinal,
      deliveryPct: pct(delivered, sent),
      readPct: pct(read, sent),
      replyPct: pct(repliedFinal, sent)
    };
  });
}

export function isReplyFlowCampaign(campaign: Pick<Campaign, 'replyFlow'>): boolean {
  return Boolean(campaign.replyFlow?.enabled && (campaign.replyFlow.steps?.length ?? 0) > 0);
}

/** Funil principal = etapa 1 por contato (evita 2 envios / 1 pessoa parecer 50% entrega). */
export function primaryFunnelFromReplyFlowStages(
  stages: ReplyFlowStageFunnel[],
  fallbackTotal: number
): { sent: number; delivered: number; read: number; replied: number } {
  const s1 = stages[0];
  if (!s1) {
    return { sent: fallbackTotal, delivered: 0, read: 0, replied: 0 };
  }
  return {
    sent: Math.max(s1.sent, fallbackTotal),
    delivered: s1.delivered,
    read: s1.read,
    replied: s1.replied
  };
}
