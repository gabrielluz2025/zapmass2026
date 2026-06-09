import fs from 'fs';
import path from 'path';
import type { Contact } from '../src/types.js';
import { phoneDigitsToUf } from '../src/utils/brazilPhoneGeo.js';
import {
  normalizeContactNeighborhood,
  parseGeoFilterCity,
  resolveContactCityState as resolveNormalizedCityState
} from '../src/utils/contactAddressNormalize.js';
import { getIbgeMunicipiosIndex } from './ibgeMunicipios.js';
import {
  cityToApproxCoord,
  dddToApproxCoord,
  phoneToDdd,
  UF_NAMES,
  ufToCoord
} from './brazilGeoCentroids.js';
import {
  geocodeBrazilAddress,
  geocodeBrazilAddressDetailed,
  isGoogleGeocodeEnabled
} from './googleGeocode.js';
import { geocodeNominatim, isNominatimEnabled } from './nominatimGeocode.js';
import { getZapmassPool } from './db/postgres.js';
import { rowToContact, type ContactRow } from './repositories/contactMapper.js';
import { listContacts, updateContact } from './repositories/contactsRepository.js';

export type GeoLayer = 'neighborhood' | 'city' | 'ddd' | 'state';

export type GeoClusterPrecision = 'neighborhood' | 'city' | 'ddd' | 'state' | 'cep';

export type GeoCluster = {
  key: string;
  label: string;
  city: string;
  state: string;
  neighborhood: string;
  ddd: string;
  count: number;
  lat: number | null;
  lng: number | null;
  precision: GeoClusterPrecision;
  mapped: boolean;
  sampleNames: string[];
};

export type GeoContactPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  neighborhood: string;
  street: string;
  number: string;
  precision: 'address' | 'neighborhood' | 'city';
};

export type GeoContactPinStats = {
  withFullAddress: number;
  pinsMapped: number;
  pinsPending: number;
};

export type LeadsGeoFilters = {
  cities: string[];
  states: string[];
  ddds: string[];
  neighborhoods: string[];
};

export type LeadsGeoSummary = {
  stats: {
    totalContacts: number;
    withAnyAddress: number;
    withCity: number;
    withNeighborhood: number;
    withPhone: number;
    clusters: number;
    clustersMapped: number;
    clustersPending: number;
    filteredTotal: number;
  };
  layer: GeoLayer;
  clusters: GeoCluster[];
  byState: Record<string, number>;
  byDdd: Record<string, number>;
  byCity: Record<string, number>;
  byNeighborhood: Record<string, number>;
  filters: LeadsGeoFilters;
  topConcentration: { label: string; count: number; sharePct: number; key: string } | null;
  contactPins: GeoContactPin[];
  pinStats: GeoContactPinStats;
};

export type LeadsGeoQuery = {
  layer?: GeoLayer;
  state?: string;
  city?: string;
  ddd?: string;
  neighborhood?: string;
};

type GeoCacheFile = Record<string, { lat: number; lng: number; at: string }>;

const CACHE_PATH = path.join(process.cwd(), 'data', 'leads_geo_cache.json');

function readGeoCache(): GeoCacheFile {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const j = JSON.parse(raw) as GeoCacheFile;
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function writeGeoCache(cache: GeoCacheFile): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 0), 'utf8');
  } catch {
    /* cache opcional */
  }
}

