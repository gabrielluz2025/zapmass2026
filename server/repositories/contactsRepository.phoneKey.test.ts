import { describe, expect, it } from 'vitest';
import { phoneKeyForContact } from './contactsRepository.js';

describe('phoneKeyForContact', () => {
  it('unifica celular BR com e sem o 9', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const a = phoneKeyForContact('4799127001', id);
    const b = phoneKeyForContact('554799127001', id);
    const c = phoneKeyForContact('(47) 99912-7001', id);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.startsWith('55')).toBe(true);
  });

  it('telefone vazio usa id', () => {
    const id = '22222222-2222-2222-2222-222222222222';
    expect(phoneKeyForContact('', id)).toBe(`__empty__:${id}`);
  });
});
