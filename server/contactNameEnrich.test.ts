import { describe, expect, it } from 'vitest';
import { phoneCandidatesFromConversation } from '../src/utils/contactPhoneLookup.js';

describe('phoneCandidatesFromConversation', () => {
  it('usa waJidAlt e ignora contactName com dígitos LID', () => {
    const candidates = phoneCandidatesFromConversation({
      id: 'conn:27646771622071@lid',
      contactPhone: '+27646771622071',
      contactName: '+27646771622071',
      waJidAlt: '5547999887766@s.whatsapp.net',
    });
    expect(candidates.some((c) => c.includes('5547999887766'))).toBe(true);
    expect(candidates.some((c) => c.includes('27646771622071'))).toBe(true);
  });
});
