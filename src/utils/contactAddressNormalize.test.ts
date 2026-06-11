import { describe, expect, it } from 'vitest';
import {
  buildNeighborhoodToCityMap,
  normalizeContactAddressFields,
  normNeighborhoodKey,
  parseEmbeddedCityState,
  pickCanonicalNeighborhoodName,
  repairUtf8Mojibake,
  resolveContactCityState,
  canonicalizeClusterCity,
  resolveGeoPlaceForContact,
  titleCasePlaceName
} from './contactAddressNormalize';
import { buildIbgeCityIndex, fuzzyResolveCityWithIbge } from './ibgeCityLookup';

describe('contactAddressNormalize', () => {
  it('unifica BLUMENAU - SC em cidade + UF separados', () => {
    const r = normalizeContactAddressFields({ city: 'BLUMENAU - SC', phone: '47999999999' });
    expect(r.city).toBe('Blumenau');
    expect(r.state).toBe('SC');
  });

  it('corrige Blumenau - BA quando DDD é de SC', () => {
    const r = resolveContactCityState({ city: 'Blumenau - BA', phone: '47999999999' });
    expect(r.city).toBe('Blumenau');
    expect(r.state).toBe('SC');
  });

  it('força SC em Blumenau mesmo sem telefone e com UF errada no campo state', () => {
    const r = resolveContactCityState({ city: 'Blumenau', state: 'PR' });
    expect(r.state).toBe('SC');
  });

  it('força SC em Blumenau - PR no campo cidade', () => {
    expect(resolveContactCityState({ city: 'BLUMENAU - PR' }).state).toBe('SC');
  });

  it('title case em bairro e cidade', () => {
    expect(titleCasePlaceName('GASPAR')).toBe('Gaspar');
    expect(normalizeContactAddressFields({ neighborhood: 'CENTRO' }).neighborhood).toBe('Centro');
  });

  it('parse embedded city state', () => {
    expect(parseEmbeddedCityState('INDAIAL/SC')).toEqual({ city: 'INDAIAL', state: 'SC' });
  });

  it('remove caracteres de substituicao de encoding quebrado', () => {
    expect(repairUtf8Mojibake('Ant\uFFFDnio Carlos')).toBe('Antnio Carlos');
  });

  it('corrige typo Indalal via IBGE fuzzy', () => {
    const index = buildIbgeCityIndex([{ id: 1, nome: 'Indaial', uf: 'SC' }]);
    const hit = fuzzyResolveCityWithIbge(index, { city: 'Indalal', stateHint: 'SC' });
    expect(hit?.city).toBe('Indaial');
    expect(hit?.state).toBe('SC');
  });

  it('corrige typo Fortaaleza e unifica chave com Fortaleza', () => {
    expect(normalizeContactAddressFields({ neighborhood: 'Fortaaleza' }).neighborhood).toBe('Fortaleza');
    expect(normNeighborhoodKey('Fortaaleza')).toBe(normNeighborhoodKey('Fortaleza'));
    expect(pickCanonicalNeighborhoodName('Fortaleza', 'Fortaaleza')).toBe('Fortaleza');
  });

  it('bairro no campo cidade vira Blumenau + bairro Água Verde', () => {
    const r = resolveGeoPlaceForContact(
      { city: 'Água Verde', state: 'SC' },
      buildIbgeCityIndex([{ id: 1, nome: 'Blumenau', uf: 'SC' }])
    );
    expect(r.city).toBe('Blumenau');
    expect(r.neighborhood).toBe('Água Verde');
    expect(r.state).toBe('SC');
  });

  it('Água Verde sem UF/DDD cai em Blumenau (Vale do Itajaí)', () => {
    const r = resolveGeoPlaceForContact({ city: 'Água Verde' });
    expect(r.city).toBe('Blumenau');
    expect(r.neighborhood).toBe('Água Verde');
    expect(r.state).toBe('SC');
  });

  it('Água Verde com DDD 47 resolve para Blumenau', () => {
    const r = resolveGeoPlaceForContact({ city: 'Água Verde', phone: '47999887766' });
    expect(r.city).toBe('Blumenau');
    expect(r.state).toBe('SC');
  });

  it('Água Verde - Blumenau no campo cidade vira Blumenau', () => {
    const r = resolveGeoPlaceForContact({ city: 'Água Verde - Blumenau' });
    expect(r.city).toBe('Blumenau');
    expect(r.neighborhood).toBe('Água Verde');
    expect(r.state).toBe('SC');
  });

  it('Agua Verde, Blumenau (sem acento) vira Blumenau', () => {
    const r = resolveGeoPlaceForContact({ city: 'Agua Verde, Blumenau' });
    expect(r.city).toBe('Blumenau');
    expect(r.neighborhood).toBe('Agua Verde');
  });

  it('canonicalizeClusterCity não reintroduz Água Verde como município', () => {
    expect(canonicalizeClusterCity('Água Verde', 'SC')).toBe('Blumenau');
    expect(canonicalizeClusterCity('Água Verde - Blumenau')).toBe('Blumenau');
  });

  it('aprende bairro→cidade da própria base', () => {
    const index = buildIbgeCityIndex([{ id: 1, nome: 'Blumenau', uf: 'SC' }]);
    const map = buildNeighborhoodToCityMap(
      [
        { city: 'Blumenau', state: 'SC', neighborhood: 'Água Verde' },
        { city: 'Blumenau', state: 'SC', neighborhood: 'Água Verde' }
      ],
      index
    );
    const r = resolveGeoPlaceForContact({ city: 'Água Verde', state: 'SC' }, index, map);
    expect(r.city).toBe('Blumenau');
    expect(r.neighborhood).toBe('Água Verde');
  });
});
