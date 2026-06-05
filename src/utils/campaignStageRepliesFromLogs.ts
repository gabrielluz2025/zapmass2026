import {
  collectReplyEventsFromLogs,
  collectStagePhoneState,
  inferReplyStageIndex
} from './campaignReplyFlowStageMetrics';
import type { CampaignLogPayloadLike } from './campaignReportFromLogs';

export type StageReplyEntry = {
  stageNumber: number;
  replyText?: string;
  replyTime: string;
  replyTimestampMs: number;
};

function replyTextFromPayload(p: CampaignLogPayloadLike): string | undefined {
  const text = String(p.replyPreview || '').trim();
  if (text) return text;
  if (p.nonTextReply) return '[resposta sem texto legível]';
  return undefined;
}

function stageNumberFromReply(
  p: CampaignLogPayloadLike,
  phone: string,
  ts: number,
  stageCount: number,
  sendTsByStage: Map<string, number>[],
  sentByStage: Set<string>[]
): number {
  const explicit = Number(p.currentStep ?? p.replyFlowStep);
  if (Number.isFinite(explicit) && explicit >= 1 && explicit <= stageCount) {
    return Math.floor(explicit);
  }
  const idx = inferReplyStageIndex(phone, ts, stageCount, sendTsByStage, sentByStage);
  return idx >= 0 ? idx + 1 : 0;
}

function mergeStageReply(prev: StageReplyEntry, next: StageReplyEntry): StageReplyEntry {
  const text = next.replyText || prev.replyText;
  const useNext = Boolean(next.replyText) || next.replyTimestampMs >= prev.replyTimestampMs;
  const pick = useNext ? next : prev;
  return {
    stageNumber: pick.stageNumber,
    replyText: text,
    replyTime: pick.replyTime,
    replyTimestampMs: pick.replyTimestampMs
  };
}

/** Respostas do contato por etapa do fluxo (a partir dos logs da campanha). */
export function buildStageRepliesByPhone(
  campaignId: string,
  stageCount: number,
  logs: Array<{ timestamp: string; payload?: unknown }>
): Map<string, StageReplyEntry[]> {
  const out = new Map<string, Map<number, StageReplyEntry>>();
  if (stageCount < 1) return new Map();

  const { state } = collectStagePhoneState(campaignId, stageCount, logs);
  const events = collectReplyEventsFromLogs(campaignId, logs);

  for (const e of events) {
    const stageNumber = stageNumberFromReply(
      e.p,
      e.phone,
      e.ts,
      stageCount,
      state.sendTsByStage,
      state.sentByStage
    );
    if (stageNumber < 1) continue;

    const entry: StageReplyEntry = {
      stageNumber,
      replyText: replyTextFromPayload(e.p),
      replyTimestampMs: e.ts,
      replyTime: new Date(e.ts).toLocaleTimeString('pt-BR')
    };

    let perPhone = out.get(e.phone);
    if (!perPhone) {
      perPhone = new Map();
      out.set(e.phone, perPhone);
    }
    const prev = perPhone.get(stageNumber);
    perPhone.set(stageNumber, prev ? mergeStageReply(prev, entry) : entry);
  }

  const result = new Map<string, StageReplyEntry[]>();
  for (const [phone, perStage] of out) {
    const list = Array.from(perStage.values()).sort((a, b) => a.stageNumber - b.stageNumber);
    if (list.length > 0) result.set(phone, list);
  }
  return result;
}
