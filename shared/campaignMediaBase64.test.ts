import { describe, expect, it } from 'vitest';
import { normalizeCampaignMediaBase64, approxBytesFromNormalizedBase64 } from './campaignMediaBase64.js';

describe('normalizeCampaignMediaBase64', () => {
  it('remove prefixo data URL', () => {
    expect(normalizeCampaignMediaBase64('data:image/jpeg;base64,QUJD')).toBe('QUJD');
  });

  it('remove quebras de linha', () => {
    expect(normalizeCampaignMediaBase64('QUJ\nC=')).toBe('QUJC=');
  });

  it('mantém base64 puro', () => {
    expect(normalizeCampaignMediaBase64('YWJj')).toBe('YWJj');
  });
});

describe('approxBytesFromNormalizedBase64', () => {
  it('calcula bytes de QUJD (ABC)', () => {
    expect(approxBytesFromNormalizedBase64('QUJD')).toBe(3);
  });
});
