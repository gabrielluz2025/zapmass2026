import { describe, expect, it } from 'vitest';
import { CampaignStatus, type Campaign } from '../types';
import { isCampaignBlockingGoHistorySync } from './campaignHistorySyncPolicy';

const base = (status: CampaignStatus): Campaign =>
  ({ id: 'c1', status } as Campaign);

describe('isCampaignBlockingGoHistorySync', () => {
  it('bloqueia com RUNNING', () => {
    expect(isCampaignBlockingGoHistorySync([base(CampaignStatus.RUNNING)])).toBe(true);
  });
  it('não bloqueia com PAUSED ou concluída', () => {
    expect(isCampaignBlockingGoHistorySync([base(CampaignStatus.PAUSED)])).toBe(false);
    expect(isCampaignBlockingGoHistorySync([base(CampaignStatus.COMPLETED)])).toBe(false);
  });
});
