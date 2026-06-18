import fs from 'fs';
import path from 'path';
import { titleCasePlaceName } from '../src/utils/contactAddressNormalize.js';
import { resolveCityWithIbge, type IbgeCityIndex } from '../src/utils/ibgeCityLookup.js';
import {
  getStaticOfficialNeighborhoods,
  normNbKey,
} from '../shared/officialNeighborhoods.js';
import {
  fetchOsmNeighborhoodsForCity,
  type OsmNeighborhoodRecord,
  OverpassApiError,
} from './osmOverpassNeighborhoods.js';

const CACHE_DIR = path.join(process.cwd(), 'data', 'osm_neighborhoods');
const FETCH_TIMEOUT_MS = 8_000;

/** TTL do cache em disco — 30 dias (OSM muda pouco). */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type MunicipalityNeighborhoodBundle = {
  city: string;
  state: string;
  ibgeId?: number;
  source: 'static' | 'overpass' | 'ibge' | 'cache';
  fetchedAt: string;
  names: string[];
  neighborhoods: OsmNeighborhoodRecord[];
  warnings: string[];
};

type CacheFile = {
  at: string;
  source: 'overpass' | 'ibge';
  city: string;
  state: string;
  ibgeId?: number;
  names: string[];
  neighborhoods: OsmNeighborhoodRecord[];
};

function cachePath(city: string, state: string, ibgeId?: number): string {
  const key = ibgeId ? String(ibgeId) : `${state.toUpperCase()}_${normNbKey(city)}`;
  return path.join(CACHE_DIR, `${key}.json`);
}

function readCache(city: string, state: string, ibgeId?: number): CacheFile | null {
  try {
    const raw = fs.readFileSync(cachePath(city, state, ibgeId), 'utf8');
    const j = JSON.parse(raw) as CacheFile;
    if (!j.at || !Array.isArray(j.names)) return null;
    if (Date.now() - new Date(j.at).getTime() > CACHE_TTL_MS) return null;
    return j;
  } catch {
    return null;
  }
}

function writeCache(payload: CacheFile): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      cachePath(payload.city, payload.state, payload.ibgeId),
      JSON.stringify(payload, null, 0),
      'utf8'
    );
  } catch {
    /* cache opcional */
  }
}

type IbgeNamedRow = { id?: number; nome?: string };

async function fetchIbgeNames(url: string): Promise<string[]> {
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) return [];
  const rows = (await r.json()) as IbgeNamedRow[];
  if (!Array.isArray(rows)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const nome = titleCasePlaceName(String(row.nome || '').trim());
    if (!nome || nome.length < 2) continue;
    const k = normNbKey(nome);
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(nome);
  }
  return names.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function fetchIbgeNeighborhoodNames(ibgeId: number): Promise<string[]> {
  const sub = await fetchIbgeNames(
    `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${ibgeId}/subdistritos`
  );
  if (sub.length >= 2) return sub;
  return fetchIbgeNames(
    `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${ibgeId}/distritos`
  );
}

function staticToBundle(city: string, state: string, names: string[]): MunicipalityNeighborhoodBundle {
  return {
    city,
    state: state.toUpperCase().slice(0, 2),
    source: 'static',
    fetchedAt: new Date().toISOString(),
    names,
    neighborhoods: names.map((name, idx) => ({
      osmId: -(idx + 1),
      osmType: 'node' as const,
      name,
      nameKey: normNbKey(name),
      centroid: { lat: 0, lng: 0 },
    })),
    warnings: [],
  };
}

function namesToMinimalRecords(names: string[]): OsmNeighborhoodRecord[] {
  return names.map((name, idx) => ({
    osmId: -(idx + 1),
    osmType: 'node' as const,
    name,
    nameKey: normNbKey(name),
    centroid: { lat: 0, lng: 0 },
  }));
}

/**
 * Resolve bairros com geometria (OSM Overpass → cache → IBGE fallback).
 * Ordem: lista estática curada → cache disco → Overpass API → IBGE.
 */
