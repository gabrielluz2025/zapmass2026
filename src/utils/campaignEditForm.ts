import type { Campaign, CampaignDailySchedule, CampaignReplyFlow } from '../types';
import { extractDailyScheduleDraftFields } from './campaignDraft';

export type CampaignEditTab = 'message' | 'chips' | 'pace';

export interface CampaignEditFormState {
  name: string;
  message: string;
  extraMessageStages: string[];
  replyFlowSteps: string[];
  hasReplyFlow: boolean;
  selectedConnectionIds: string[];
  delaySeconds: number;
  delaySecondsMax: number;
  humanizedPauses: boolean;
  dailyScheduleEnabled: boolean;
  dailyScheduleDays: Array<{ dayIndex: number; limitPerChannel: number }>;
  allowedWeekdays: number[];
  timePeriodEnabled: boolean;
  morningPct: number;
  morningStartHour: number;
  morningEndHour: number;
  afternoonStartHour: number;
  afternoonEndHour: number;
}

function resolveReplyFlow(c: Campaign): CampaignReplyFlow | undefined {
  const candidate = c.replyFlow ?? c.scheduleStartSnapshot?.replyFlow;
  if (!candidate || candidate.enabled === false) return undefined;
  const steps = Array.isArray(candidate.steps) ? candidate.steps : [];
  if (steps.length === 0) return undefined;
  return { ...candidate, enabled: true, steps };
}

/** Monta estado inicial do formulário de edição a partir da campanha salva. */
export function campaignToEditForm(c: Campaign): CampaignEditFormState {
  const replyFlow = resolveReplyFlow(c);
  const snapshot = c.scheduleStartSnapshot;
  const primary = String(c.message || '').trim();
  const extras = (c.messageStages || []).map((s) => String(s || '').trim()).filter(Boolean);
  const scheduleFields = extractDailyScheduleDraftFields(c);

  return {
    name: c.name,
    message: primary,
    extraMessageStages: extras,
    replyFlowSteps: replyFlow ? replyFlow.steps.map((s) => s.body) : [],
    hasReplyFlow: Boolean(replyFlow),
    selectedConnectionIds: [...(c.selectedConnectionIds || snapshot?.connectionIds || [])],
    delaySeconds: c.delaySeconds ?? snapshot?.delaySeconds ?? 45,
    delaySecondsMax: c.delaySecondsMax ?? snapshot?.delaySecondsMax ?? 90,
    humanizedPauses: c.humanizedPauses ?? snapshot?.humanizedPauses !== false,
    dailyScheduleEnabled: scheduleFields.dailyScheduleEnabled === true,
    dailyScheduleDays: scheduleFields.dailyScheduleDays ?? [],
    allowedWeekdays: scheduleFields.allowedWeekdays ?? [0, 1, 2, 3, 4, 5, 6],
    timePeriodEnabled: scheduleFields.timePeriodEnabled === true,
    morningPct: scheduleFields.morningPct ?? 50,
    morningStartHour: scheduleFields.morningStartHour ?? 8,
    morningEndHour: scheduleFields.morningEndHour ?? 12,
    afternoonStartHour: scheduleFields.afternoonStartHour ?? 13,
    afternoonEndHour: scheduleFields.afternoonEndHour ?? 18
  };
}

function buildReplyFlowPatch(c: Campaign, stepBodies: string[]): CampaignReplyFlow | undefined {
  const existing = resolveReplyFlow(c);
  if (!existing) return undefined;
  return {
    ...existing,
    enabled: true,
    steps: existing.steps.map((step, idx) => ({
      ...step,
      body: String(stepBodies[idx] ?? step.body).trim() || step.body
    }))
  };
}

function buildDailySchedule(form: CampaignEditFormState): CampaignDailySchedule | undefined {
  if (!form.dailyScheduleEnabled || form.dailyScheduleDays.length === 0) return undefined;
  return {
    enabled: true,
    allowedWeekdays: form.allowedWeekdays,
    timePeriodEnabled: form.timePeriodEnabled,
    ...(form.timePeriodEnabled
      ? {
          periods: [
            {
              name: 'morning' as const,
              pct: form.morningPct,
              startHour: form.morningStartHour,
              endHour: form.morningEndHour
            },
            {
              name: 'afternoon' as const,
              pct: 100 - form.morningPct,
              startHour: form.afternoonStartHour,
              endHour: form.afternoonEndHour
            }
          ]
        }
      : {}),
    days: form.dailyScheduleDays.map((d, idx) => ({
      dayIndex: d.dayIndex ?? idx,
      limitPerChannel: Math.max(1, Number(d.limitPerChannel) || 1)
    }))
  };
}

/** Payload pronto para PATCH + updateCampaignChannels. */
export function buildCampaignEditSavePayload(
  c: Campaign,
  form: CampaignEditFormState
): {
  patch: Record<string, unknown>;
  channelIds: string[];
} {
  const channelIds = form.selectedConnectionIds.filter(Boolean);
  const patch: Record<string, unknown> = {
    name: form.name.trim() || c.name,
    delaySeconds: form.delaySeconds,
    delaySecondsMax: form.delaySecondsMax > form.delaySeconds ? form.delaySecondsMax : undefined,
    humanizedPauses: form.humanizedPauses,
    selectedConnectionIds: channelIds
  };

  if (form.hasReplyFlow) {
    const replyFlow = buildReplyFlowPatch(c, form.replyFlowSteps);
    if (replyFlow) patch.replyFlow = replyFlow;
    patch.message = form.replyFlowSteps[0]?.trim() || c.message;
    patch.messageStages = [];
  } else {
    patch.message = form.message.trim();
    patch.messageStages = form.extraMessageStages;
  }

  const dailySchedule = buildDailySchedule(form);
  if (dailySchedule) patch.dailySchedule = dailySchedule;

  if (c.channelWeights && Object.keys(c.channelWeights).length > 0) {
    patch.channelWeights = c.channelWeights;
  }
  if (c.poolStrategy) patch.poolStrategy = c.poolStrategy;
  if (c.poolId) patch.poolId = c.poolId;

  return { patch, channelIds };
}
