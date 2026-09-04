import { describe, expect, it } from 'vitest';
import { buildCampaignSendJobId, isDuplicateBullmqJobError } from './campaignJobIdentity.js';

describe('buildCampaignSendJobId', () => {
  it('é estável para o mesmo contato e etapa', () => {
    const a = buildCampaignSendJobId({ campaignId: 'c1', to: '+55 47 97185-6371', stageIndex: 0 });
    const b = buildCampaignSendJobId({ campaignId: 'c1', to: '5547971856371', stageIndex: 0 });
    expect(a).toBe(b);
    expect(a).toBe('c1__5547971856371__s0');
  });

  it('não inclui chip — redispatch no outro canal não cria segundo job', () => {
    const id = buildCampaignSendJobId({ campaignId: 'c1', to: '5547999999999', stageIndex: 0 });
    expect(id).toBe('c1__5547999999999__s0');
  });

  it('resposta de fluxo usa id único', () => {
    const a = buildCampaignSendJobId({
      campaignId: 'c1',
      to: '5547999999999',
      replyFlowResponse: true,
    });
    const b = buildCampaignSendJobId({
      campaignId: 'c1',
      to: '5547999999999',
      replyFlowResponse: true,
    });
    expect(a).not.toBe(b);
    expect(a).toContain('__rf__');
  });
});

describe('isDuplicateBullmqJobError', () => {
  it('reconhece job já na fila', () => {
    expect(isDuplicateBullmqJobError(new Error('Job c1__x__s0 already exists'))).toBe(true);
    expect(isDuplicateBullmqJobError(new Error('Redis timeout'))).toBe(false);
  });
});
