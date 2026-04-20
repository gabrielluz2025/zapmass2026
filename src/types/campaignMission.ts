import type { CampaignReplyFlow } from '../types';

/** Rascunho para reabrir o assistente (clone / template). */
export interface CampaignWizardDraft {
  name: string;
  sendMode: 'list' | 'manual' | 'filter';
  selectedListId: string;
  manualNumbers: string;
  selectedConnectionIds: string[];
  delaySeconds: number;
  campaignFlowMode: 'sequential' | 'reply';
  messageStages: Array<{
    id: string;
    body: string;
    acceptAnyReply: boolean;
    validTokensText: string;
    invalidReplyBody: string;
  }>;
  filterCities: string[];
  filterChurches: string[];
  filterRoles: string[];
  filterProfessions: string[];
  filterDDDs: string[];
  filterSearch: string;
  selectedContactPhones: string[];
  manualSelection: boolean;
}

export interface SavedCampaignTemplate {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  delaySeconds: number;
  campaignFlowMode: 'sequential' | 'reply';
  stages: Array<{
    body: string;
    acceptAnyReply: boolean;
    validTokensText: string;
    invalidReplyBody: string;
  }>;
  replyFlowSnapshot?: CampaignReplyFlow;
}

export type CampaignAuditAction =
  | 'campaign_create'
  | 'campaign_pause'
  | 'campaign_resume'
  | 'campaign_delete'
  | 'campaign_ab_launch'
  | 'template_save'
  | 'export_csv'
  | 'campaign_clone';

export interface CampaignAuditEntry {
  id: string;
  at: string;
  action: CampaignAuditAction;
  label: string;
  campaignId?: string;
  meta?: Record<string, string | number | boolean | undefined>;
}
