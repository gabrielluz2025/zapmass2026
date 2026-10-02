import { describe, expect, it } from 'vitest';
import { phoneDigitsFromConversationId } from './inboxAssignments.js';

describe('phoneDigitsFromConversationId', () => {
  it('extrai dígitos do JID após connectionId', () => {
    expect(phoneDigitsFromConversationId('conn_abc:5547999127001@s.whatsapp.net')).toBe('5547999127001');
  });

  it('retorna vazio para id inválido', () => {
    expect(phoneDigitsFromConversationId('')).toBe('');
    expect(phoneDigitsFromConversationId('sem-colon')).toBe('');
  });
});
