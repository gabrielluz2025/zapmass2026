import { describe, expect, it } from 'vitest';
import type { GeoCluster } from '../../../services/leadsGeoApi';
import { filterClustersForScope } from './buildNeighborhoodRows';
import { clusterMatchesFilterCity, clusterMatchesFilterState } from './territoryMapUtils';

const cluster = (partial: Partial<GeoCluster> & Pick<GeoCluster, 'label'>): GeoCluster => ({
  count: 1,
  lat: -27.59,
  lng: -48.55,
  precision: 'neighborhood',
  city: 'Florianópolis',
  state: 'SC',
  neighborhood: partial.label,
  ...partial,
});

describe('filterClustersForScope', () => {
  it('no drill estadual filtra clusters por UF e coordenada plausível', () => {
    const list = [
      cluster({ label: 'Centro · Florianópolis', city: 'Florianópolis', state: 'SC' }),
      cluster({ label: 'Centro · Curitiba', city: 'Curitiba', state: 'PR', lat: -25.43, lng: -49.27 }),
    ];
    const out = filterClustersForScope(list, 'Santa Catarina · SC', 'state', 'SC');
    expect(out).toHaveLength(1);
    expect(out[0].city).toBe('Florianópolis');
  });

  it('drill em cidade filtra clusters só da cidade', () => {
    const list = [
      cluster({ label: 'Centro', city: 'Florianópolis', state: 'SC' }),
      cluster({ label: 'Centro', city: 'Joinville', state: 'SC', lat: -26.3, lng: -48.85 }),
    ];
    const out = filterClustersForScope(list, 'Florianópolis · SC', 'city', 'SC');
    expect(out).toHaveLength(1);
    expect(out[0].city).toBe('Florianópolis');
  });
});

describe('clusterMatchesFilterCity', () => {
  it('rejeita bairro homônimo de outra cidade na mesma UF', () => {
    const c = cluster({ label: 'Centro', city: 'Joinville', state: 'SC' });
    expect(clusterMatchesFilterCity(c, 'Florianópolis · SC')).toBe(false);
  });
});

describe('clusterMatchesFilterState', () => {
  it('rejeita cluster de outra UF', () => {
    const c = cluster({ label: 'Centro', city: 'Curitiba', state: 'PR', lat: -25.43, lng: -49.27 });
    expect(clusterMatchesFilterState(c, 'SC')).toBe(false);
  });
});
