import { describe, expect, it } from 'vitest';
import { shouldCountJobOnConnectionMassQueue } from './campaignConnectionQueue';

describe('shouldCountJobOnConnectionMassQueue', () => {
  it('conta disparo massa na fila do chip', () => {
    expect(shouldCountJobOnConnectionMassQueue({})).toBe(true);
    expect(shouldCountJobOnConnectionMassQueue({ replyFlowResponse: false })).toBe(true);
  });

  it('não incrementa fila do chip para reply flow ou nurture', () => {
    expect(shouldCountJobOnConnectionMassQueue({ replyFlowResponse: true })).toBe(false);
    expect(shouldCountJobOnConnectionMassQueue({ nurtureFollowUp: true })).toBe(false);
  });
});
