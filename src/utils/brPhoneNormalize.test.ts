import { describe, expect, it } from 'vitest';
import {
  canonicalBrazilMobileKey,
  normPhoneKey,
  normalizeBRPhone,
  repairCorruptedBrJidDigits,
} from './brPhoneNormalize.ts';
import { recipientKeyForCampaignReport } from './campaignReportDedupe';

describe('normalizeBRPhone planilhas', () => {
  it('remove 0 tronco e DDI em número com 13 dígitos (0+DDD+local)', () => {
    expect(normalizeBRPhone('0479996392111')).toBe('5547996392111');
    expect(normalizeBRPhone('048996460175')).toBe('5548996460175');
  });

  it('repara local com 9 duplicado após DDD', () => {
    expect(normalizeBRPhone('479996392111')).toBe('5547996392111');
  });
});

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

  it('não inventa 9º dígito em telefone fixo (prefixo 2–5)', () => {
    expect(canonicalBrazilMobileKey('554732375383')).toBe('554732375383');
    expect(canonicalBrazilMobileKey('5547932375383')).toBe('554732375383');
  });
});
