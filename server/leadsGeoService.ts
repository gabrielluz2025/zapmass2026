import fs from 'fs';
import path from 'path';
import type { Contact } from '../src/types.js';
import { phoneDigitsToUf } from '../src/utils/brazilPhoneGeo.js';
import {
  knownUfForCity,
  normalizeContactNeighborhood,
  normNeighborhoodKey,
  parseEmbeddedCityState,
  parseGeoFilterCity,
  pickCanonicalNeighborhoodName,
  repairUtf8Mojibake,
  resolveAddressCityState,
  titleCasePlaceName
} from '../src/utils/contactAddressNormalize.js';
import { fixBrazilCoord, isCoordPlausibleForCity, isInsideBrazilBounds } from './geoCoordValidate.js';
import { getIbgeMunicipiosIndex } from './ibgeMunicipios.js';
import { fuzzyResolveCityWithIbge } from '../src/utils/ibgeCityLookup.js';
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
import {
  geocodeNominatim,
  geocodeNominatimStructured,
  isNominatimEnabled
} from './nominatimGeocode.js';
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
  /** false = coordenada geocodificada; true = posição aproximada no bairro/cidade */
  approximate?: boolean;
};

export type GeoContactPinStats = {
  withFullAddress: number;
  pinsMapped: number;
  pinsApproximate: number;
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
  mapViewport: { lat: number; lng: number; zoom: number } | null;
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

function parseClusterKeyMeta(key: string): {
  city: string;
  state: string;
  neighborhood: string;
} {
  const parts = key.split(':');
  if (parts[0] === 'city' && parts.length >= 3) {
    const state = parts[1]!.toUpperCase();
    const city = parts
      .slice(2)
      .join(' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
    return { city, state, neighborhood: '' };
  }
  if (parts[0] === 'nb' && parts.length >= 3) {
    const city = titleCasePlaceName(parts[1] || '');
    const neighborhood = titleCasePlaceName(parts.slice(2).join('') || '');
    const state = knownUfForCity(city) || '';
    return { city, state, neighborhood };
  }
  return { city: '', state: '', neighborhood: '' };
}

function sanitizeGeoCache(cache: GeoCacheFile): GeoCacheFile {
  const clean: GeoCacheFile = {};
  let changed = false;
  for (const [key, v] of Object.entries(cache)) {
    const fixed = fixBrazilCoord(v.lat, v.lng);
    const meta = parseClusterKeyMeta(key);
    const ok =
      meta.city && meta.state
        ? isCoordPlausibleForCity(fixed.lat, fixed.lng, meta.city, meta.state, meta.neighborhood ? 40 : 55)
        : isInsideBrazilBounds(fixed.lat, fixed.lng);
    if (!ok) {
      changed = true;
      continue;
    }
    if (fixed.lat !== v.lat || fixed.lng !== v.lng) changed = true;
    clean[key] = { lat: fixed.lat, lng: fixed.lng, at: v.at };
  }
  if (changed) writeGeoCache(clean);
  return clean;
}

function readGeoCache(): GeoCacheFile {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const j = JSON.parse(raw) as GeoCacheFile;
    if (!j || typeof j !== 'object') return {};
    return sanitizeGeoCache(j);
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
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

function canonClusterCity(city: string, stateHint = ''): string {
  const parsed = parseEmbeddedCityState(repairUtf8Mojibake(city));
  const ibge = fuzzyResolveCityWithIbge(getIbgeMunicipiosIndex(), {
    city: parsed.city || city,
    stateHint: stateHint || parsed.state,
    phoneUf: undefined,
    parsedEmbeddedUf: parsed.state
  });
  if (ibge) return ibge.city;
  const knownUf = knownUfForCity(parsed.city || city);
  if (knownUf && parsed.city) return titleCasePlaceName(parsed.city);
  return titleCasePlaceName(parsed.city || city);
}

function resolveClusterState(cluster: GeoCluster): string {
  if (cluster.state !== '—') return cluster.state;
  const city = cluster.city !== '—' ? cluster.city : '';
  if (city) {
    const uf = knownUfForCity(city);
    if (uf) return uf;
  }
  if (cluster.ddd && cluster.ddd !== '—') {
    const uf = phoneDigitsToUf(cluster.ddd + '900000000');
    if (uf) return uf;
  }
  return '';
}

function geoCanonKey(cluster: GeoCluster, layer: GeoLayer): string {
  if (layer === 'neighborhood') {
    return clusterKey(layer, {
      city: cluster.city !== '—' ? cluster.city : '',
      neighborhood: cluster.neighborhood !== '—' ? cluster.neighborhood : ''
    });
  }
  if (layer === 'city') {
    return clusterKey(layer, { city: cluster.city !== '—' ? cluster.city : '' });
  }
  return cluster.key;
}

function mergeDuplicateClusters(items: GeoCluster[], layer: GeoLayer): GeoCluster[] {
  const merged = new Map<string, GeoCluster>();
  for (const c of items) {
    const mk = geoCanonKey(c, layer);
    const existing = merged.get(mk);
    if (!existing) {
      merged.set(mk, { ...c, key: mk });
      continue;
    }
    existing.count += c.count;
    if (layer === 'neighborhood' && c.neighborhood !== '—' && existing.neighborhood !== '—') {
      const canonNb = pickCanonicalNeighborhoodName(existing.neighborhood, c.neighborhood);
      existing.neighborhood = canonNb;
      existing.label = `${canonNb} · ${existing.city}`;
    }
    for (const name of c.sampleNames) {
      if (existing.sampleNames.length < 3 && !existing.sampleNames.includes(name)) {
        existing.sampleNames.push(name);
      }
    }
    if ((existing.lat == null || !existing.mapped) && c.lat != null) {
      existing.lat = c.lat;
      existing.lng = c.lng;
      existing.mapped = existing.mapped || c.mapped;
    }
    if (existing.state === '—' && c.state !== '—') existing.state = c.state;
  }
  return [...merged.values()].sort((a, b) => b.count - a.count);
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

/** Posição no mapa: geocode salvo ou espalhamento por bairro/cidade + id do contato. */
function resolveContactPinCoord(
  c: Contact,
  city: string,
  state: string,
  neighborhood: string
): { lat: number; lng: number; approximate: boolean } | null {
  const stored = storedContactCoords(c);
  if (stored) return { ...stored, approximate: false };

  const cityName = city !== '—' ? city : '';
  const st = state !== '—' ? state : resolveContactState(c) || knownUfForCity(cityName) || '';
  if (!cityName) return null;

  const cityCoord = cityToApproxCoord(cityName, st);
  if (!cityCoord) return null;

  const nb = neighborhood !== '—' ? neighborhood : '';
  const base = nb
    ? neighborhoodSpreadCoord(cityCoord.lat, cityCoord.lng, nb)
    : cityCoord;

  let h = 0;
  const seed = `${c.id}|${c.phone || ''}|${c.name || ''}`;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const angle = ((Math.abs(h) % 360) * Math.PI) / 180;
  const ring = Math.abs(h) % 14;
  const dist = 0.001 + ring * 0.00038 + (Math.abs(h) % 50) / 22_000;
  const cosLat = Math.cos((base.lat * Math.PI) / 180);
  const fixed = fixBrazilCoord(
    base.lat + dist * Math.cos(angle),
    base.lng + (dist * Math.sin(angle)) / (cosLat || 1)
  );

  if (!isCoordPlausibleForCity(fixed.lat, fixed.lng, cityName, st, nb ? 45 : 55)) return null;
  return { ...fixed, approximate: true };
}

function appendContactPin(
  pins: GeoContactPin[],
  maxPins: number,
  c: Contact,
  lat: number,
  lng: number,
  precision: GeoContactPin['precision'],
  approximate: boolean
): void {
  if (pins.length >= maxPins) return;
  const { city: pinCity, state: pinState } = resolveContactCityState(c);
  pins.push({
    id: c.id,
    name: (c.name || 'Sem nome').trim(),
    lat,
    lng,
    city: pinCity,
    state: pinState,
    neighborhood: normNeighborhood(c.neighborhood || '', pinCity),
    street: String(c.street || '').trim(),
    number: String(c.number || '').trim(),
    precision,
    approximate
  });
}

async function geocodeQueryAnyProvider(
  query: string,
  city?: string,
  state?: string
): Promise<{ lat: number; lng: number } | null> {
  const acceptHit = (lat: number, lng: number) => {
    const fixed = fixBrazilCoord(lat, lng);
    if (!city) return fixed;
    return isCoordPlausibleForCity(fixed.lat, fixed.lng, city, state || '') ? fixed : null;
  };
  if (isGoogleGeocodeEnabled()) {
    const hit = await geocodeBrazilAddressDetailed(query);
    if (hit.ok) return acceptHit(hit.lat, hit.lng);
  }
  if (isNominatimEnabled()) {
    const hit = await geocodeNominatim(query);
    if (hit.ok) return acceptHit(hit.lat, hit.lng);
  }
  return null;
}

async function geocodeContactAddress(c: Contact): Promise<{ lat: number; lng: number } | null> {
  const { city, state: st } = resolveContactCityState(c);
  const nb = normNeighborhood(c.neighborhood || '', city);
  const street = String(c.street || '').trim();
  const number = String(c.number || '').trim();
  const zip = (c.zipCode || '').replace(/\D/g, '');

  if (isNominatimEnabled() && city) {
    const structuredStreet = [street, number].filter(Boolean).join(' ');
    const structHit = await geocodeNominatimStructured({
      street: structuredStreet || undefined,
      city,
      state: st ? UF_NAMES[st] || st : undefined,
      country: 'Brasil',
      postalcode: zip.length >= 8 ? zip : undefined
    });
    if (structHit.ok) {
      const fixed = fixBrazilCoord(structHit.lat, structHit.lng);
      if (isCoordPlausibleForCity(fixed.lat, fixed.lng, city, st)) return fixed;
    }
  }

  for (const q of buildContactGeocodeQueries(c)) {
    const hit = await geocodeQueryAnyProvider(q, city, st);
    if (hit) return hit;
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
  const { state } = resolveAddressCityState(
    { city: c.city, state: c.state },
    getIbgeMunicipiosIndex()
  );
  if (state) return state;
  const st = normState(c.state || '');
  if (st) return st;
  return phoneDigitsToUf((c.phone || '').replace(/\D/g, '')) || '';
}

function resolveContactCityState(c: Contact): { city: string; state: string } {
  return resolveAddressCityState(
    { city: c.city, state: c.state },
    getIbgeMunicipiosIndex()
  );
}

function contactCoordsValid(c: Contact, lat: number, lng: number): boolean {
  const { city, state } = resolveContactCityState(c);
  return isCoordPlausibleForCity(lat, lng, city, state);
}

function storedContactCoords(c: Contact): { lat: number; lng: number } | null {
  if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return null;
  const fixed = fixBrazilCoord(c.latitude!, c.longitude!);
  if (!contactCoordsValid(c, fixed.lat, fixed.lng)) return null;
  return fixed;
}

function pickClusterCoords(
  cluster: GeoCluster,
  cache: GeoCacheFile
): { lat: number; lng: number; mapped: boolean } | null {
  const city = cluster.city !== '—' ? cluster.city : '';
  const state = resolveClusterState(cluster);

  const tryPair = (lat: number, lng: number): { lat: number; lng: number } | null => {
    const fixed = fixBrazilCoord(lat, lng);
    return isCoordPlausibleForCity(fixed.lat, fixed.lng, city, state) ? fixed : null;
  };

  const cached = cache[cluster.key];
  if (cached) {
    const ok = tryPair(cached.lat, cached.lng);
    if (ok) return { ...ok, mapped: true };
  }

  const builtin = builtinCoordForCluster(cluster);
  if (builtin) {
    const ok = tryPair(builtin.lat, builtin.lng);
    if (ok) return { ...ok, mapped: true };
  }

  return null;
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
    return cityToApproxCoord(cluster.city, resolveClusterState(cluster));
  }
  if (cluster.precision === 'neighborhood' && cluster.city !== '—' && cluster.neighborhood !== '—') {
    const cityCoord = cityToApproxCoord(cluster.city, resolveClusterState(cluster));
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
  const nk = (s: string) => normKeyPart(String(s || '').trim());
  if (layer === 'neighborhood') {
    return `nb:${nk(parts.city)}:${normNeighborhoodKey(parts.neighborhood || '')}`;
  }
  if (layer === 'city') {
    return `city:${nk(parts.city)}`;
  }
  if (layer === 'ddd') {
    return `ddd:${nk(parts.ddd)}`;
  }
  return `state:${nk(parts.state)}`;
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
    if (normNeighborhoodKey(nb) !== normNeighborhoodKey(filterNb)) return false;
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
  const nbCanonMap = new Map<string, { label: string; count: number }>();
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
  const maxContactPins = query.neighborhood ? 6000 : query.city ? 3500 : 1500;
  let filteredWithFullAddress = 0;
  let pinsMapped = 0;
  let pinsApproximate = 0;
  let pinsPending = 0;

  for (const c of contacts) {
    if (hasAnyAddressField(c)) withAnyAddress++;
    if (normCity(c.city || '')) withCity++;
    if (normNeighborhood(c.neighborhood || '')) withNeighborhood++;
    if ((c.phone || '').replace(/\D/g, '').length >= 10) withPhone++;

    const { city, state: st } = resolveContactCityState(c);
    const cityCanon = city ? canonClusterCity(city, st) : '';
    const nb = normNeighborhood(c.neighborhood || '', cityCanon || city);
    const ddd = resolveContactDdd(c);

    if (st) {
      byState[st] = (byState[st] || 0) + 1;
      filterSets.states.add(st);
    }
    if (ddd) {
      byDdd[ddd] = (byDdd[ddd] || 0) + 1;
      filterSets.ddds.add(ddd);
    }
    if (cityCanon) {
      const cityKey = st ? `${cityCanon} · ${st}` : cityCanon;
      byCity[cityKey] = (byCity[cityKey] || 0) + 1;
      filterSets.cities.add(cityKey);
    }
    if (nb && cityCanon) {
      const nbCanon = `${normNeighborhoodKey(nb)}|${normKeyPart(cityCanon)}`;
      const nbLabel = `${nb} · ${cityCanon}`;
      const prev = nbCanonMap.get(nbCanon);
      if (prev) prev.count++;
      else nbCanonMap.set(nbCanon, { label: nbLabel, count: 1 });
    }
  }

  for (const { label, count } of nbCanonMap.values()) {
    byNeighborhood[label] = count;
    filterSets.neighborhoods.add(label);
  }

  for (const c of filtered) {
    const { city: rawCity, state: rawState } = resolveContactCityState(c);
    const stResolved = resolveContactState(c) || rawState || knownUfForCity(rawCity) || '';
    const st = stResolved || '—';
    const cityCanon = rawCity ? canonClusterCity(rawCity, stResolved) : '';
    const city = cityCanon || '—';
    const nb = normNeighborhood(c.neighborhood || '', cityCanon || rawCity) || '—';
    const ddd = resolveContactDdd(c) || '—';

    let key = '';
    let label = '';
    let precision: GeoClusterPrecision = 'city';

    if (layer === 'neighborhood') {
      if (nb === '—' || city === '—') continue;
      key = clusterKey(layer, { city, neighborhood: nb });
      label = `${nb} · ${city}`;
      precision = 'neighborhood';
    } else if (layer === 'city') {
      if (city === '—') continue;
      key = clusterKey(layer, { city });
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
      const draft: GeoCluster = {
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
      };
      const picked = pickClusterCoords(draft, cache);
      cluster = {
        ...draft,
        lat: picked?.lat ?? null,
        lng: picked?.lng ?? null,
        mapped: picked?.mapped ?? false
      };
      clusterMap.set(key, cluster);
    }

    cluster.count++;

    if (precision === 'neighborhood') {
      const stored = storedContactCoords(c);
      if (stored && isCoordPlausibleForCity(stored.lat, stored.lng, city, st, 35)) {
        cluster.lat = stored.lat;
        cluster.lng = stored.lng;
        cluster.mapped = true;
      }
    }
    if (cluster.sampleNames.length < 3 && (c.name || '').trim()) {
      cluster.sampleNames.push((c.name || '').trim());
    }

    if (hasFullStreetAddress(c)) filteredWithFullAddress++;

    const nbForPin = normNeighborhood(c.neighborhood || '', city !== '—' ? city : '');
    const canPin = city !== '—' || Boolean(nbForPin) || hasFullStreetAddress(c);
    if (canPin) {
      const pinCoord = resolveContactPinCoord(c, city, st, nb || nbForPin || '—');
      if (pinCoord) {
        const precision = pinCoord.approximate
          ? nbForPin
            ? 'neighborhood'
            : 'city'
          : contactPinPrecision(c);
        if (pinCoord.approximate) pinsApproximate++;
        else pinsMapped++;
        appendContactPin(
          contactPins,
          maxContactPins,
          c,
          pinCoord.lat,
          pinCoord.lng,
          precision,
          pinCoord.approximate
        );
      } else {
        pinsPending++;
      }
    }
  }

  for (const cluster of clusterMap.values()) {
    if (cluster.lat != null && cluster.lng != null) continue;
    const picked = pickClusterCoords(cluster, cache);
    if (picked) {
      cluster.lat = picked.lat;
      cluster.lng = picked.lng;
      cluster.mapped = picked.mapped;
    }
    const inferred = resolveClusterState(cluster);
    if (cluster.state === '—' && inferred) cluster.state = inferred;
  }

  const clusters = mergeDuplicateClusters([...clusterMap.values()], layer);
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

  const mapViewport = computeMapViewport(clusters, topConcentration, layer);

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
    pinStats: { withFullAddress: filteredWithFullAddress, pinsMapped, pinsApproximate, pinsPending },
    mapViewport
  };
}

function computeMapViewport(
  clusters: GeoCluster[],
  top: LeadsGeoSummary['topConcentration'],
  layer: GeoLayer
): { lat: number; lng: number; zoom: number } | null {
  const mapped = clusters.filter((c) => c.lat != null && c.lng != null && c.mapped);
  if (mapped.length === 0) return null;

  if (top && top.sharePct >= 35) {
    const focus = mapped.find((c) => c.key === top.key);
    if (focus?.lat != null && focus.lng != null) {
      const zoom = layer === 'neighborhood' ? 12 : layer === 'city' ? 9 : layer === 'ddd' ? 7 : 5;
      return { lat: focus.lat, lng: focus.lng, zoom };
    }
  }

  let wSum = 0;
  let latSum = 0;
  let lngSum = 0;
  for (const c of mapped.slice(0, 120)) {
    const w = Math.max(1, c.count);
    latSum += c.lat! * w;
    lngSum += c.lng! * w;
    wSum += w;
  }
  if (wSum <= 0) return null;
  const zoom = layer === 'neighborhood' ? 10 : layer === 'city' ? 6 : layer === 'ddd' ? 5 : 4;
  return { lat: latSum / wSum, lng: lngSum / wSum, zoom };
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
      const hit = await geocodeQueryAnyProvider(
        query,
        cluster.city !== '—' ? cluster.city : '',
        cluster.state !== '—' ? cluster.state : ''
      );
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
      if (!contactMatchesFilters(c, { city: opts?.city, neighborhood: opts?.neighborhood })) return false;
      if (storedContactCoords(c)) return false;
      const hasBadCoords =
        Number.isFinite(c.latitude) &&
        Number.isFinite(c.longitude) &&
        !contactCoordsValid(c, c.latitude!, c.longitude!);
      if (hasBadCoords) return true;
      if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) return false;
      if (!normCity(c.city || '') && !hasFullStreetAddress(c)) return false;
      return hasFullStreetAddress(c) || normNeighborhood(c.neighborhood || '') || normCity(c.city || '');
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
    const hadBadCoords =
      Number.isFinite(c.latitude) &&
      Number.isFinite(c.longitude) &&
      !contactCoordsValid(c, c.latitude!, c.longitude!);

    const hit = await geocodeContactAddress(c);
    if (!hit) {
      if (hadBadCoords) {
        await updateContact(tenantId, c.id, {
          latitude: undefined,
          longitude: undefined,
          geocodedAt: undefined
        });
      }
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
