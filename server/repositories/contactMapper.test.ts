import { describe, expect, it } from 'vitest';
import { contactToDocPayload, mergeContactUpdates, rowToContact, sortNameForContact } from './contactMapper.js';

describe('contactMapper', () => {
  it('sortName normaliza', () => {
    expect(sortNameForContact('  Ana ')).toBe('ana');
  });

  it('rowToContact preserva campos do doc', () => {
    const c = rowToContact({
      id: '11111111-1111-1111-1111-111111111111',
      tenant_id: '22222222-2222-2222-2222-222222222222',
      name: 'João',
      phone: '5511999999999',
      sort_name: 'joão',
      doc: { city: 'SP', tags: ['vip'], status: 'VALID' },
      created_at: new Date(),
      updated_at: new Date()
    });
    expect(c.city).toBe('SP');
    expect(c.tags).toEqual(['vip']);
    expect(c.phone).toBe('5511999999999');
  });

  it('merge mantém id', () => {
    const m = mergeContactUpdates(
      { id: 'a', name: 'A', phone: '1', tags: [], status: 'VALID' },
      { name: 'B' }
    );
    expect(m.id).toBe('a');
    expect(m.name).toBe('B');
  });

  it('contactToDocPayload omite id', () => {
    const p = contactToDocPayload({ id: 'x', name: 'N', phone: 'p', tags: [], status: 'VALID' });
    expect(p.id).toBeUndefined();
    expect(p.name).toBe('N');
  });
});
