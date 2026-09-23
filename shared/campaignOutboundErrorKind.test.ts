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

  it('classifica pausa por texto igual como content_dup (retryável)', () => {
    expect(classifyCampaignOutboundError('Campanha pausada por duplicação de texto')).toBe('content_dup');
    expect(isRetryableCampaignOutboundKind('content_dup')).toBe(true);
  });
});
