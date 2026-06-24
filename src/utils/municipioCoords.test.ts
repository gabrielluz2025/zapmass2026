import { describe, expect, it } from 'vitest';
import { resolveMunicipioCoord } from './municipioCoords';

const SC_INDEX = {
  SC: {
    barravelha: [-26.637, -48.6933] as [number, number],
    blumenau: [-26.9194, -49.0661] as [number, number],
  },
};

describe('resolveMunicipioCoord', () => {
  it('corrige alias Barraco → Barra Velha em SC', () => {
    const hit = resolveMunicipioCoord('Barraco', 'SC', SC_INDEX);
    expect(hit).not.toBeNull();
    expect(hit!.lat).toBeCloseTo(-26.637, 2);
    expect(hit!.lng).toBeCloseTo(-48.6933, 2);
    expect(hit!.canonicalCity).toBe('Barra Velha');
  });

  it('resolve match exato IBGE', () => {
    const hit = resolveMunicipioCoord('Blumenau', 'SC', SC_INDEX);
    expect(hit?.lat).toBeCloseTo(-26.9194, 2);
  });
});
