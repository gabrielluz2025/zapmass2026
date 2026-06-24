import { describe, expect, it } from 'vitest';
import {
  computeStateMunicipalityCoverage,
  formatMunicipalityCoverageLine,
} from './stateMunicipalityCoverage';
import type { NeighborhoodRow } from './types';

const SC_CATALOG = {
  blumenau: [-26.9194, -49.0661] as [number, number],
  gaspar: [-26.9318, -48.9589] as [number, number],
  barravelha: [-26.637, -48.6933] as [number, number],
  florianopolis: [-27.5954, -48.548] as [number, number],
};

function row(label: string, count: number): NeighborhoodRow {
  return {
    key: label,
    label,
    count,
    hot: 0,
    warm: 0,
    cold: 0,
    new: count,
    lat: null,
    lng: null,
    dominant: 'new',
  };
}

describe('computeStateMunicipalityCoverage', () => {
  it('conta municípios com e sem contatos no catálogo IBGE', () => {
    const coverage = computeStateMunicipalityCoverage(
      'SC',
      [row('Blumenau · SC', 100), row('Gaspar · SC', 5)],
      { SC: SC_CATALOG }
    );
    expect(coverage).toEqual({
      total: 4,
      withContacts: 2,
      withoutContacts: 2,
      unmappedContactCities: 0,
    });
  });

  it('agrupa alias Barraco em Barra Velha', () => {
    const coverage = computeStateMunicipalityCoverage(
      'SC',
      [row('Barraco · SC', 2)],
      { SC: SC_CATALOG }
    );
    expect(coverage?.withContacts).toBe(1);
    expect(coverage?.withoutContacts).toBe(3);
  });

  it('marca cidades fora do catálogo IBGE', () => {
    const coverage = computeStateMunicipalityCoverage(
      'SC',
      [row('Cidade Inventada · SC', 1)],
      { SC: SC_CATALOG }
    );
    expect(coverage?.unmappedContactCities).toBe(1);
    expect(coverage?.withContacts).toBe(0);
  });
});

describe('formatMunicipalityCoverageLine', () => {
  it('formata linha legível', () => {
    expect(
      formatMunicipalityCoverageLine({
        total: 295,
        withContacts: 47,
        withoutContacts: 248,
        unmappedContactCities: 0,
      })
    ).toBe('47 com contatos · 248 sem contatos · 295 municípios');
  });
});
