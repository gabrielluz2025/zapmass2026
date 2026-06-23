import { describe, expect, it } from 'vitest';
import { spreadCityInUf } from './ufCitySpread';

describe('spreadCityInUf', () => {
  it('espalha municípios em posições distintas (sem grade retangular)', () => {
    const cities = ['Indaial', 'Gaspar', 'Joinville', 'Blumenau', 'Florianópolis', 'Chapecó'];
    const coords = cities.map((c) => spreadCityInUf(c, 'SC')!);
    const lats = new Set(coords.map((c) => c.lat.toFixed(3)));
    const lngs = new Set(coords.map((c) => c.lng.toFixed(3)));
    expect(lats.size).toBeGreaterThan(3);
    expect(lngs.size).toBeGreaterThan(3);
  });

  it('mantém cidades de SC dentro de faixa plausível do estado', () => {
    const c = spreadCityInUf('Rio do Sul', 'SC')!;
    expect(c.lat).toBeLessThan(-25.5);
    expect(c.lat).toBeGreaterThan(-29.5);
    expect(c.lng).toBeLessThan(-47);
    expect(c.lng).toBeGreaterThan(-53.5);
  });
});
