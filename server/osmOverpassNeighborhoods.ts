/**
 * Bairros/subúrbios via Overpass API (OpenStreetMap).
 * Fonte mais completa que subdistritos IBGE para mapeamento urbano no Brasil.
 */
import { titleCasePlaceName } from '../src/utils/contactAddressNormalize.js';
import { normNbKey } from '../shared/officialNeighborhoods.js';

export const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Overpass exige User-Agent identificável (sem ele retorna HTTP 406). */
export const OVERPASS_USER_AGENT =
  process.env.OVERPASS_USER_AGENT || 'ZapMassAtlas/2.3 (+https://zapmass.com.br; territorial-geodata)';

/** Espelhos alternativos se o primário estiver sobrecarregado. */
export const OVERPASS_MIRROR_URLS = [
  DEFAULT_OVERPASS_URL,
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;

/** Timeout HTTP + Overpass [timeout:…] em segundos. */
export const OVERPASS_QUERY_TIMEOUT_SEC = 90;
export const OVERPASS_HTTP_TIMEOUT_MS = 95_000;
export const OVERPASS_MAX_RETRIES = 2;

const UF_NAMES: Record<string, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AM: 'Amazonas',
  AP: 'Amapá',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso',
  PA: 'Pará',
  PB: 'Paraíba',
  PE: 'Pernambuco',
  PI: 'Piauí',
  PR: 'Paraná',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RO: 'Rondônia',
  RR: 'Roraima',
  RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina',
  SE: 'Sergipe',
  SP: 'São Paulo',
  TO: 'Tocantins',
};

export type OsmNeighborhoodRecord = {
  osmId: number;
  osmType: 'node' | 'way' | 'relation';
  name: string;
  nameKey: string;
  place?: string;
  adminLevel?: string;
  centroid: { lat: number; lng: number };
  bbox?: [minLng: number, minLat: number, maxLng: number, maxLat: number];
  /** Polígono simplificado (anel externo) quando disponível. */
  polygon?: GeoJSON.Polygon | null;
};

export type FetchOsmNeighborhoodsResult = {
  city: string;
  state: string;
  stateFullName: string;
  source: 'overpass';
  fetchedAt: string;
  neighborhoods: OsmNeighborhoodRecord[];
  /** Nomes únicos ordenados (compatível com APIs legadas). */
  names: string[];
  warnings: string[];
};

export type FetchOsmNeighborhoodsOptions = {
  overpassUrl?: string;
  queryTimeoutSec?: number;
  httpTimeoutMs?: number;
  retries?: number;
  /** Código IBGE do município — desambigua homônimos e localiza a relação OSM. */
  ibgeId?: number;
};

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  geometry?: Array<{ lat: number; lon: number }>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
  remark?: string;
};

export class OverpassApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'OverpassApiError';
  }
}

