import { describe, expect, it } from 'vitest';
import { evolutionFindPageQuery, extractEvolutionList } from './evolutionFindQuery.js';

describe('evolutionFindPageQuery', () => {
  it('página 1: skip 0 e take/offset = tamanho', () => {
    const q = evolutionFindPageQuery(1, 500);
    expect(q.page).toBe(1);
    expect(q.skip).toBe(0);
    expect(q.take).toBe(500);
    expect(q.offset).toBe(500);
    expect(q.limit).toBe(500);
  });

  it('página 2: skip avança um bloco (Evolution antiga e SQL nova)', () => {
    const q = evolutionFindPageQuery(2, 500);
    expect(q.page).toBe(2);
    expect(q.skip).toBe(500);
    expect(q.take).toBe(500);
    expect(q.offset).toBe(500);
  });
});

describe('extractEvolutionList', () => {
  it('aceita array cru', () => {
    expect(extractEvolutionList([{ id: '1' }])).toHaveLength(1);
  });

  it('aceita records / chats aninhados', () => {
    expect(extractEvolutionList({ records: [{ id: 'a' }, { id: 'b' }] })).toHaveLength(2);
    expect(extractEvolutionList({ data: { records: [{ id: 'c' }] } })).toHaveLength(1);
    expect(extractEvolutionList({ messages: { records: [{ id: 'd' }] } })).toHaveLength(1);
  });
});
