import { describe, expect, it } from 'vitest';
import { campaignMediaStorageKey } from '../src/utils/campaignMediaKeys.js';
import { sanitizeReplyFlowSteps } from './replyFlowEngine.js';

describe('sanitizeReplyFlowSteps + mídia por etapa', () => {
  it('mantém acceptAnyReply e descarta opções legadas no passo', () => {
    const steps = sanitizeReplyFlowSteps([
      {
        body: 'abertura',
        acceptAnyReply: true,
        options: [{ tokens: ['1'], reply: 'menu antigo' }],
      },
      { body: 'etapa 2', acceptAnyReply: true },
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0].acceptAnyReply).toBe(true);
    expect(steps[0].options).toBeUndefined();
  });

  it('usa chaves reply-step distintas por índice', () => {
    const cid = 'camp-test-1';
    expect(campaignMediaStorageKey(cid, 0)).toBe(cid);
    expect(campaignMediaStorageKey(cid, 1)).toBe(`${cid}:reply-step:1`);
    expect(campaignMediaStorageKey(cid, 2)).toBe(`${cid}:reply-step:2`);
  });
});
