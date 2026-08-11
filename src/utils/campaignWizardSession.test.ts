import { afterEach, describe, expect, it } from 'vitest';
import type { CampaignWizardDraft } from '../types/campaignMission';
import {
  campaignWizardSessionKey,
  clampWizardStep,
  clearAllCampaignWizardSessions,
  clearCampaignWizardDraft,
  loadCampaignWizardSession,
  patchCampaignWizardSession
} from './campaignWizardSession';

const uid = 'user-1';

const draft = (over: Partial<CampaignWizardDraft> = {}): CampaignWizardDraft => ({
  name: 'Festa',
  sendMode: 'list',
  selectedListId: 'l1',
  manualNumbers: '',
  selectedConnectionIds: ['c1'],
  channelWeightMode: 'equal',
  channelWeights: {},
  delaySeconds: 45,
  campaignFlowMode: 'single',
  messageStages: [
    {
      id: 's1',
      body: 'Olá',
      acceptAnyReply: true,
      validTokensText: '',
      invalidReplyBody: '',
      marketingEffect: 'none'
    }
  ],
  filterCities: [],
  filterChurches: [],
  filterRoles: [],
  filterProfessions: [],
  filterDDDs: [],
  filterTemps: [],
  filterSearch: '',
  selectedContactPhones: [],
  manualSelection: false,
  step: 3,
  activeStageIdx: 0,
  ...over
});

afterEach(() => {
  sessionStorage.clear();
});

describe('campaignWizardSession', () => {
  it('clampWizardStep só aceita 1–4', () => {
    expect(clampWizardStep(3)).toBe(3);
    expect(clampWizardStep(9)).toBe(1);
    expect(clampWizardStep('2')).toBe(2);
  });

  it('grava e retoma o passo do assistente ao trocar de aba', () => {
    patchCampaignWizardSession(uid, {
      viewState: 'create',
      subTab: 'create',
      wizard: draft()
    });
    const loaded = loadCampaignWizardSession(uid);
    expect(loaded?.viewState).toBe('create');
    expect(loaded?.wizard?.name).toBe('Festa');
    expect(loaded?.wizard?.step).toBe(3);
    expect(sessionStorage.getItem(campaignWizardSessionKey(uid))).toBeTruthy();
  });

  it('patch parcial não apaga o rascunho do wizard', () => {
    patchCampaignWizardSession(uid, { viewState: 'create', wizard: draft() });
    patchCampaignWizardSession(uid, { selectedCampaignId: 'camp-9' });
    const loaded = loadCampaignWizardSession(uid);
    expect(loaded?.wizard?.name).toBe('Festa');
    expect(loaded?.selectedCampaignId).toBe('camp-9');
    expect(loaded?.viewState).toBe('create');
  });

  it('cancelar/disparar limpa o rascunho e volta à lista', () => {
    patchCampaignWizardSession(uid, { viewState: 'create', wizard: draft() });
    clearCampaignWizardDraft(uid);
    const loaded = loadCampaignWizardSession(uid);
    expect(loaded?.viewState).toBe('list');
    expect(loaded?.wizard).toBeNull();
  });

  it('logout remove todas as sessões de rascunho', () => {
    patchCampaignWizardSession(uid, { viewState: 'create', wizard: draft() });
    patchCampaignWizardSession('user-2', { viewState: 'details', selectedCampaignId: 'x' });
    clearAllCampaignWizardSessions();
    expect(loadCampaignWizardSession(uid)).toBeNull();
    expect(loadCampaignWizardSession('user-2')).toBeNull();
  });
});