function normState(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

function normCity(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normNeighborhood(raw: string, cityHint?: string): string {
  return normalizeContactNeighborhood(String(raw || ''), cityHint);
}

function normKeyPart(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function hasAnyAddressField(c: Contact): boolean {
  return Boolean(
    (c.street || '').trim() ||
      (c.city || '').trim() ||
      (c.state || '').trim() ||
      (c.zipCode || '').trim() ||
      (c.neighborhood || '').trim()
  );
}

function hasFullStreetAddress(c: Contact): boolean {
  return Boolean((c.street || '').trim() && (c.number || '').trim());
}

/** Espalha bairros ao redor do centro da cidade quando não há geocode (visualização). */
function neighborhoodSpreadCoord(
  cityLat: number,
  cityLng: number,
  neighborhood: string
): { lat: number; lng: number } {
  let h = 0;
  for (let i = 0; i < neighborhood.length; i++) h = (h * 31 + neighborhood.charCodeAt(i)) | 0;
  const angle = ((h % 360) * Math.PI) / 180;
  const dist = 0.006 + (Math.abs(h) % 80) / 10_000;
  const cosLat = Math.cos((cityLat * Math.PI) / 180);
  return {
    lat: cityLat + dist * Math.cos(angle),
    lng: cityLng + (dist * Math.sin(angle)) / (cosLat || 1)
  };
}

async function geocodeQueryAnyProvider(query: string): Promise<{ lat: number; lng: number } | null> {
  if (isGoogleGeocodeEnabled()) {
    const hit = await geocodeBrazilAddressDetailed(query);
    if (hit.ok) return { lat: hit.lat, lng: hit.lng };
  }
  if (isNominatimEnabled()) {
    const hit = await geocodeNominatim(query);
    if (hit.ok) return { lat: hit.lat, lng: hit.lng };
  }
  return null;
}

function buildContactGeocodeQueries(c: Contact): string[] {
  const { city, state: st } = resolveContactCityState(c);
  const nb = normNeighborhood(c.neighborhood || '');
  const street = String(c.street || '').trim();
  const number = String(c.number || '').trim();
  const zip = (c.zipCode || '').replace(/\D/g, '');
  const out: string[] = [];
  const push = (q: string | null | undefined) => {
    const s = String(q || '').trim();
    if (s.length >= 5 && !out.includes(s)) out.push(s);
  };

  if (street && number && nb && city) {
    push(`${street}, ${number}, ${nb}, ${city}, ${st}, Brasil`);
  }
  if (street && number && city) {
    push(`${street}, ${number}, ${city}, ${st}, Brasil`);
  }
  if (zip.length >= 8) push(`${zip.slice(0, 5)}-${zip.slice(5, 8)}, Brasil`);
  if (nb && city) push(`${nb}, ${city}, ${st}, Brasil`);
  if (city) push(`${city}, ${st}, Brasil`);
  return out;
}

function contactPinPrecision(c: Contact): GeoContactPin['precision'] {
  if (hasFullStreetAddress(c)) return 'address';
  if (normNeighborhood(c.neighborhood || '')) return 'neighborhood';
  return 'city';
}

function resolveContactState(c: Contact): string {
  const st = normState(c.state || '');
  if (st) return st;
  const uf = phoneDigitsToUf((c.phone || '').replace(/\D/g, ''));
  return uf || '';
}

function resolveContactCityState(c: Contact): { city: string; state: string } {
  return resolveNormalizedCityState(
    {
      city: c.city,
      state: c.state,
      phone: c.phone
    },
    getIbgeMunicipiosIndex()
  );
}

function resolveContactDdd(c: Contact): string {
  return phoneToDdd(c.phone || '') || '';
}

function buildGeocodeQuery(
  cluster: GeoCluster,
  sampleZip?: string
): string | null {
  const city = cluster.city !== '—' ? cluster.city : '';
  const state = cluster.state !== '—' ? cluster.state : '';
  const neighborhood = cluster.neighborhood !== '—' ? cluster.neighborhood : '';
  const zip = (sampleZip || '').replace(/\D/g, '');

  if (cluster.precision === 'cep' && zip.length >= 8) {
    return `${zip.slice(0, 5)}-${zip.slice(5, 8)}, Brasil`;
  }
  if (cluster.precision === 'neighborhood' && neighborhood && city) {
    return `${neighborhood}, ${city}, ${state}, Brasil`.replace(/,\s*,/g, ',').trim();
  }
  if (cluster.precision === 'city' && city) {
    return `${city}, ${state}, Brasil`.replace(/,\s*,/g, ',').trim();
  }
  if (cluster.precision === 'state' && state) {
    return `${state}, Brasil`;
  }
  return null;
}

function builtinCoordForCluster(cluster: GeoCluster): { lat: number; lng: number } | null {
  if (cluster.precision === 'ddd' && cluster.ddd) {
    return dddToApproxCoord(cluster.ddd);
  }
  if (cluster.precision === 'state' && cluster.state !== '—') {
    return ufToCoord(cluster.state);
  }
  if (cluster.precision === 'city' && cluster.city !== '—') {
    const st = cluster.state !== '—' ? cluster.state : '';
    return cityToApproxCoord(cluster.city, st);
  }
  if (cluster.precision === 'neighborhood' && cluster.city !== '—' && cluster.neighborhood !== '—') {
    const st = cluster.state !== '—' ? cluster.state : '';
    const cityCoord = cityToApproxCoord(cluster.city, st);
    if (!cityCoord) return null;
    return neighborhoodSpreadCoord(cityCoord.lat, cityCoord.lng, cluster.neighborhood);
  }
  return null;
}

function buildGeocodeQueries(cluster: GeoCluster, sampleZip?: string): string[] {
  const city = cluster.city !== '—' ? cluster.city : '';
  const state = cluster.state !== '—' ? cluster.state : '';
  const neighborhood = cluster.neighborhood !== '—' ? cluster.neighborhood : '';
  const zip = (sampleZip || '').replace(/\D/g, '');
  const ufName = state ? UF_NAMES[state] : '';
  const out: string[] = [];

  const push = (q: string | null | undefined) => {
    const s = String(q || '').replace(/,\s*,/g, ',').replace(/,\s*$/g, '').trim();
    if (s.length >= 3 && !out.includes(s)) out.push(s);
  };

  push(buildGeocodeQuery(cluster, sampleZip));
  if (cluster.precision === 'neighborhood' && neighborhood && city) {
    push(`${neighborhood}, ${city}, ${state}, Brasil`);
  }
  if (city && ufName) push(`${city}, ${ufName}, Brasil`);
  if (city && state) push(`${city}, ${state}, Brasil`);
  if (city) push(`${city}, Brasil`);
  if (cluster.precision === 'cep' && zip.length >= 8) {
    push(`${zip.slice(0, 5)}-${zip.slice(5, 8)}, Brasil`);
  }
  if (cluster.precision === 'state' && state) push(`${state}, Brasil`);

  return out;
}

function clusterKey(layer: GeoLayer, parts: Record<string, string>): string {
  if (layer === 'neighborhood') {
    return `nb:${parts.state}:${parts.city}:${parts.neighborhood}`.toLowerCase();
  }
  if (layer === 'city') {
    return `city:${parts.state}:${parts.city}`.toLowerCase();
  }
  if (layer === 'ddd') {
    return `ddd:${parts.ddd}`.toLowerCase();
  }
  return `state:${parts.state}`.toLowerCase();
}

function contactMatchesFilters(c: Contact, q: LeadsGeoQuery): boolean {
  const { city, state: st } = resolveContactCityState(c);
  const ddd = resolveContactDdd(c);
  const nb = normNeighborhood(c.neighborhood || '', city);

  if (q.state && normKeyPart(st) !== normKeyPart(q.state)) return false;
  if (q.city) {
    const fc = parseGeoFilterCity(q.city);
    if (normKeyPart(city) !== normKeyPart(fc.city)) return false;
    if (fc.state && st && normKeyPart(st) !== normKeyPart(fc.state)) return false;
  }
  if (q.ddd && ddd !== q.ddd.replace(/\D/g, '').slice(0, 2)) return false;
  if (q.neighborhood) {
    const filterNb = q.neighborhood.split('·')[0].trim();
    if (normKeyPart(nb) !== normKeyPart(filterNb)) return false;
  }
  return true;
}

async function loadTenantContacts(tenantId: string): Promise<Contact[]> {
  const pool = getZapmassPool();
  if (pool) {
    const r = await pool.query<ContactRow>(
      `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
       FROM zapmass.contacts WHERE tenant_id = $1::uuid`,
      [tenantId]
    );
    return r.rows.map(rowToContact);
  }
  return listContacts(tenantId, { limit: 50_000, offset: 0 });
}

export async function buildLeadsGeoSummary(
  tenantId: string,
  query: LeadsGeoQuery = {}
): Promise<LeadsGeoSummary> {
  const layer: GeoLayer =
    query.layer === 'neighborhood' || query.layer === 'city' || query.layer === 'ddd' || query.layer === 'state'
      ? query.layer
      : 'city';

  const contacts = await loadTenantContacts(tenantId);
  const cache = readGeoCache();
  const filtered = contacts.filter((c) => contactMatchesFilters(c, query));

  const clusterMap = new Map<string, GeoCluster>();
  const byState: Record<string, number> = {};
  const byDdd: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  const byNeighborhood: Record<string, number> = {};
  const filterSets = {
    cities: new Set<string>(),
    states: new Set<string>(),
    ddds: new Set<string>(),
    neighborhoods: new Set<string>()
  };

  let withAnyAddress = 0;
  let withCity = 0;
  let withNeighborhood = 0;
  let withPhone = 0;
  const contactPins: GeoContactPin[] = [];
  let filteredWithFullAddress = 0;
  let pinsMapped = 0;
  let pinsPending = 0;

  for (const c of contacts) {
    if (hasAnyAddressField(c)) withAnyAddress++;
    if (normCity(c.city || '')) withCity++;
    if (normNeighborhood(c.neighborhood || '')) withNeighborhood++;
    if ((c.phone || '').replace(/\D/g, '').length >= 10) withPhone++;

    const { city, state: st } = resolveContactCityState(c);
    const nb = normNeighborhood(c.neighborhood || '', city);
    const ddd = resolveContactDdd(c);

    if (st) {
      byState[st] = (byState[st] || 0) + 1;
      filterSets.states.add(st);
    }
    if (ddd) {
      byDdd[ddd] = (byDdd[ddd] || 0) + 1;
      filterSets.ddds.add(ddd);
    }
    if (city) {
      const cityKey = st ? `${city} · ${st}` : city;
      byCity[cityKey] = (byCity[cityKey] || 0) + 1;
      filterSets.cities.add(cityKey);
    }
    if (nb && city) {
      const nbKey = `${nb} · ${city}`;
      byNeighborhood[nbKey] = (byNeighborhood[nbKey] || 0) + 1;
      filterSets.neighborhoods.add(nbKey);
    }
  }

  for (const c of filtered) {
    const { city: rawCity, state: rawState } = resolveContactCityState(c);
    const st = rawState || '—';
    const city = rawCity || '—';
    const nb = normNeighborhood(c.neighborhood || '', rawCity) || '—';
    const ddd = resolveContactDdd(c) || '—';

    let key = '';
    let label = '';
    let precision: GeoClusterPrecision = 'city';

    if (layer === 'neighborhood') {
      if (nb === '—' || city === '—') continue;
      key = clusterKey(layer, { state: st, city, neighborhood: nb });
      label = st !== '—' ? `${nb} · ${city}` : nb;
      precision = 'neighborhood';
    } else if (layer === 'city') {
      if (city === '—') continue;
      key = clusterKey(layer, { state: st, city });
      label = st !== '—' ? `${city} · ${st}` : city;
      precision = 'city';
    } else if (layer === 'ddd') {
      if (ddd === '—') continue;
      key = clusterKey(layer, { ddd });
      label = `DDD ${ddd}${st !== '—' ? ` (${st})` : ''}`;
      precision = 'ddd';
    } else {
      if (st === '—') continue;
      key = clusterKey(layer, { state: st });
      label = st;
      precision = 'state';
    }

    let cluster = clusterMap.get(key);
    if (!cluster) {
      const cached = cache[key];
      const builtin = builtinCoordForCluster({
        key,
        label,
        city,
        state: st,
        neighborhood: nb,
        ddd,
        count: 0,
        lat: null,
        lng: null,
        precision,
        mapped: false,
        sampleNames: []
      });
      let lat: number | null = builtin?.lat ?? cached?.lat ?? null;
      let lng: number | null = builtin?.lng ?? cached?.lng ?? null;
      let mapped = lat != null && lng != null;

      if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
        lat = c.latitude!;
        lng = c.longitude!;
        mapped = true;
      }

      cluster = {
        key,
        label,
        city,
        state: st,
        neighborhood: nb,
        ddd,
        count: 0,
        lat,
        lng,
        precision,
        mapped,
        sampleNames: []
      };
      clusterMap.set(key, cluster);
    }

    cluster.count++;
    if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
      cluster.lat = c.latitude!;
      cluster.lng = c.longitude!;
      cluster.mapped = true;
    }
    if (cluster.sampleNames.length < 3 && (c.name || '').trim()) {
      cluster.sampleNames.push((c.name || '').trim());
    }

    if (hasFullStreetAddress(c)) filteredWithFullAddress++;

    const hasCoords = Number.isFinite(c.latitude) && Number.isFinite(c.longitude);
    const canPin = hasCoords || hasFullStreetAddress(c) || normNeighborhood(c.neighborhood || '');
    if (canPin) {
      if (hasCoords) {
        pinsMapped++;
        if (contactPins.length < 500) {
          const { city: pinCity, state: pinState } = resolveContactCityState(c);
          contactPins.push({
            id: c.id,
            name: (c.name || 'Sem nome').trim(),
            lat: c.latitude!,
            lng: c.longitude!,
            city: pinCity,
            state: pinState,
            neighborhood: normNeighborhood(c.neighborhood || ''),
            street: String(c.street || '').trim(),
            number: String(c.number || '').trim(),
            precision: contactPinPrecision(c)
          });
        }
      } else if (hasFullStreetAddress(c) || normNeighborhood(c.neighborhood || '')) {
        pinsPending++;
      }
    }
  }

  const clusters = [...clusterMap.values()].sort((a, b) => b.count - a.count);
  const clustersMapped = clusters.filter((c) => c.mapped && c.lat != null).length;
  const clustersPending = clusters.filter((c) => {
    if (c.precision === 'ddd' || c.precision === 'state') return false;
    return !cache[c.key];
  }).length;

  const filteredTotal = filtered.length;
  const top = clusters[0];
  const topConcentration = top
    ? {
        label: top.label,
        count: top.count,
        sharePct: filteredTotal > 0 ? Math.round((1000 * top.count) / filteredTotal) / 10 : 0,
        key: top.key
      }
    : null;

  return {
    stats: {
      totalContacts: contacts.length,
      withAnyAddress,
      withCity,
      withNeighborhood,
      withPhone,
      clusters: clusters.length,
      clustersMapped,
      clustersPending,
      filteredTotal
    },
    layer,
    clusters: clusters.slice(0, 800),
    byState,
    byDdd,
    byCity,
    byNeighborhood,
    filters: {
      cities: [...filterSets.cities].sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 200),
      states: [...filterSets.states].sort(),
      ddds: [...filterSets.ddds].sort(),
      neighborhoods: [...filterSets.neighborhoods].sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 200)
    },
    topConcentration,
    contactPins,
    pinStats: { withFullAddress: filteredWithFullAddress, pinsMapped, pinsPending }
  };
}

