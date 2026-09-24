import { CampaignStatus, type Campaign } from '../types';

/** Alinhado ao servidor: só campanha em execução (não pausada) bloqueia HistorySync em massa. */
export function isCampaignBlockingGoHistorySync(campaigns: Campaign[]): boolean {
  return campaigns.some((c) => c.status === CampaignStatus.RUNNING);
}
