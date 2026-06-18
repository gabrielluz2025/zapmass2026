#!/usr/bin/env npx tsx
/**
 * CLI — busca bairros no OpenStreetMap (Overpass) e grava cache local.
 *
 * Uso:
 *   npx tsx scripts/fetch-osm-neighborhoods.ts "Indaial" SC
 *   npx tsx scripts/fetch-osm-neighborhoods.ts "Blumenau" SC --refresh
 */
import { ensureIbgeMunicipiosIndex } from '../server/ibgeMunicipios.js';
import {
  refreshOsmNeighborhoodsForCity,
  resolveNeighborhoodBundle,
} from '../server/municipalityNeighborhoods.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--refresh');
  const refresh = process.argv.includes('--refresh');
  const city = args[0];
  const state = args[1];

  if (!city || !state) {
    console.error('Uso: npx tsx scripts/fetch-osm-neighborhoods.ts "<Cidade>" <UF> [--refresh]');
    process.exit(1);
  }

  const ibgeIndex = await ensureIbgeMunicipiosIndex().catch(() => null);
  const bundle = refresh
    ? await refreshOsmNeighborhoodsForCity(city, state, ibgeIndex)
    : await resolveNeighborhoodBundle(city, state, ibgeIndex);

  console.log(JSON.stringify(bundle, null, 2));
  console.error(
    `\n${bundle.names.length} bairros (${bundle.source}) — cache em data/osm_neighborhoods/`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
