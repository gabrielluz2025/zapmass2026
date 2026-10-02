import { afterEach, describe, expect, it } from 'vitest';
import {
  getCampaignSendClaimStaleSeconds,
  releaseCampaignJobSendClaim,
} from './campaignJobsResilience.js';

describe('campaignJobsResilience claim helpers', () => {
  const prevMediaTimeout = process.env.EVOLUTION_MEDIA_TIMEOUT_MS;

  afterEach(() => {
    if (prevMediaTimeout === undefined) delete process.env.EVOLUTION_MEDIA_TIMEOUT_MS;
    else process.env.EVOLUTION_MEDIA_TIMEOUT_MS = prevMediaTimeout;
  });

  it('releaseCampaignJobSendClaim é no-op sem Postgres (não lança)', async () => {
    await expect(releaseCampaignJobSendClaim('camp__phone__0')).resolves.toBeUndefined();
  });

  it('getCampaignSendClaimStaleSeconds cobre timeout de mídia Evolution + folga', () => {
    process.env.EVOLUTION_MEDIA_TIMEOUT_MS = '120000';
    expect(getCampaignSendClaimStaleSeconds()).toBe(180);
    process.env.EVOLUTION_MEDIA_TIMEOUT_MS = '60000';
    expect(getCampaignSendClaimStaleSeconds()).toBe(120);
  });
});
