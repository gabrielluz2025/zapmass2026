import { describe, expect, it } from 'vitest';
import { massCampaignMustSendOpeningMedia } from './campaignMediaDispatchGuard.js';

describe('massCampaignMustSendOpeningMedia', () => {
  it('exige mídia na etapa 0 quando sendAsMedia', () => {
    expect(
      massCampaignMustSendOpeningMedia({ sendAsMedia: true, stageIndex: 0 })
    ).toBe(true);
  });

  it('exige mídia com flag expectsOpeningMediaOnSend', () => {
    expect(
      massCampaignMustSendOpeningMedia({ expectsOpeningMediaOnSend: true, stageIndex: 0 })
    ).toBe(true);
  });

  it('não exige em resposta de fluxo', () => {
    expect(
      massCampaignMustSendOpeningMedia({
        sendAsMedia: true,
        stageIndex: 0,
        replyFlowResponse: true,
      })
    ).toBe(false);
  });

  it('não exige na etapa 2', () => {
    expect(
      massCampaignMustSendOpeningMedia({ sendAsMedia: true, stageIndex: 2 })
    ).toBe(false);
  });
});