export async function resolveNeighborhoodBundle(
  city: string,
  state: string,
  ibgeIndex: IbgeCityIndex | null | undefined
): Promise<MunicipalityNeighborhoodBundle> {
  const cityNorm = titleCasePlaceName(city);
  const stateCode = String(state || '').toUpperCase().slice(0, 2);
  const warnings: string[] = [];

  const staticList = getStaticOfficialNeighborhoods(cityNorm, stateCode);
  if (staticList && staticList.length > 0) {
    return staticToBundle(cityNorm, stateCode, staticList);
  }

  const hit = resolveCityWithIbge(ibgeIndex, { city: cityNorm, stateHint: stateCode });
  const ibgeId = hit?.ibgeId;

  const cached = readCache(cityNorm, stateCode, ibgeId);
  if (cached && cached.names.length > 0) {
    return {
      city: cityNorm,
      state: stateCode,
      ibgeId,
      source: 'cache',
      fetchedAt: cached.at,
      names: cached.names,
      neighborhoods: cached.neighborhoods?.length ? cached.neighborhoods : namesToMinimalRecords(cached.names),
      warnings: [],
    };
  }

  try {
    const osm = await fetchOsmNeighborhoodsForCity(cityNorm, stateCode, { ibgeId });
    if (osm.names.length > 0) {
      const file: CacheFile = {
        at: osm.fetchedAt,
        source: 'overpass',
        city: cityNorm,
        state: stateCode,
        ibgeId,
        names: osm.names,
        neighborhoods: osm.neighborhoods,
      };
      writeCache(file);
      return {
        city: cityNorm,
        state: stateCode,
        ibgeId,
        source: 'overpass',
        fetchedAt: osm.fetchedAt,
        names: osm.names,
        neighborhoods: osm.neighborhoods,
        warnings: osm.warnings,
      };
    }
    warnings.push(...osm.warnings);
  } catch (e) {
    const msg = e instanceof OverpassApiError ? e.message : (e as Error)?.message || String(e);
    console.warn('[municipalityNeighborhoods] OSM Overpass failed', cityNorm, stateCode, msg);
    warnings.push(`Overpass indisponível: ${msg}`);
  }

  if (ibgeId) {
    try {
      const ibgeNames = await fetchIbgeNeighborhoodNames(ibgeId);
      if (ibgeNames.length > 0) {
        const at = new Date().toISOString();
        writeCache({
          at,
          source: 'ibge',
          city: cityNorm,
          state: stateCode,
          ibgeId,
          names: ibgeNames,
          neighborhoods: namesToMinimalRecords(ibgeNames),
        });
        return {
          city: cityNorm,
          state: stateCode,
          ibgeId,
          source: 'ibge',
          fetchedAt: at,
          names: ibgeNames,
          neighborhoods: namesToMinimalRecords(ibgeNames),
          warnings,
        };
      }
    } catch (e) {
      console.warn('[municipalityNeighborhoods] IBGE fetch failed', cityNorm, stateCode, e);
    }
  }

  return {
    city: cityNorm,
    state: stateCode,
    ibgeId,
    source: 'ibge',
    fetchedAt: new Date().toISOString(),
    names: [],
    neighborhoods: [],
    warnings,
  };
}

/** Compat — retorna só nomes ordenados. */
export async function resolveOfficialNeighborhoods(
  city: string,
  state: string,
  ibgeIndex: IbgeCityIndex | null | undefined
): Promise<string[]> {
  const bundle = await resolveNeighborhoodBundle(city, state, ibgeIndex);
  return bundle.names;
}

/** Força atualização via Overpass (ignora cache, útil em jobs/admin). */
export async function refreshOsmNeighborhoodsForCity(
  city: string,
  state: string,
  ibgeIndex: IbgeCityIndex | null | undefined
): Promise<MunicipalityNeighborhoodBundle> {
  const cityNorm = titleCasePlaceName(city);
  const stateCode = String(state || '').toUpperCase().slice(0, 2);
  const hit = resolveCityWithIbge(ibgeIndex, { city: cityNorm, stateHint: stateCode });
  const osm = await fetchOsmNeighborhoodsForCity(cityNorm, stateCode, { ibgeId: hit?.ibgeId });
  writeCache({
    at: osm.fetchedAt,
    source: 'overpass',
    city: cityNorm,
    state: stateCode,
    ibgeId: hit?.ibgeId,
    names: osm.names,
    neighborhoods: osm.neighborhoods,
  });
  return {
    city: cityNorm,
    state: stateCode,
    ibgeId: hit?.ibgeId,
    source: 'overpass',
    fetchedAt: osm.fetchedAt,
    names: osm.names,
    neighborhoods: osm.neighborhoods,
    warnings: osm.warnings,
  };
}
