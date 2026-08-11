import type { CampaignWizardDraft } from '../types/campaignMission';

export type CampaignStudioSubTab = 'overview' | 'mission' | 'campaigns' | 'create';
export type CampaignsViewState = 'list' | 'create' | 'details';

export interface CampaignWizardSession {
  viewState: CampaignsViewState;
  subTab: CampaignStudioSubTab;
  selectedCampaignId: string | null;
  wizard: CampaignWizardDraft | null;
  savedAt: number;
}

export const campaignWizardSessionKey = (uid: string) => `zapmass.campaignWizardSession.${uid}`;

const SUB_TABS: CampaignStudioSubTab[] = ['overview', 'mission', 'campaigns', 'create'];
const VIEW_STATES: CampaignsViewState[] = ['list', 'create', 'details'];

function isSubTab(v: unknown): v is CampaignStudioSubTab {
  return typeof v === 'string' && (SUB_TABS as string[]).includes(v);
}

function isViewState(v: unknown): v is CampaignsViewState {
  return typeof v === 'string' && (VIEW_STATES as string[]).includes(v);
}

export function clampWizardStep(step: unknown): 1 | 2 | 3 | 4 {
  if (step === 2 || step === 3 || step === 4) return step;
  if (step === '2' || step === '3' || step === '4') return Number(step) as 2 | 3 | 4;
  return 1;
}

export function loadCampaignWizardSession(uid?: string | null): CampaignWizardSession | null {
  if (!uid || typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(campaignWizardSessionKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CampaignWizardSession>;
    if (!parsed || typeof parsed !== 'object') return null;
    const viewState = isViewState(parsed.viewState) ? parsed.viewState : 'list';
    const subTab = isSubTab(parsed.subTab) ? parsed.subTab : 'overview';
    const wizard =
      parsed.wizard && typeof parsed.wizard === 'object'
        ? {
            ...(parsed.wizard as CampaignWizardDraft),
            step: clampWizardStep((parsed.wizard as CampaignWizardDraft).step)
          }
        : null;
    return {
      viewState,
      subTab: viewState === 'create' ? 'create' : subTab,
      selectedCampaignId:
        typeof parsed.selectedCampaignId === 'string' ? parsed.selectedCampaignId : null,
      wizard,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0
    };
  } catch {
    return null;
  }
}

export function patchCampaignWizardSession(
  uid: string | null | undefined,
  patch: Partial<Pick<CampaignWizardSession, 'viewState' | 'subTab' | 'selectedCampaignId' | 'wizard'>>
): void {
  if (!uid || typeof sessionStorage === 'undefined') return;
  try {
    const prev = loadCampaignWizardSession(uid);
    const next: CampaignWizardSession = {
      viewState: patch.viewState ?? prev?.viewState ?? 'list',
      subTab: patch.subTab ?? prev?.subTab ?? 'overview',
      selectedCampaignId:
        patch.selectedCampaignId !== undefined
          ? patch.selectedCampaignId
          : (prev?.selectedCampaignId ?? null),
      wizard: patch.wizard !== undefined ? patch.wizard : (prev?.wizard ?? null),
      savedAt: Date.now()
    };
    if (next.viewState === 'create') next.subTab = 'create';
    sessionStorage.setItem(campaignWizardSessionKey(uid), JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

/** Saiu do assistente de propósito (cancelar, disparar, nova campanha). */
export function clearCampaignWizardDraft(uid: string | null | undefined): void {
  if (!uid) return;
  patchCampaignWizardSession(uid, {
    viewState: 'list',
    subTab: 'overview',
    wizard: null
  });
}

export function clearAllCampaignWizardSessions(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('zapmass.campaignWizardSession.')) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
