import { describe, expect, it } from 'vitest';
import {
  isRecoverableMediaDeliveryError,
  shouldSkipChipFailoverForMediaError,
} from './outboundMediaRecovery.js';

describe('outboundMediaRecovery', () => {
  it('detecta URL is required', () => {
    expect(isRecoverableMediaDeliveryError('URL is required (todos os chips tentados)')).toBe(true);
    expect(isRecoverableMediaDeliveryError('not registered')).toBe(false);
  });

  it('pula failover de chip em reply flow com texto', () => {
    expect(
      shouldSkipChipFailoverForMediaError('URL is required', {
        replyFlowResponse: true,
        hasTextFallback: true,
      })
    ).toBe(true);
    expect(
      shouldSkipChipFailoverForMediaError('URL is required', {
        replyFlowResponse: false,
        hasTextFallback: true,
      })
    ).toBe(false);
  });
});
