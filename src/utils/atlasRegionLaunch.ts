import type { CampaignWizardDraft } from '../types/campaignMission';
import type { ContactTemperature } from './contactTemperature';

const CAMPAIGN_KEY = 'zapmass.pendingCampaignDraft';
const CONTACTS_KEY = 'zapmass.atlasContactsHint';

export type AtlasRegionLaunch = {
  city: string;
  state?: string;
  neighborhood?: string;
  tempFilter?: ContactTemperature | 'all';
  scope: 'city' | 'state';
};

export function buildCampaignDraftFromAtlas(launch: AtlasRegionLaunch): CampaignWizardDraft {
  const cityLabel =
    launch.scope === 'state' && launch.state
      ? launch.state
      : launch.state
      ? `${launch.city} · ${launch.state}`
      : launch.city;
  const nameParts = ['Campanha', cityLabel];
  if (launch.neighborhood) nameParts.push(launch.neighborhood);
  const stageId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `s-${Date.now()}`;

  return {
    name: nameParts.join(' — '),
    sendMode: 'filter',
    selectedListId: '',
    manualNumbers: '',
    selectedConnectionIds: [],
    channelWeightMode: 'equal',
    channelWeights: {},
    delaySeconds: 45,
    campaignFlowMode: 'single',
    messageStages: [
      {
        id: stageId,
        body: '',
        acceptAnyReply: true,
        validTokensText: '1, 2, sim, nao',
        invalidReplyBody: 'Não entendi. Responda com uma das opções acima.',
        marketingEffect: 'none'
      }
    ],
    filterCities: launch.scope === 'city' ? [cityLabel] : [],
    filterChurches: [],
    filterRoles: [],
    filterProfessions: [],
    filterDDDs: launch.scope === 'state' && launch.state ? [] : [],
    filterTemps:
      launch.tempFilter && launch.tempFilter !== 'all' ? [launch.tempFilter] : [],
    filterSearch: launch.neighborhood || '',
    selectedContactPhones: [],
    manualSelection: false
  };
}

export function launchAtlasCampaign(launch: AtlasRegionLaunch): void {
  try {
    sessionStorage.setItem(CAMPAIGN_KEY, JSON.stringify(buildCampaignDraftFromAtlas(launch)));
  } catch {
    /* ignore quota */
  }
}

export function saveAtlasContactsHint(launch: AtlasRegionLaunch): void {
  try {
    sessionStorage.setItem(CONTACTS_KEY, JSON.stringify(launch));
  } catch {
    /* ignore */
  }
}

export function consumeAtlasContactsHint(): AtlasRegionLaunch | null {
  try {
    const raw = sessionStorage.getItem(CONTACTS_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CONTACTS_KEY);
    return JSON.parse(raw) as AtlasRegionLaunch;
  } catch {
    return null;
  }
}
