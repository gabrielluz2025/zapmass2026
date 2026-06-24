import { describe, expect, it } from 'vitest';
import { isCoordLikelyOnLand, isMapCoordValid } from './brazilMapCoords';

describe('isCoordLikelyOnLand', () => {
  it('rejeita ponto no mar ao leste do litoral de SC', () => {
    expect(isCoordLikelyOnLand(-26.91, -47.7)).toBe(false);
  });

  it('aceita Barra Velha na costa', () => {
    expect(isCoordLikelyOnLand(-26.637, -48.6933)).toBe(true);
  });
});

describe('isMapCoordValid', () => {
  it('rejeita coordenada no oceano mesmo dentro do bounding box BR', () => {
    expect(isMapCoordValid(-26.91, -47.7)).toBe(false);
  });
});
