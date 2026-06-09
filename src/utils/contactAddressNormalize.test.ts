import { describe, expect, it } from 'vitest';
import {
  normalizeContactAddressFields,
  parseEmbeddedCityState,
  resolveContactCityState,
  titleCasePlaceName
} from './contactAddressNormalize';

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
});