function escapeOverpassString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeStateCode(state: string): string {
  return String(state || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

function normalizeCityName(city: string): string {
  return titleCasePlaceName(String(city || '').trim());
}

/** Monta query Overpass QL — relação do município (admin_level=8) + bairros dentro. */
export function buildOverpassNeighborhoodQuery(
  city: string,
  stateCode: string,
  timeoutSec = OVERPASS_QUERY_TIMEOUT_SEC,
  ibgeId?: number
): string {
  const cityName = escapeOverpassString(normalizeCityName(city));
  const uf = normalizeStateCode(stateCode);
  const ufName = escapeOverpassString(UF_NAMES[uf] || uf);
  const ibgeFilter =
    ibgeId && ibgeId > 0
      ? `relation["boundary"="administrative"]["admin_level"="8"]["IBGE:GEOCODIGO"="${ibgeId}"];`
      : '';

  return `[out:json][timeout:${timeoutSec}];
(
  ${ibgeFilter}
  relation["boundary"="administrative"]["admin_level"="8"]["name"="${cityName}"]["is_in:state_code"="${uf}"];
  relation["boundary"="administrative"]["admin_level"="8"]["name"="${cityName}"]["addr:state"="${uf}"];
  relation["boundary"="administrative"]["admin_level"="8"]["name"="${cityName}"]["is_in:state"="${ufName}"];
  relation["boundary"="administrative"]["admin_level"="8"]["name"="${cityName}"]["addr:state"="${ufName}"];
  relation["boundary"="administrative"]["admin_level"="8"]["name"="${cityName}"]["is_in:country"="Brasil"]["is_in:state"="${ufName}"];
  relation["boundary"="administrative"]["admin_level"="8"]["name"="${cityName}"]["IBGE:GEOCODIGO"];
);
map_to_area->.cityareas;
(
  node["place"~"^(suburb|neighbourhood|quarter|neighborhood)$"](area.cityareas);
  way["place"~"^(suburb|neighbourhood|quarter|neighborhood)$"](area.cityareas);
  relation["place"~"^(suburb|neighbourhood|quarter|neighborhood)$"](area.cityareas);
  relation["boundary"="administrative"]["admin_level"~"9|10"](area.cityareas);
  way["boundary"="administrative"]["admin_level"~"9|10"](area.cityareas);
);
out center tags geom;`;
}

function ringCentroid(ring: Array<{ lat: number; lon: number }>): { lat: number; lng: number } | null {
  if (!ring.length) return null;
  let lat = 0;
  let lng = 0;
  for (const p of ring) {
    lat += p.lat;
    lng += p.lon;
  }
  return { lat: lat / ring.length, lng: lng / ring.length };
}

function geometryToPolygon(geometry?: Array<{ lat: number; lon: number }>): GeoJSON.Polygon | null {
  if (!geometry || geometry.length < 3) return null;
  const ring = geometry.map((p) => [p.lon, p.lat] as [number, number]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function elementCentroid(el: OverpassElement): { lat: number; lng: number } | null {
  if (el.center && Number.isFinite(el.center.lat) && Number.isFinite(el.center.lon)) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
    return { lat: el.lat!, lng: el.lon! };
  }
  if (el.geometry?.length) {
    const c = ringCentroid(el.geometry);
    if (c) return c;
  }
  if (el.bounds) {
    return {
      lat: (el.bounds.minlat + el.bounds.maxlat) / 2,
      lng: (el.bounds.minlon + el.bounds.maxlon) / 2,
    };
  }
  return null;
}

function pickName(tags: Record<string, string> | undefined): string {
  if (!tags) return '';
  return String(
    tags.name || tags['name:pt'] || tags['name:pt-BR'] || tags.official_name || ''
  ).trim();
}

/** Converte resposta Overpass em registros normalizados (deduplica por nome). */
export function parseOverpassNeighborhoodElements(elements: OverpassElement[]): OsmNeighborhoodRecord[] {
  const byKey = new Map<string, OsmNeighborhoodRecord>();

  for (const el of elements || []) {
    const rawName = pickName(el.tags);
    if (!rawName || rawName.length < 2) continue;

    const name = titleCasePlaceName(rawName);
    const nameKey = normNbKey(name);
    if (!nameKey) continue;

    const centroid = elementCentroid(el);
    if (!centroid) continue;

    const polygon = geometryToPolygon(el.geometry);
    const bbox: OsmNeighborhoodRecord['bbox'] | undefined = el.bounds
      ? [el.bounds.minlon, el.bounds.minlat, el.bounds.maxlon, el.bounds.maxlat]
      : undefined;

    const record: OsmNeighborhoodRecord = {
      osmId: el.id,
      osmType: el.type,
      name,
      nameKey,
      place: el.tags?.place,
      adminLevel: el.tags?.admin_level,
      centroid,
      bbox,
      polygon,
    };

    const prev = byKey.get(nameKey);
    if (!prev) {
      byKey.set(nameKey, record);
      continue;
    }
    const prevScore = (prev.polygon ? 2 : 0) + (prev.osmType === 'relation' ? 1 : 0);
    const nextScore = (record.polygon ? 2 : 0) + (record.osmType === 'relation' ? 1 : 0);
    if (nextScore > prevScore) byKey.set(nameKey, record);
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function postOverpassQuery(
  query: string,
  opts: FetchOsmNeighborhoodsOptions = {}
): Promise<OverpassResponse> {
  const urls = opts.overpassUrl
    ? [opts.overpassUrl]
    : [...OVERPASS_MIRROR_URLS];
  const httpTimeout = opts.httpTimeoutMs ?? OVERPASS_HTTP_TIMEOUT_MS;
  const retries = opts.retries ?? OVERPASS_MAX_RETRIES;

  let lastErr: unknown;
  for (const url of urls) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
            'User-Agent': OVERPASS_USER_AGENT,
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(httpTimeout),
        });

        if (r.status === 429 || r.status === 504 || r.status === 502) {
          throw new OverpassApiError(`Overpass HTTP ${r.status}`, r.status, true);
        }
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new OverpassApiError(
            `Overpass HTTP ${r.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
            r.status,
            r.status >= 500
          );
        }

        const data = (await r.json()) as OverpassResponse;
        if (data.remark?.toLowerCase().includes('timeout')) {
          throw new OverpassApiError(`Overpass remark: ${data.remark}`, undefined, true);
        }
        return data;
      } catch (e) {
        lastErr = e;
        const retryable =
          e instanceof OverpassApiError
            ? e.retryable
            : e instanceof Error &&
              (e.name === 'TimeoutError' || e.message.includes('timeout') || e.message.includes('aborted'));
        if (!retryable || attempt >= retries) break;
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
  }

  if (lastErr instanceof OverpassApiError) throw lastErr;
  if (lastErr instanceof Error) throw new OverpassApiError(lastErr.message, undefined, true);
  throw new OverpassApiError('Falha desconhecida na Overpass API', undefined, false);
}

/**
 * Busca bairros (suburb/neighbourhood/admin_level 9–10) dentro do município.
 * Desambigua cidade+UF para evitar homônimos em estados diferentes.
 */
export async function fetchOsmNeighborhoodsForCity(
  city: string,
  state: string,
  opts: FetchOsmNeighborhoodsOptions = {}
): Promise<FetchOsmNeighborhoodsResult> {
  const cityNorm = normalizeCityName(city);
  const stateCode = normalizeStateCode(state);
  const stateFullName = UF_NAMES[stateCode] || stateCode;
  const warnings: string[] = [];

  if (!cityNorm || cityNorm.length < 2) {
    throw new OverpassApiError('Nome de cidade inválido.', undefined, false);
  }
  if (!stateCode || stateCode.length !== 2) {
    throw new OverpassApiError('UF inválida — informe a sigla de 2 letras (ex.: SC).', undefined, false);
  }

  const queryTimeout = opts.queryTimeoutSec ?? OVERPASS_QUERY_TIMEOUT_SEC;
  const query = buildOverpassNeighborhoodQuery(cityNorm, stateCode, queryTimeout, opts.ibgeId);

  const data = await postOverpassQuery(query, opts);
  const neighborhoods = parseOverpassNeighborhoodElements(data.elements || []);

  if (neighborhoods.length === 0) {
    warnings.push(
      'Nenhum bairro encontrado no OSM para este município — verifique grafia, UF ou tente novamente mais tarde.'
    );
  }

  return {
    city: cityNorm,
    state: stateCode,
    stateFullName,
    source: 'overpass',
    fetchedAt: new Date().toISOString(),
    neighborhoods,
    names: neighborhoods.map((n) => n.name),
    warnings,
  };
}
