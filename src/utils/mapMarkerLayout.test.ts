import { describe, expect, it } from 'vitest';
import { spreadOverlappingMarkers } from './mapMarkerLayout';

describe('spreadOverlappingMarkers', () => {
  it('separa marcadores colados na mesma posição', () => {
    const input = [
      { lat: -27.5, lng: -49.0, key: 'a', count: 10 },
      { lat: -27.5, lng: -49.0, key: 'b', count: 5 },
    ];
    const out = spreadOverlappingMarkers(input);
    const dLat = Math.abs(out[0].lat - out[1].lat);
    const dLng = Math.abs(out[0].lng - out[1].lng);
    expect(dLat + dLng).toBeGreaterThan(0.01);
  });
});
