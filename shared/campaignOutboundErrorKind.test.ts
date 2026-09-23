import { describe, expect, it } from 'vitest';
import {
  classifyCampaignOutboundError,
  isChipHealthOutbound4xx,
  isRecipientPolicyOutboundError,
  isRetryableCampaignOutboundKind,
  isUnrecoverableCampaignOutboundError,
} from './campaignOutboundErrorKind';

describe('campaignOutboundErrorKind', () => {
  it('classifica 463 como reachout_timelock', () => {
    expect(classifyCampaignOutboundError('server returned error 463 (todos os chips tentados)')).toBe(
      'reachout_timelock'
    );
    expect(isRecipientPolicyOutboundError('server returned error 463')).toBe(true);
    expect(isUnrecoverableCampaignOutboundError('server returned error 463')).toBe(true);
    expect(isChipHealthOutbound4xx('server returned error 463')).toBe(false);
    expect(isRetryableCampaignOutboundKind('reachout_timelock')).toBe(false);
  });

  it('classifica not registered', () => {
    expect(
      classifyCampaignOutboundError('number +554791901178@s.whatsapp.net is not registered on WhatsApp')
    ).toBe('not_registered');
    expect(isChipHealthOutbound4xx('not registered')).toBe(false);
  });

  it('classifica not authorized / device JID como chip_auth (retryável)', () => {
    expect(classifyCampaignOutboundError('not authorized (todos os chips tentados)')).toBe('chip_auth');
    expect(classifyCampaignOutboundError("the store doesn't contain a device JID")).toBe('chip_auth');
    expect(isChipHealthOutbound4xx('not authorized')).toBe(true);
    expect(isRetryableCampaignOutboundKind('chip_auth')).toBe(true);
  });
});
