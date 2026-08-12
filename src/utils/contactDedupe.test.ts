import { describe, expect, it } from 'vitest';
import type { Contact } from '../types';
import { mergeDuplicateGroup, pickDuplicateKeeper, remapListContactIds } from './contactDedupe';

function c(partial: Partial<Contact> & { id: string; phone: string }): Contact {
  return {
    name: 'Sem Nome',
    tags: [],
    status: 'VALID',
    ...partial
  };
}

describe('contactDedupe', () => {
  it('escolhe o cadastro com nome de pessoa em vez de nome genérico', () => {
    const keeper = pickDuplicateKeeper([
      c({ id: 'a', phone: '5547996459942', name: 'Casas' }),
      c({ id: 'b', phone: '47996459942', name: 'Maria Silva', city: 'Blumenau' })
    ]);
    expect(keeper.id).toBe('b');
  });

  it('une tags, aliases e preenche campos vazios no keeper', () => {
    const { extraIds, updates } = mergeDuplicateGroup(
      [
        c({ id: 'keep', phone: '47996459942', name: 'João', tags: ['vip'] }),
        c({
          id: 'dup',
          phone: '5547996459942',
          name: 'Casas',
          tags: ['lista-bruno'],
          city: 'Joinville',
          aliasContactIds: ['old']
        })
      ],
      '5547996459942'
    );
    expect(extraIds).toEqual(['dup']);
    expect(updates.phone).toBe('5547996459942');
    expect(updates.name).toBe('João');
    expect(updates.tags).toEqual(expect.arrayContaining(['vip', 'lista-bruno']));
    expect(updates.city).toBe('Joinville');
    expect(updates.aliasContactIds).toEqual(expect.arrayContaining(['dup', 'old']));
  });

  it('reescreve listas para o keeper sem tirar o número de outras listas', () => {
    const idMap = new Map([
      ['dup-a', 'keep'],
      ['dup-b', 'keep']
    ]);
    const listaBruno = remapListContactIds(['keep', 'dup-a', 'outro'], idMap);
    const listaAbner = remapListContactIds(['dup-b'], idMap);
    expect(listaBruno.ids).toEqual(['keep', 'outro']);
    expect(listaAbner.ids).toEqual(['keep']);
    expect(listaBruno.changed).toBe(true);
  });

  it('preserva opt-out se qualquer linha estiver na lista negra', () => {
    const { updates } = mergeDuplicateGroup(
      [
        c({ id: 'a', phone: '5547999000001', name: 'Ana' }),
        c({ id: 'b', phone: '47999000001', name: 'Ana', marketingOptOut: true })
      ],
      '5547999000001'
    );
    expect(updates.marketingOptOut).toBe(true);
  });
});