export async function geocodeLeadsGeoClusters(
  tenantId: string,
  opts?: { max?: number; layer?: GeoLayer; force?: boolean; city?: string; neighborhood?: string }
): Promise<{
  geocoded: number;
  failed: number;
  pending: number;
  googleStatus?: string;
  summary: LeadsGeoSummary;
}> {
  const max = Math.min(Math.max(opts?.max ?? 80, 1), 150);
  const layer = opts?.layer ?? 'city';

  if (layer === 'ddd' || layer === 'state') {
    const summary = await buildLeadsGeoSummary(tenantId, { layer });
    return { geocoded: 0, failed: 0, pending: 0, summary };
  }

  if (!isGoogleGeocodeEnabled() && !isNominatimEnabled()) {
    throw new Error('Geocodificação indisponível (Google ou OpenStreetMap).');
  }

  const summary = await buildLeadsGeoSummary(tenantId, {
    layer,
    city: opts?.city,
    neighborhood: opts?.neighborhood
  });
  const cache = readGeoCache();
  const uncached = summary.clusters.filter((c) => opts?.force || !cache[c.key]);
  const toProcess = uncached.slice(0, max);
  let geocoded = 0;
  let failed = 0;
  let lastGoogleStatus: string | undefined;

  for (const cluster of toProcess) {
    const queries = buildGeocodeQueries(cluster);
    if (queries.length === 0) {
      failed++;
      continue;
    }

    let saved = false;
    for (const query of queries) {
      const hit = await geocodeQueryAnyProvider(query);
      if (!hit) continue;
      cache[cluster.key] = { lat: hit.lat, lng: hit.lng, at: new Date().toISOString() };
      geocoded++;
      saved = true;
      break;
    }
    if (!saved) failed++;
  }

  if (geocoded > 0) writeGeoCache(cache);

  const refreshed = await buildLeadsGeoSummary(tenantId, {
    layer,
    city: opts?.city,
    neighborhood: opts?.neighborhood
  });
  const stillPending = refreshed.clusters.filter((c) => !cache[c.key]).length;
  return { geocoded, failed, pending: stillPending, googleStatus: lastGoogleStatus, summary: refreshed };
}

