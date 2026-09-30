import { describe, expect, it } from 'vitest';
import {
  campaignJobScanPatterns,
  campaignMassQueueName,
  hashConnectionIdForQueue,
  usePerChannelCampaignQueues,
} from './campaignChannelBullmq.js';

describe('campaignChannelBullmq', () => {
  it('gera nome de fila estável por connectionId', () => {
    const a = campaignMassQueueName('Disparo-01');
    const b = campaignMassQueueName('Disparo-01');
    expect(a).toBe(b);
    expect(a.startsWith('campaign-ch-')).toBe(true);
    expect(hashConnectionIdForQueue('x')).toHaveLength(24);
  });

  it('padrões de scan incluem legado e filas por chip', () => {
    const p = campaignJobScanPatterns('camp-123');
    expect(p.some((x) => x.includes('campaign-messages'))).toBe(true);
    expect(p.some((x) => x.includes('campaign-ch-*'))).toBe(true);
  });

  it('filas por chip ativas por padrão', () => {
    const prev = process.env.CAMPAIGN_USE_GLOBAL_QUEUE;
    delete process.env.CAMPAIGN_USE_GLOBAL_QUEUE;
    expect(usePerChannelCampaignQueues()).toBe(true);
    process.env.CAMPAIGN_USE_GLOBAL_QUEUE = '1';
    expect(usePerChannelCampaignQueues()).toBe(false);
    if (prev === undefined) delete process.env.CAMPAIGN_USE_GLOBAL_QUEUE;
    else process.env.CAMPAIGN_USE_GLOBAL_QUEUE = prev;
  });
});
