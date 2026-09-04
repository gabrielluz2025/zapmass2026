import { describe, expect, it } from 'vitest';
import { shouldSkipSettledCampaignEnqueue, type CampaignProgressSeed } from './campaignProgressSeed.js';

function seed(partial: Partial<CampaignProgressSeed> = {}): CampaignProgressSeed {
  return {
    successCount: 0,
    failedCount: 0,
    processedCount: 0,
    settledJobIds: new Set(),
    settledPhoneStages: new Set(),
    sentPhoneKeys: new Set(),
    ...partial,
  };
}

describe('shouldSkipSettledCampaignEnqueue', () => {
  it('pula jobId já enviado', () => {
    const s = seed({ settledJobIds: new Set(['cid__5511999999999__s0']) });
    expect(shouldSkipSettledCampaignEnqueue(s, 'cid__5511999999999__s0', '11999999999', 0, true)).toBe(true);
  });

  it('pula telefone já entregue na etapa quando o card zerou', () => {
    const s = seed({ settledPhoneStages: new Set(['5511999999999@0']), sentPhoneKeys: new Set(['5511999999999']) });
    expect(
      shouldSkipSettledCampaignEnqueue(s, 'outro-id', '5511999999999', 0, true)
    ).toBe(true);
  });

  it('não pula número pendente', () => {
    const s = seed({ sentPhoneKeys: new Set(['5511888888888']) });
    expect(shouldSkipSettledCampaignEnqueue(s, 'new-job', '5511999999999', 0, true)).toBe(false);
  });
});
