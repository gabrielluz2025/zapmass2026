import { describe, expect, it } from 'vitest';
import type { Contact } from '../types';
import {
  classifyTemperature,
  contactIsBlacklisted,
  leadTempFromContact,
  mapContactToTempStats,
  mergePhoneStatsMaps,
} from './contactTemperature';

const contact = (partial: Partial<Contact>): Contact => ({
  id: partial.id || 'c1',
  name: partial.name || 'Ana',
  phone: partial.phone || '47999990000',
  tags: partial.tags || [],
  status: 'VALID',
  ...partial,
});

describe('temperatura do contato', () => {
  it('tag lead:quente sobrevive sem mensagens no bate-papo', () => {
    const stats = mapContactToTempStats(contact({ tags: ['lead:quente'] }), {});
    expect(stats.temp).toBe('hot');
    expect(leadTempFromContact(contact({ tags: ['lead:quente'] }))).toBe('hot');
  });

  it('opt-in de marketing conta como quente', () => {
    expect(mapContactToTempStats(contact({ marketingOptIn: true }), {}).temp).toBe('hot');
  });

  it('lista negra por tag ou flag', () => {
    expect(contactIsBlacklisted(contact({ marketingOptOut: true }))).toBe(true);
    expect(contactIsBlacklisted(contact({ tags: ['lead:lista-negra'] }))).toBe(true);
    expect(contactIsBlacklisted(contact({}))).toBe(false);
  });

  it('arquivo Postgres preenche índice vazio da RAM', () => {
    const merged = mergePhoneStatsMaps(
      {},
      {
        '5547999990000': {
          sent: 4,
          delivered: 4,
          read: 2,
          replied: 1,
          lastSentTs: Date.now() - 86400000,
          lastReplyTs: Date.now() - 3600000,
          lastReadTs: Date.now() - 7200000,
        },
      }
    );
    const stats = mapContactToTempStats(contact({ phone: '47999990000' }), merged);
    expect(stats.sent).toBeGreaterThan(0);
    expect(stats.temp).toBe('hot');
  });

  it('sem envio e sem tag continua new', () => {
    expect(classifyTemperature({
      sent: 0, delivered: 0, read: 0, replied: 0, lastSentTs: 0, lastReplyTs: 0, lastReadTs: 0,
    }).temp).toBe('new');
  });
});
