import { describe, expect, it } from 'vitest';
import { pickOpenFailoverChannel } from './campaignChannelFailover.js';

describe('pickOpenFailoverChannel', () => {
  it('mantém o chip atual se estiver aberto', () => {
    expect(pickOpenFailoverChannel('a', ['a', 'b'], (id) => id === 'a')).toBe('a');
  });

  it('passa para o próximo aberto do grupo', () => {
    expect(pickOpenFailoverChannel('a', ['a', 'b', 'c'], (id) => id === 'c')).toBe('c');
  });

  it('volta ao início da lista (rodízio)', () => {
    expect(pickOpenFailoverChannel('c', ['a', 'b', 'c'], (id) => id === 'a')).toBe('a');
  });

  it('devolve null se nenhum chip do grupo estiver aberto', () => {
    expect(pickOpenFailoverChannel('a', ['a', 'b'], () => false)).toBeNull();
  });
});
