import { describe, expect, it } from 'vitest';
import {
  buildIbgeCityIndex,
  parseCitySearchQuery,
  resolveCityWithIbge,
  resolveCitySearchLabel,
  searchIbgeCities,
} from './ibgeCityLookup';

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

  it('parseia "Blumenau - SC" e variantes', () => {
    expect(parseCitySearchQuery('Blumenau - SC')).toEqual({ cityPart: 'Blumenau', stateHint: 'SC' });
    expect(parseCitySearchQuery('blumenau - sc')).toEqual({ cityPart: 'blumenau', stateHint: 'SC' });
    expect(parseCitySearchQuery('São Paulo · SP')).toEqual({ cityPart: 'São Paulo', stateHint: 'SP' });
  });

  it('busca cidade sem acento e com UF abreviado', () => {
    const hits = searchIbgeCities(index, 'blumenau - sc', 5);
    expect(hits[0]?.city).toBe('Blumenau');
    expect(hits[0]?.state).toBe('SC');
  });

  it('busca parcial sem acento', () => {
    const hits = searchIbgeCities(index, 'sao paul', 5);
    expect(hits.some((h) => h.city === 'São Paulo' && h.state === 'SP')).toBe(true);
  });

  it('resolve label canônico a partir do texto digitado', () => {
    const r = resolveCitySearchLabel(index, 'blumenau-sc');
    expect(r?.label).toBe('Blumenau · SC');
  });
});
