import { describe, expect, it } from 'vitest';
import { releaseCampaignJobSendClaim } from './campaignJobsResilience.js';

describe('campaignJobsResilience claim helpers', () => {
  it('releaseCampaignJobSendClaim é no-op sem Postgres (não lança)', async () => {
    await expect(releaseCampaignJobSendClaim('camp__phone__0')).resolves.toBeUndefined();
  });
});
