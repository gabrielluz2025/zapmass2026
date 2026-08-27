import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_RESUME_GRACE_MS,
  DEPLOY_GRACE_MS,
  deployGraceRemainingMs,
  isInCampaignResumeGrace,
  isInDeployGraceWindow,
} from './deployGrace.js';

describe('deployGrace', () => {
  it('detecta janela pós-restart pelo uptime do processo', () => {
    expect(isInDeployGraceWindow(30_000)).toBe(true);
    expect(isInDeployGraceWindow(DEPLOY_GRACE_MS)).toBe(false);
    expect(deployGraceRemainingMs(DEPLOY_GRACE_MS - 60_000)).toBe(60_000);
  });

  it('campanhas aguardam menos tempo que a graça total de deploy', () => {
    expect(CAMPAIGN_RESUME_GRACE_MS).toBeLessThan(DEPLOY_GRACE_MS);
    expect(isInCampaignResumeGrace(60_000)).toBe(true);
    expect(isInCampaignResumeGrace(CAMPAIGN_RESUME_GRACE_MS)).toBe(false);
  });
});
