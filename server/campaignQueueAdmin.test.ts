import { describe, expect, it, vi } from 'vitest';
import { purgeCampaignQueueJobs } from './campaignQueueAdmin.js';
import type { Job, Queue } from 'bullmq';

function mockJob(campaignId: string, id: string): Job<{ campaignId: string }> {
  return {
    id,
    data: { campaignId },
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<{ campaignId: string }>;
}

describe('purgeCampaignQueueJobs', () => {
  it('dry-run não chama remove e conta wouldRemove', async () => {
    const jobs = [
      { state: 'waiting' as const, job: mockJob('c1', '1') },
      { state: 'active' as const, job: mockJob('c1', '2') },
      { state: 'waiting' as const, job: mockJob('c2', '3') },
    ];
    const queue = {
      getJobs: vi.fn(async (states: string[], start: number, end: number) => {
        const state = states[0] as 'waiting' | 'active';
        return jobs.filter((j) => j.state === state).map((j) => j.job);
      }),
    } as unknown as Queue<{ campaignId: string }>;

    const result = await purgeCampaignQueueJobs(queue, 'c1', { dryRun: true });
    expect(result.matched).toBe(2);
    expect(result.wouldRemove).toBe(1);
    expect(result.skippedActive).toBe(1);
    expect(jobs[0].job.remove).not.toHaveBeenCalled();
  });
});
