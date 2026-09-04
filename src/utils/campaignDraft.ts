import type { Campaign, CampaignReplyFlow, CampaignReplyFlowStep } from '../types';
import type {
  CampaignWizardDraft,
  CampaignWizardStageDraft,
  SavedCampaignTemplate
} from '../types/campaignMission';

const rid = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const defaultInvalidReply = 'Não entendi. Responda com uma das opções indicadas acima.';

function resolveCampaignReplyFlow(c: Campaign): CampaignReplyFlow | undefined {
  const candidate = c.replyFlow ?? c.scheduleStartSnapshot?.replyFlow;
  if (!candidate || candidate.enabled === false) return undefined;
  const steps = Array.isArray(candidate.steps) ? candidate.steps : [];
  if (steps.length === 0) return undefined;
  return { ...candidate, enabled: true, steps };
}

function replyFlowStepToWizardStage(step: CampaignReplyFlowStep): CampaignWizardStageDraft {
  const hasOptions = Array.isArray(step.options) && step.options.length > 0;
  return {
    id: rid(),
    body: step.body,
    acceptAnyReply: hasOptions ? false : step.acceptAnyReply !== false,
    validTokensText: (step.validTokens || []).join(', '),
    invalidReplyBody: step.invalidReplyBody || defaultInvalidReply,
    marketingEffect: step.marketingEffect ?? 'none',
    optionsMode: hasOptions ? 'conditional' : 'linear',
    matchMode: step.matchMode,
    timeoutHours: step.timeoutHours,
    timeoutMessage: step.timeoutMessage,
    options: hasOptions
      ? step.options!.map((opt) => ({
          id: rid(),
          tokensText: (opt.tokens || []).join(', '),
          reply: opt.reply,
          marketingEffect: opt.marketingEffect ?? 'none',
          priority: opt.priority,
          matchMode: opt.matchMode
        }))
      : []
  };
}

function singleMessageStage(body: string): CampaignWizardStageDraft {
  return {
    id: rid(),
    body,
    acceptAnyReply: true,
    validTokensText: '',
    invalidReplyBody: defaultInvalidReply,
    marketingEffect: 'none',
    optionsMode: 'linear',
    options: []
  };
}

function buildCommonDraftFields(c: Campaign): Omit<CampaignWizardDraft, 'name' | 'editMode' | 'editCampaignId' | 'initialPoolId' | 'initialChipSelectionMode'> {
  const replyFlow = resolveCampaignReplyFlow(c);

  let campaignFlowMode: CampaignWizardDraft['campaignFlowMode'];
  let messageStages: CampaignWizardStageDraft[];

  if (replyFlow) {
    campaignFlowMode = 'reply';
    messageStages = replyFlow.steps.map(replyFlowStepToWizardStage);
  } else {
    campaignFlowMode = 'single';
    const primary = String(c.message || '').trim();
    const extras = (c.messageStages || []).map((s) => String(s || '').trim()).filter(Boolean);
    const bodies = primary ? [primary, ...extras.filter((b) => b !== primary)] : extras;
    messageStages = bodies.length > 0 ? [singleMessageStage(bodies[0])] : [singleMessageStage('')];
  }

  const globalOptOutKeywords = replyFlow?.globalOptOutKeywords || [];
  const snapshot = c.scheduleStartSnapshot;

  return {
    sendMode: c.contactListId ? 'list' : 'manual',
    selectedListId: c.contactListId || '',
    manualNumbers: '',
    selectedConnectionIds: [...(c.selectedConnectionIds || [])],
    channelWeightMode: Object.keys(c.channelWeights || {}).length > 0 ? 'custom' : 'equal',
    channelWeights: { ...(c.channelWeights || {}) },
    delaySeconds: c.delaySeconds ?? snapshot?.delaySeconds ?? 45,
    delaySecondsMax: snapshot?.delaySecondsMax,
    humanizedPauses: snapshot?.humanizedPauses,
    campaignFlowMode,
    messageStages,
    replyFlowGlobalOptOutEnabled: replyFlow?.globalOptOutEnabled !== false,
    replyFlowGlobalOptOutKeywordsText: globalOptOutKeywords.join(', '),
    filterCities: [],
    filterChurches: [],
    filterRoles: [],
    filterProfessions: [],
    filterDDDs: [],
    filterTemps: [],
    filterSearch: '',
    selectedContactPhones: [],
    manualSelection: false
  };
}

/** Monta rascunho para o assistente a partir de uma campanha existente (público deve ser conferido). */
export function buildDraftFromCampaign(c: Campaign): CampaignWizardDraft {
  return {
    name: `${c.name} (cópia)`,
    ...buildCommonDraftFields(c)
  };
}

/** Monta rascunho em modo edição — aponta para a campanha existente pelo ID. */
export function buildEditDraftFromCampaign(c: Campaign): CampaignWizardDraft {
  const snapshot = c.scheduleStartSnapshot;
  const poolId = (typeof c.poolId === 'string' && c.poolId.trim()) || snapshot?.poolId || '';
  const hasPool = Boolean(poolId);

  return {
    name: c.name,
    editMode: true,
    editCampaignId: c.id,
    initialChipSelectionMode: hasPool ? 'pool' : 'manual',
    initialPoolId: poolId || '',
    ...buildCommonDraftFields(c)
  };
}

export function templateToWizardDraft(t: SavedCampaignTemplate): CampaignWizardDraft {
  const snapshot = t.replyFlowSnapshot;
  const useReply = t.campaignFlowMode === 'reply' && snapshot?.steps?.length;

  return {
    name: `Campanha — ${t.name}`,
    sendMode: 'list',
    selectedListId: '',
    manualNumbers: '',
    selectedConnectionIds: [],
    channelWeightMode: 'equal',
    channelWeights: {},
    delaySeconds: t.delaySeconds,
    campaignFlowMode: t.campaignFlowMode,
    messageStages: useReply
      ? snapshot!.steps.map(replyFlowStepToWizardStage)
      : t.stages.map((s) => ({
          id: rid(),
          body: s.body,
          acceptAnyReply: s.acceptAnyReply,
          validTokensText: s.validTokensText,
          invalidReplyBody: s.invalidReplyBody,
          marketingEffect: s.marketingEffect ?? 'none',
          optionsMode: 'linear' as const,
          options: []
        })),
    replyFlowGlobalOptOutEnabled: useReply ? snapshot!.globalOptOutEnabled !== false : undefined,
    replyFlowGlobalOptOutKeywordsText: useReply
      ? (snapshot!.globalOptOutKeywords || []).join(', ')
      : undefined,
    filterCities: [],
    filterChurches: [],
    filterRoles: [],
    filterProfessions: [],
    filterDDDs: [],
    filterTemps: [],
    filterSearch: '',
    selectedContactPhones: [],
    manualSelection: false
  };
}