export async function geocodeContactsWithAddress(
  tenantId: string,
  opts?: { max?: number; city?: string; neighborhood?: string }
): Promise<{ geocoded: number; failed: number; summary: LeadsGeoSummary }> {
  const max = Math.min(Math.max(opts?.max ?? 40, 1), 80);
  if (!isGoogleGeocodeEnabled() && !isNominatimEnabled()) {
    throw new Error('Geocodificação indisponível (Google ou OpenStreetMap).');
  }

  const contacts = await loadTenantContacts(tenantId);
  const pending = contacts
    .filter((c) => {
      if (!(Number.isFinite(c.latitude) && Number.isFinite(c.longitude))) {
        if (!normCity(c.city || '') && !hasFullStreetAddress(c)) return false;
        if (!contactMatchesFilters(c, { city: opts?.city, neighborhood: opts?.neighborhood })) return false;
        return hasFullStreetAddress(c) || normNeighborhood(c.neighborhood || '') || normCity(c.city || '');
      }
      return false;
    })
    .sort((a, b) => {
      const aFull = hasFullStreetAddress(a) ? 1 : 0;
      const bFull = hasFullStreetAddress(b) ? 1 : 0;
      return bFull - aFull;
    })
    .slice(0, max);

  let geocoded = 0;
  let failed = 0;

  for (const c of pending) {
    const queries = buildContactGeocodeQueries(c);
    let hit: { lat: number; lng: number } | null = null;
    for (const q of queries) {
      hit = await geocodeQueryAnyProvider(q);
      if (hit) break;
    }
    if (!hit) {
      failed++;
      continue;
    }
    await updateContact(tenantId, c.id, {
      latitude: hit.lat,
      longitude: hit.lng,
      geocodedAt: new Date().toISOString()
    });
    geocoded++;
  }

  const summary = await buildLeadsGeoSummary(tenantId, {
    layer: opts?.neighborhood || opts?.city ? 'neighborhood' : 'city',
    city: opts?.city,
    neighborhood: opts?.neighborhood
  });
  return { geocoded, failed, summary };
}
