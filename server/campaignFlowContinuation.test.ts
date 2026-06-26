import { describe, expect, it } from 'vitest';
import { isCampaignFlowContinuation, phoneContactIdVariants } from './campaignFlowContinuation.js';

describe('isCampaignFlowContinuation', () => {
  it('etapa inicial não é continuação', () => {
    expect(isCampaignFlowContinuation({ stageIndex: 0 })).toBe(false);
    expect(isCampaignFlowContinuation({ multiStepContact: { stepIndex: 0 } })).toBe(false);
    expect(isCampaignFlowContinuation({})).toBe(false);
  });

  it('resposta automática do reply flow é continuação', () => {
    expect(isCampaignFlowContinuation({ replyFlowResponse: true })).toBe(true);
  });

  it('reply flow após resposta é continuação', () => {
    expect(
      isCampaignFlowContinuation({
        replyFlowAfterSend: { phoneDigits: '5547999827888', newAwaitingAfterStep: 1 },
      })
    ).toBe(true);
  });

  it('multi-etapas 2+ é continuação', () => {
    expect(isCampaignFlowContinuation({ stageIndex: 1 })).toBe(true);
    expect(isCampaignFlowContinuation({ multiStepContact: { stepIndex: 1 } })).toBe(true);
  });
});

describe('phoneContactIdVariants', () => {
  it('gera variante sem nono dígito para celular BR', () => {
    const variants = phoneContactIdVariants('5547999827888');
    expect(variants).toContain('5547999827888');
    expect(variants).toContain('554799827888');
  });
});
