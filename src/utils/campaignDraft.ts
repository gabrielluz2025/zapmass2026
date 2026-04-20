import type { Campaign } from '../types';
import type { CampaignWizardDraft, SavedCampaignTemplate } from '../types/campaignMission';

const rid = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/** Monta rascunho para o assistente a partir de uma campanha existente (público deve ser conferido). */
export function buildDraftFromCampaign(c: Campaign): CampaignWizardDraft {
  const stages: CampaignWizardDraft['messageStages'] =
    c.replyFlow?.enabled && c.replyFlow.steps.length
      ? c.replyFlow.steps.map((step) => ({
          id: rid(),
          body: step.body,
          acceptAnyReply: step.acceptAnyReply,
          validTokensText: (step.validTokens || []).join(', '),
          invalidReplyBody: step.invalidReplyBody || ''
        }))
      : (c.messageStages?.length ? c.messageStages : [c.message]).map((body) => ({
          id: rid(),
          body,
          acceptAnyReply: true,
          validTokensText: '1, 2, sim, nao',
          invalidReplyBody: 'Nao entendi. Responda com uma das opcoes indicadas acima.'
        }));

  return {
    name: `${c.name} (cópia)`,
    sendMode: c.contactListId ? 'list' : 'manual',
    selectedListId: c.contactListId || '',
    manualNumbers: '',
    selectedConnectionIds: [...(c.selectedConnectionIds || [])],
    delaySeconds: c.delaySeconds ?? 45,
    campaignFlowMode: c.replyFlow?.enabled ? 'reply' : 'sequential',
    messageStages: stages,
    filterCities: [],
    filterChurches: [],
    filterRoles: [],
    filterProfessions: [],
    filterDDDs: [],
    filterSearch: '',
    selectedContactPhones: [],
    manualSelection: false
  };
}

export function templateToWizardDraft(t: SavedCampaignTemplate): CampaignWizardDraft {
  return {
    name: `Campanha — ${t.name}`,
    sendMode: 'list',
    selectedListId: '',
    manualNumbers: '',
    selectedConnectionIds: [],
    delaySeconds: t.delaySeconds,
    campaignFlowMode: t.campaignFlowMode,
    messageStages: t.stages.map((s) => ({
      id: rid(),
      body: s.body,
      acceptAnyReply: s.acceptAnyReply,
      validTokensText: s.validTokensText,
      invalidReplyBody: s.invalidReplyBody
    })),
    filterCities: [],
    filterChurches: [],
    filterRoles: [],
    filterProfessions: [],
    filterDDDs: [],
    filterSearch: '',
    selectedContactPhones: [],
    manualSelection: false
  };
}
