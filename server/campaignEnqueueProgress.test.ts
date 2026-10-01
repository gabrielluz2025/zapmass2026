import { describe, expect, it } from 'vitest';
import { adjustCampaignRuntimeForEnqueue } from './campaignEnqueueProgress.js';

describe('adjustCampaignRuntimeForEnqueue', () => {
  it('conta skips de frequency cap no total e processed', () => {
    const r = adjustCampaignRuntimeForEnqueue({
      seededProcessed: 0,
      pendingEnqueueLength: 70,
      skippedFrequencyCap: 30,
    });
    expect(r).toEqual({ total: 100, processed: 30, skipCountAdd: 30 });
  });

  it('resume com seededProcessed não duplica settled skips', () => {
    const r = adjustCampaignRuntimeForEnqueue({
      seededProcessed: 50,
      pendingEnqueueLength: 40,
      skippedFrequencyCap: 10,
    });
    expect(r.total).toBe(100);
    expect(r.processed).toBe(60);
    expect(r.skipCountAdd).toBe(10);
  });
});
