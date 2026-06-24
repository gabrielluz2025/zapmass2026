import { describe, expect, it } from 'vitest';
import { lookupMunicipioCoord } from './municipioCoords';
import { spreadCityInUf } from './ufCitySpread';

const MOCK_COORDS = {
  SC: {
    blumenau: [-26.9194, -49.0661],
    joinville: [-26.3045, -48.8487],
    florianopolis: [-27.5954, -48.548],
    riodosul: [-27.214, -49.6431],
    barravelha: [-26.637, -48.6933],
  },
} as const;

describe('spreadCityInUf', () => {
  it('usa coordenadas IBGE quando o índice está disponível', () => {
    const c = spreadCityInUf('Blumenau', 'SC', MOCK_COORDS as never)!;
    expect(c.lat).toBeCloseTo(-26.9194, 3);
    expect(c.lng).toBeCloseTo(-49.0661, 3);
  });

  it('espalha municípios em posições distintas (sem grade retangular)', () => {
    const cities = ['Indaial', 'Gaspar', 'Joinville', 'Blumenau', 'Florianópolis', 'Chapecó'];
    const coords = cities.map((c) => spreadCityInUf(c, 'SC')!);
    const lats = new Set(coords.map((c) => c.lat.toFixed(3)));
    const lngs = new Set(coords.map((c) => c.lng.toFixed(3)));
    expect(lats.size).toBeGreaterThan(3);
    expect(lngs.size).toBeGreaterThan(3);
  });

  it('mantém cidades de SC dentro de faixa plausível do estado', () => {
    const c = spreadCityInUf('Rio do Sul', 'SC', MOCK_COORDS as never)!;
    expect(c.lat).toBeLessThan(-25.5);
    expect(c.lat).toBeGreaterThan(-29.5);
    expect(c.lng).toBeLessThan(-47);
    expect(c.lng).toBeGreaterThan(-53.5);
  });

  it('corrige Barraco para coordenadas de Barra Velha (não no mar)', () => {
    const c = spreadCityInUf('Barraco', 'SC', MOCK_COORDS as never)!;
    expect(c.lat).toBeCloseTo(-26.637, 2);
    expect(c.lng).toBeCloseTo(-48.6933, 2);
  });
});

describe('lookupMunicipioCoord', () => {
  it('resolve cidade normalizada com UF', () => {
    const hit = lookupMunicipioCoord('São José', 'SC', {
      SC: { saojose: [-27.614, -48.6366] },
    });
    expect(hit).toEqual({ lat: -27.614, lng: -48.6366 });
  });
});
