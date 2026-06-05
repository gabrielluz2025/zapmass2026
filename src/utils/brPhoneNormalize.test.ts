import { describe, expect, it } from 'vitest';
import { canonicalBrazilMobileKey, normPhoneKey } from './brPhoneNormalize';
import { recipientKeyForCampaignReport } from './campaignReportDedupe';

describe('canonicalBrazilMobileKey', () => {
  it('unifica envio com 13 dígitos e resposta com 12 (nono dígito)', () => {
    const withNine = '5547999127001';
    const withoutNine = '554799127001';
    expect(canonicalBrazilMobileKey(withNine)).toBe('5547999127001');
    expect(canonicalBrazilMobileKey(withoutNine)).toBe('5547999127001');
    expect(recipientKeyForCampaignReport(withNine)).toBe(
      recipientKeyForCampaignReport(withoutNine)
    );
    expect(normPhoneKey(withoutNine)).toBe(normPhoneKey(withNine));
  });
});
