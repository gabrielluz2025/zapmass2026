import type { Campaign, CampaignReplyFlowStep } from '../types';
import { clampCampaignFunnelMetrics, funnelPct } from './campaignFunnelMetrics';
import { recipientKeyForCampaignReport } from './campaignReportDedupe';
import {
  CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE,
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_SENT_LOG_MESSAGE,
  campaignLogPayloadMatchesCampaign,
  logPayloadPhoneKey,
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

const REPLY_MESSAGES = new Set([
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE
]);

function logPayload(p: unknown): CampaignLogPayloadLike {
  return (p && typeof p === 'object' ? p : {}) as CampaignLogPayloadLike;
}

function sentStepFromLog(p: CampaignLogPayloadLike): number | null {
  const explicit = Number(p.replyFlowStep);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.floor(explicit);
  return null;
}

function statusAtLeast(status: string, min: string): boolean {
  return (STATUS_RANK[status] ?? -1) >= (STATUS_RANK[min] ?? 99);
}

/** Contatos que receberam envio nesta etapa + métricas (resposta ⇒ entregue e lida). */
function metricsForStagePhones(
  phones: Set<string>,
  reportByPhone: Map<string, string>,
  repliedPhones: Set<string>
): { sent: number; delivered: number; read: number; replied: number } {
  let delivered = 0;
  let read = 0;
  let replied = 0;
  for (const phone of phones) {
    const st = reportByPhone.get(phone) || 'SENT';
    const hasReply = repliedPhones.has(phone) || st === 'REPLIED';
    if (hasReply) {
      replied++;
      delivered++;
      read++;
      continue;
    }
    if (statusAtLeast(st, 'DELIVERED')) delivered++;
    if (statusAtLeast(st, 'READ')) read++;
  }
  return clampCampaignFunnelMetrics(phones.size, delivered, read, replied);
}

/**
 * Métricas por etapa do fluxo por resposta (contatos únicos).
 * Respostas são atribuídas à etapa cujo envio ocorreu imediatamente antes (por timestamp).
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
  const sendTsByStage = Array.from({ length: stageCount }, () => new Map<string, number>());
  const sendCountByPhone = new Map<string, number>();

  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const log of sortedLogs) {
    const p = logPayload(log.payload);
    if (!campaignLogPayloadMatchesCampaign(p, campaignId)) continue;
    const msg = String(p.message || '');
    const phone = logPayloadPhoneKey(p);
    if (!phone) continue;
    const ts = new Date(log.timestamp).getTime();

    if (msg === CAMPAIGN_SENT_LOG_MESSAGE) {
      let sentStep = sentStepFromLog(p);
      if (sentStep == null) {
        const n = (sendCountByPhone.get(phone) || 0) + 1;
        sendCountByPhone.set(phone, n);
        sentStep = Math.min(n, stageCount);
      }
      if (sentStep >= 1 && sentStep <= stageCount) {
        const idx = sentStep - 1;
        sentByStage[idx].add(phone);
        const prev = sendTsByStage[idx].get(phone);
        if (prev == null || ts < prev) sendTsByStage[idx].set(phone, ts);
      }
      continue;
    }

    if (!REPLY_MESSAGES.has(msg)) continue;

    let stageIdx = -1;
    for (let i = stageCount - 1; i >= 0; i--) {
      const sendTs = sendTsByStage[i].get(phone);
      if (sendTs != null && sendTs <= ts + 500) {
        stageIdx = i;
        break;
      }
    }
    if (stageIdx < 0) {
      for (let i = stageCount - 1; i >= 0; i--) {
        if (sentByStage[i].has(phone)) {
          stageIdx = i;
          break;
        }
      }
    }
    if (stageIdx >= 0) repliedByStage[stageIdx].add(phone);
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
    const phonesForStage = new Set<string>(sentByStage[idx]);
    const clamped = metricsForStagePhones(phonesForStage, reportByPhone, repliedByStage[idx]);

    const bodyPreview = String(step.body || '').trim();
    const label =
      bodyPreview.length > 28 ? `Etapa ${stageNumber} · ${bodyPreview.slice(0, 28)}…` : `Etapa ${stageNumber}`;

    return {
      stageNumber,
      label,
      sent: clamped.sent,
      delivered: clamped.delivered,
      read: clamped.read,
      replied: clamped.replied,
      deliveryPct: funnelPct(clamped.delivered, clamped.sent),
      readPct: funnelPct(clamped.read, clamped.sent),
      replyPct: funnelPct(clamped.replied, clamped.sent)
    };
  });
}

export function isReplyFlowCampaign(campaign: Pick<Campaign, 'replyFlow'>): boolean {
  return Boolean(campaign.replyFlow?.enabled && (campaign.replyFlow.steps?.length ?? 0) > 0);
}

/** Funil principal = etapa 1 por contato (evita 2 envios / 1 pessoa parecer 50% entrega). */
export function primaryFunnelFromReplyFlowStages(
  stages: ReplyFlowStageFunnel[]
): { sent: number; delivered: number; read: number; replied: number } {
  const s1 = stages[0];
  if (!s1) return clampCampaignFunnelMetrics(0, 0, 0, 0);
  return clampCampaignFunnelMetrics(s1.sent, s1.delivered, s1.read, s1.replied);
}
