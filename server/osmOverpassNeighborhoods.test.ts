import { describe, expect, it } from 'vitest';
import {
  buildOverpassNeighborhoodQuery,
  parseOverpassNeighborhoodElements,
} from './osmOverpassNeighborhoods.js';

describe('osmOverpassNeighborhoods', () => {
  it('monta query com cidade e UF para desambiguar homônimos', () => {
    const q = buildOverpassNeighborhoodQuery('Indaial', 'SC', 90, 4207502);
    expect(q).toContain('name"="Indaial"');
    expect(q).toContain('IBGE:GEOCODIGO"="4207502"');
    expect(q).toContain('is_in:state"="Santa Catarina"');
    expect(q).toContain('map_to_area->.cityareas');
    expect(q).toContain('place"~"^(suburb|neighbourhood');
    expect(q).toContain('admin_level"~"9|10"');
  });

  it('parseia elementos Overpass e deduplica por nome', () => {
    const rows = parseOverpassNeighborhoodElements([
      {
        type: 'node',
        id: 1,
        lat: -26.9,
        lon: -49.23,
        tags: { name: 'Centro', place: 'suburb' },
      },
      {
        type: 'way',
        id: 2,
        center: { lat: -26.91, lon: -49.24 },
        tags: { name: 'centro', place: 'suburb' },
      },
      {
        type: 'relation',
        id: 3,
        center: { lat: -26.92, lon: -49.25 },
        geometry: [
          { lat: -26.92, lon: -49.25 },
          { lat: -26.921, lon: -49.251 },
          { lat: -26.922, lon: -49.252 },
          { lat: -26.92, lon: -49.25 },
        ],
        tags: { name: 'Carijós', boundary: 'administrative', admin_level: '10' },
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(['Carijós', 'Centro']);
    expect(rows.find((r) => r.name === 'Carijós')?.polygon?.type).toBe('Polygon');
  });
});
