import { describe, expect, it } from 'vitest';
import { canonicalBrazilMobileKey, normPhoneKey, repairCorruptedBrJidDigits } from './brPhoneNormalize';
import { recipientKeyForCampaignReport } from './campaignReportDedupe';

describe('repairCorruptedBrJidDigits', () => {
  it('repara JID 547… para E.164 BR DDD 47', () => {
    expect(repairCorruptedBrJidDigits('54784556296')).toBe('47984556296');
    expect(repairCorruptedBrJidDigits('547933371589')).toBe('5547933371589');
    expect(normPhoneKey('54784556296')).toBe('5547984556296');
  });
});

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
