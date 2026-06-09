import { describe, expect, it } from 'vitest';
import { buildIbgeCityIndex, resolveCityWithIbge } from './ibgeCityLookup';

describe('ibgeCityLookup', () => {
  const index = buildIbgeCityIndex([
    { id: 4202404, nome: 'Blumenau', uf: 'SC' },
    { id: 3550308, nome: 'São Paulo', uf: 'SP' },
    { id: 3304557, nome: 'Rio de Janeiro', uf: 'RJ' },
    { id: 4214805, nome: 'Rio do Sul', uf: 'SC' }
  ]);

  it('resolve município único pelo IBGE', () => {
    const r = resolveCityWithIbge(index, { city: 'BLUMENAU', phoneUf: 'SC' });
    expect(r?.city).toBe('Blumenau');
    expect(r?.state).toBe('SC');
  });

  it('prefere UF do DDD quando há homônimos', () => {
    const r = resolveCityWithIbge(index, {
      city: 'Blumenau',
      phoneUf: 'SC',
      parsedEmbeddedUf: 'BA'
    });
    expect(r?.state).toBe('SC');
  });

  it('desambigua com hint de UF', () => {
    const multi = buildIbgeCityIndex([
      { id: 1, nome: 'Santa Rosa', uf: 'RS' },
      { id: 2, nome: 'Santa Rosa', uf: 'PR' }
    ]);
    const r = resolveCityWithIbge(multi, { city: 'Santa Rosa', phoneUf: 'PR' });
    expect(r?.state).toBe('PR');
  });
});
