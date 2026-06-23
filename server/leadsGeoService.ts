import fs from 'fs';
import path from 'path';
import type { Contact } from '../src/types.js';
import { phoneDigitsToUf } from '../src/utils/brazilPhoneGeo.js';
import {
  knownUfForCity,
  normalizeContactNeighborhood,
  normNeighborhoodKey,
  parseGeoFilterCity,
  pickCanonicalNeighborhoodName,
  repairUtf8Mojibake,
  buildNeighborhoodToCityMap,
  canonicalizeClusterCity,
  resolveAddressCityState,
  resolveGeoPlaceForContact,
  titleCasePlaceName
} from '../src/utils/contactAddressNormalize.js';
import {
  fixBrazilCoord,
  haversineKm,
  isCoordPlausibleForCity,
  isInsideBrazilBounds
} from './geoCoordValidate.js';
import { getIbgeMunicipiosIndex } from './ibgeMunicipios.js';
import { resolveNeighborhoodBundle } from './municipalityNeighborhoods.js';
import {
  matchCityOfficialNeighborhood,
  normNbKey,
  resolveContactNeighborhoodForCity,
} from '../shared/officialNeighborhoods.js';
import {
  BLUMENAU_OFFICIAL_NEIGHBORHOODS,
  blumenauSpreadCoord,
  isBlumenauCity,
  matchOfficialNeighborhood,
  normBlumenauNbKey
} from '../shared/blumenauNeighborhoods.js';
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
import { geocodeByCepBrasilApi } from './brasilApiCep.js';
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
  officialNeighborhoods?: string[];
  /** true quando o dado veio do cache expirado enquanto o recálculo ocorre em background */
  stale?: boolean;
};

export type LeadsGeoQuery = {
  layer?: GeoLayer;
  state?: string;
  city?: string;
  ddd?: string;
  neighborhood?: string;
  /** Busca parcial no nome do contato (mín. 2 caracteres). */
  name?: string;
  /** Sem pins individuais — só clusters/agregação (mapa leve). */
  light?: boolean;
};

type GeoCacheFile = Record<string, { lat: number; lng: number; at: string }>;

const CACHE_PATH = path.join(process.cwd(), 'data', 'leads_geo_cache.json');
const SUMMARY_CACHE_TTL_MS = 600_000;
const summaryCache = new Map<string, { expires: number; summary: LeadsGeoSummary }>();
/** Chaves cujo recálculo já está rodando em background (evita recálculos simultâneos). */
const summaryRecomputingFor = new Set<string>();

function summaryCacheKey(tenantId: string, query: LeadsGeoQuery): string {
  return `${tenantId}:${JSON.stringify({
    layer: query.layer ?? 'city',
    state: query.state ?? '',
    city: query.city ?? '',
    ddd: query.ddd ?? '',
    neighborhood: query.neighborhood ?? '',
    name: query.name ?? '',
    light: query.light ? 1 : 0
  })}`;
}

/** Cede o event loop para não bloquear Socket.IO/HTTP durante a agregação de bases grandes. */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function invalidateLeadsGeoSummaryCache(tenantId?: string): void {
  if (!tenantId) {
    summaryCache.clear();
    return;
  }
  const prefix = `${tenantId}:`;
  for (const k of summaryCache.keys()) {
    if (k.startsWith(prefix)) summaryCache.delete(k);
  }
}

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

function parseCoord(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'string' ? Number(String(v).trim().replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Normaliza campos legados (rua, numero, bairro…) antes de geocodificar ou montar pins. */
export function hydrateContactForGeo(c: Contact): Contact {
  const raw = c as Contact & Record<string, unknown>;
  const street = String(c.street || raw.rua || raw.logradouro || raw.endereco || '').trim();
  const number = String(c.number || raw.numero || raw.num || '').trim();
  const lat = parseCoord(c.latitude ?? raw.lat ?? raw.latitude);
  const lng = parseCoord(c.longitude ?? raw.lng ?? raw.lon ?? raw.longitude);
  return {
    ...c,
    street: street || c.street,
    number: number || c.number,
    city: (c.city || String(raw.cidade || '').trim()) || c.city,
    state: (c.state || String(raw.uf || raw.estado || '').trim()) || c.state,
    neighborhood: (c.neighborhood || String(raw.bairro || '').trim()) || c.neighborhood,
    zipCode: (c.zipCode || String(raw.cep || raw.zip || '').trim()) || c.zipCode,
    ...(lat !== undefined ? { latitude: lat } : {}),
    ...(lng !== undefined ? { longitude: lng } : {})
  };
}

function hasFullStreetAddress(c: Contact): boolean {
  const h = hydrateContactForGeo(c);
  return Boolean((h.street || '').trim() && (h.number || '').trim());
}

function hasTrustedStreetGeocode(c: Contact): boolean {
  const h = hydrateContactForGeo(c);
  return (
    hasFullStreetAddress(h) ||
    h.geocodePrecision === 'street' ||
    h.geocodePrecision === 'cep'
  );
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

/** Distribui pins aproximados em espiral (evita “bolão” quando há centenas no mesmo bairro). */
function spreadPinAroundBase(
  baseLat: number,
  baseLng: number,
  index: number,
  total: number
): { lat: number; lng: number } {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const angle = index * golden;
  const t = total > 1 ? (index + 0.5) / total : 0;
  const radiusKm = 0.05 + Math.sqrt(t) * (1.1 + Math.min(1.4, total / 450));
  const distDeg = radiusKm / 111;
  const cosLat = Math.cos((baseLat * Math.PI) / 180);
  return fixBrazilCoord(
    baseLat + distDeg * Math.cos(angle),
    baseLng + (distDeg * Math.sin(angle)) / (cosLat || 1)
  );
}

function neighborhoodPinBase(
  city: string,
  state: string,
  neighborhood: string,
  cache: GeoCacheFile
): { lat: number; lng: number } | null {
  const nbKey = clusterKey('neighborhood', { city, neighborhood });
  const cached = cache[nbKey];
  if (cached) {
    const fixed = fixBrazilCoord(cached.lat, cached.lng);
    if (isCoordPlausibleForCity(fixed.lat, fixed.lng, city, state, 45)) return fixed;
  }
  const cityCoord = cityToApproxCoord(city, state);
  if (!cityCoord) return null;
  return neighborhoodSpreadCoord(cityCoord.lat, cityCoord.lng, neighborhood);
}

/** Posição no mapa: geocode salvo ou espalhamento por bairro/cidade. */
function resolveContactPinCoord(
  c: Contact,
  city: string,
  state: string,
  neighborhood: string,
  pinIndex: number,
  pinTotal: number,
  cache: GeoCacheFile
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
    ? neighborhoodPinBase(cityName, st, nb, cache) || neighborhoodSpreadCoord(cityCoord.lat, cityCoord.lng, nb)
    : cityCoord;

  const fixed = nb
    ? spreadPinAroundBase(base.lat, base.lng, pinIndex, pinTotal)
    : spreadPinAroundBase(base.lat, base.lng, pinIndex, Math.max(pinTotal, 80));

  if (!isCoordPlausibleForCity(fixed.lat, fixed.lng, cityName, st, nb ? 50 : 55)) return null;
  return { ...fixed, approximate: true };
}

function appendContactPin(
  pins: GeoContactPin[],
  maxPins: number,
  c: Contact,
  lat: number,
  lng: number,
  precision: GeoContactPin['precision'],
  approximate: boolean,
  nbToCityMap?: ReadonlyMap<string, { city: string; state: string }>
): void {
  if (pins.length >= maxPins) return;
  const place = resolveContactGeoPlace(c, nbToCityMap);
  const pinCity = place.city;
  const pinState = place.state;
  pins.push({
    id: c.id,
    name: (c.name || 'Sem nome').trim(),
    lat,
    lng,
    city: pinCity,
    state: pinState,
    neighborhood: normNeighborhood(place.neighborhood || c.neighborhood || '', pinCity),
    street: String(c.street || '').trim(),
    number: String(c.number || '').trim(),
    precision,
    approximate
  });
}

export type ContactGeocodeHit = {
  lat: number;
  lng: number;
  precision: NonNullable<Contact['geocodePrecision']>;
};

function isLikelyCityCenterOnly(c: Contact, lat: number, lng: number): boolean {
  if (!hasFullStreetAddress(c)) return false;
  const { city, state } = resolveContactCityState(c);
  const ref = cityToApproxCoord(city, state);
  if (!ref) return false;
  return haversineKm(ref.lat, ref.lng, lat, lng) < 1.5;
}

function acceptGeocodeHit(
  c: Contact,
  lat: number,
  lng: number,
  precision: ContactGeocodeHit['precision'],
  opts?: { allowCityCenter?: boolean }
): ContactGeocodeHit | null {
  const fixed = fixBrazilCoord(lat, lng);
  const { city, state } = resolveContactCityState(c);
  if (!isCoordPlausibleForCity(fixed.lat, fixed.lng, city, state, precision === 'cep' ? 80 : 65)) {
    return null;
  }
  if (
    !opts?.allowCityCenter &&
    hasFullStreetAddress(c) &&
    (precision === 'city' || precision === 'neighborhood' || isLikelyCityCenterOnly(c, fixed.lat, fixed.lng))
  ) {
    return null;
  }
  return { lat: fixed.lat, lng: fixed.lng, precision };
}

async function geocodeClusterQuery(
  query: string,
  city?: string,
  state?: string
): Promise<{ lat: number; lng: number } | null> {
  const acceptHit = (lat: number, lng: number) => {
    const fixed = fixBrazilCoord(lat, lng);
    if (!city) return fixed;
    return isCoordPlausibleForCity(fixed.lat, fixed.lng, city, state || '') ? fixed : null;
  };
  if (isNominatimEnabled()) {
    const hit = await geocodeNominatim(query);
    if (hit.ok) return acceptHit(hit.lat, hit.lng);
  }
  if (isGoogleGeocodeEnabled()) {
    const hit = await geocodeBrazilAddressDetailed(query);
    if (hit.ok) return acceptHit(hit.lat, hit.lng);
  }
  return null;
}

async function geocodeQueryAnyProvider(
  c: Contact,
  query: string,
  precision: ContactGeocodeHit['precision']
): Promise<ContactGeocodeHit | null> {
  const accept = (lat: number, lng: number) => acceptGeocodeHit(c, lat, lng, precision);
  if (isNominatimEnabled()) {
    const hit = await geocodeNominatim(query);
    if (hit.ok) return accept(hit.lat, hit.lng);
  }
  if (isGoogleGeocodeEnabled()) {
    const hit = await geocodeBrazilAddressDetailed(query);
    if (hit.ok) return accept(hit.lat, hit.lng);
  }
  return null;
}

async function geocodeContactAddress(raw: Contact): Promise<ContactGeocodeHit | null> {
  const c = hydrateContactForGeo(raw);
  const { city, state: st } = resolveContactCityState(c);
  const nb = normNeighborhood(c.neighborhood || '', city);
  const street = String(c.street || '').trim();
  const number = String(c.number || '').trim();
  const zip = (c.zipCode || '').replace(/\D/g, '');

  if (zip.length === 8) {
    const cepHit = await geocodeByCepBrasilApi(zip);
    if (cepHit) {
      const accepted = acceptGeocodeHit(c, cepHit.lat, cepHit.lng, 'cep', { allowCityCenter: true });
      if (accepted) return accepted;
    }
  }

  for (const q of buildContactGeocodeQueries(c)) {
    const isCityQuery = !street || !number;
    const hit = await geocodeQueryAnyProvider(
      c,
      q,
      isCityQuery ? (nb && city ? 'neighborhood' : 'city') : 'street'
    );
    if (hit) return hit;
  }

  if (isNominatimEnabled() && city) {
    for (const streetVariant of streetGeocodeVariants(street)) {
      const structuredStreet = [streetVariant, number].filter(Boolean).join(' ');
      const structHit = await geocodeNominatimStructured({
        street: structuredStreet || undefined,
        city,
        state: st ? UF_NAMES[st] || st : undefined,
        country: 'Brasil',
        postalcode: zip.length >= 8 ? zip : undefined
      });
      if (structHit.ok) {
        const accepted = acceptGeocodeHit(c, structHit.lat, structHit.lng, 'street');
        if (accepted) return accepted;
      }
    }
  }

  if (zip.length === 8) {
    const cepHit = await geocodeByCepBrasilApi(zip);
    if (cepHit) {
      return acceptGeocodeHit(c, cepHit.lat, cepHit.lng, 'cep', { allowCityCenter: true });
    }
  }

  return null;
}

function streetGeocodeVariants(street: string): string[] {
  const base = repairUtf8Mojibake(String(street || '').trim());
  if (!base) return [];
  const out = [base];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(base.replace(/\bEca\b/gi, 'Eça'));
  push(base.replace(/\bEca\b/gi, 'Eca'));
  return out;
}

function buildContactGeocodeQueries(raw: Contact): string[] {
  const c = hydrateContactForGeo(raw);
  const { city, state: st } = resolveContactCityState(c);
  const nb = normNeighborhood(c.neighborhood || '', city);
  const streetRaw = String(c.street || '').trim();
  const number = String(c.number || '').trim();
  const zip = (c.zipCode || '').replace(/\D/g, '');
  const hasStreet = Boolean(streetRaw && number);
  const out: string[] = [];
  const push = (q: string | null | undefined) => {
    const s = String(q || '').trim();
    if (s.length >= 5 && !out.includes(s)) out.push(s);
  };

  const streetVariants = new Set<string>();
  for (const street of streetGeocodeVariants(streetRaw)) {
    if (!street) continue;
    streetVariants.add(street);
    const low = street.toLowerCase();
    if (!low.startsWith('rua ') && !low.startsWith('av ') && !low.startsWith('avenida ')) {
      streetVariants.add(`Rua ${street}`);
    }
  }
  for (const street of streetVariants) {
    if (street && number && nb && city) {
      push(`${street}, ${number}, ${nb}, ${city}, ${st}, Brasil`);
    }
    if (street && number && city) {
      push(`${street}, ${number}, ${city}, ${st}, Brasil`);
    }
    if (street && number && nb && city) {
      push(`${street} ${number}, ${nb}, ${city}, ${st}, Brasil`);
    }
  }
  if (zip.length >= 8) push(`${zip.slice(0, 5)}-${zip.slice(5, 8)}, Brasil`);
  if (nb && city && !hasStreet) push(`${nb}, ${city}, ${st}, Brasil`);
  if (city && !hasStreet) push(`${city}, ${st}, Brasil`);
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

function resolveContactGeoPlace(
  c: Contact,
  nbToCityMap?: ReadonlyMap<string, { city: string; state: string }>
): {
  city: string;
  state: string;
  neighborhood: string;
} {
  const h = hydrateContactForGeo(c);
  return resolveGeoPlaceForContact(
    {
      city: h.city,
      state: h.state,
      neighborhood: h.neighborhood,
      zipCode: h.zipCode,
      phone: h.phone
    },
    getIbgeMunicipiosIndex(),
    nbToCityMap
  );
}

export function resolveContactCityState(
  c: Contact,
  nbToCityMap?: ReadonlyMap<string, { city: string; state: string }>
): { city: string; state: string } {
  const place = resolveContactGeoPlace(c, nbToCityMap);
  return { city: place.city, state: place.state };
}

function contactCoordsValid(c: Contact, lat: number, lng: number, maxKm = 55): boolean {
  const { city, state } = resolveContactCityState(hydrateContactForGeo(c));
  return isCoordPlausibleForCity(lat, lng, city, state, maxKm);
}

export function storedContactCoords(c: Contact): { lat: number; lng: number } | null {
  const h = hydrateContactForGeo(c);
  if (!Number.isFinite(h.latitude) || !Number.isFinite(h.longitude)) return null;
  const fixed = fixBrazilCoord(h.latitude!, h.longitude!);
  if (!isInsideBrazilBounds(fixed.lat, fixed.lng)) return null;
  if (hasTrustedStreetGeocode(h)) return fixed;
  if (contactCoordsValid(h, fixed.lat, fixed.lng)) return fixed;
  return null;
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

function normContactNameSearch(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

function contactNameMatches(c: Contact, rawName?: string): boolean {
  const needle = normContactNameSearch(rawName || '');
  if (!needle || needle.length < 2) return true;
  const name = normContactNameSearch(c.name || '');
  return name.includes(needle);
}

function contactMatchesFilters(c: Contact, q: LeadsGeoQuery): boolean {
  const contact = hydrateContactForGeo(c);
  if (!contactNameMatches(contact, q.name)) return false;

  const { city, state: st } = resolveContactCityState(contact);
  const ddd = resolveContactDdd(contact);
  const nb = normNeighborhood(contact.neighborhood || '', city);

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

function contactCoordsNeedRefresh(c: Contact): boolean {
  const h = hydrateContactForGeo(c);
  if (!hasFullStreetAddress(h)) return false;
  const stored = storedContactCoords(h);
  if (!stored) return true;
  if (isLikelyCityCenterOnly(h, stored.lat, stored.lng)) return true;
  const prec = h.geocodePrecision;
  return prec === 'city' || prec === 'neighborhood';
}

async function ensureContactsGeocodedForNameSearch(
  tenantId: string,
  filtered: Contact[],
  max = 12
): Promise<Contact[]> {
  if (!isGoogleGeocodeEnabled() && !isNominatimEnabled()) {
    return filtered.map(hydrateContactForGeo);
  }

  const out: Contact[] = [];
  let geocoded = 0;
  for (const raw of filtered) {
    let c = hydrateContactForGeo(raw);
    if (!hasFullStreetAddress(c)) {
      out.push(c);
      continue;
    }
    if (geocoded >= max) {
      out.push(c);
      continue;
    }
    const alreadyExact =
      storedContactCoords(c) &&
      c.geocodePrecision === 'street' &&
      !isLikelyCityCenterOnly(c, c.latitude!, c.longitude!);
    if (alreadyExact) {
      out.push(c);
      continue;
    }
    try {
      const hit = await geocodeContactAddress(c);
      if (hit) {
        geocoded++;
        const updated = await updateContact(tenantId, c.id, {
          latitude: hit.lat,
          longitude: hit.lng,
          geocodedAt: new Date().toISOString(),
          geocodePrecision: hit.precision
        });
        c = hydrateContactForGeo(
          updated || {
            ...c,
            latitude: hit.lat,
            longitude: hit.lng,
            geocodedAt: new Date().toISOString(),
            geocodePrecision: hit.precision
          }
        );
      }
    } catch (e) {
      console.warn('[leads-geo/name-search-geocode]', c.id, e);
    }
    out.push(c);
  }
  return out;
}

function alignClustersToExactPins(clusters: GeoCluster[], pins: GeoContactPin[]): GeoCluster[] {
  const acc = new Map<string, { lat: number; lng: number; n: number }>();
  for (const pin of pins) {
    if (pin.approximate) continue;
    const key = clusterKey('neighborhood', {
      city: pin.city,
      neighborhood: pin.neighborhood
    });
    const prev = acc.get(key);
    if (prev) {
      prev.lat += pin.lat;
      prev.lng += pin.lng;
      prev.n += 1;
    } else {
      acc.set(key, { lat: pin.lat, lng: pin.lng, n: 1 });
    }
  }
  if (acc.size === 0) return clusters;
  return clusters.map((cluster) => {
    const hit = acc.get(cluster.key);
    if (!hit || hit.n <= 0) return cluster;
    return {
      ...cluster,
      lat: hit.lat / hit.n,
      lng: hit.lng / hit.n,
      mapped: true
    };
  });
}

/** Só campos usados no mapa — evita carregar doc inteiro (tags, histórico, etc.) em bases grandes. */
export async function loadTenantContacts(tenantId: string): Promise<Contact[]> {
  const pool = getZapmassPool();
  if (pool) {
    const r = await pool.query<ContactRow>(
      `SELECT id::text, tenant_id::text, name, phone, sort_name,
        jsonb_build_object(
          'city', COALESCE(NULLIF(doc->>'city', ''), NULLIF(doc->>'cidade', ''), ''),
          'state', COALESCE(NULLIF(doc->>'state', ''), NULLIF(doc->>'uf', ''), NULLIF(doc->>'estado', ''), ''),
          'neighborhood', COALESCE(NULLIF(doc->>'neighborhood', ''), NULLIF(doc->>'bairro', ''), ''),
          'street', COALESCE(NULLIF(doc->>'street', ''), NULLIF(doc->>'rua', ''), NULLIF(doc->>'logradouro', ''), ''),
          'number', COALESCE(NULLIF(doc->>'number', ''), NULLIF(doc->>'numero', ''), ''),
          'zipCode', COALESCE(NULLIF(doc->>'zipCode', ''), NULLIF(doc->>'cep', ''), ''),
          'latitude', doc->'latitude',
          'longitude', doc->'longitude',
          'geocodePrecision', doc->>'geocodePrecision',
          'geocodedAt', doc->>'geocodedAt'
        ) AS doc,
        created_at, updated_at
       FROM zapmass.contacts WHERE tenant_id = $1::uuid`,
      [tenantId]
    );
    return r.rows.map((row) => hydrateContactForGeo(rowToContact(row)));
  }
  const list = await listContacts(tenantId, { limit: 50_000, offset: 0 });
  return list.map(hydrateContactForGeo);
}

export async function buildLeadsGeoSummary(
  tenantId: string,
  query: LeadsGeoQuery = {}
): Promise<LeadsGeoSummary> {
  const cacheKey = summaryCacheKey(tenantId, query);
  const cached = summaryCache.get(cacheKey);

  // Cache válido: retorna imediatamente
  if (cached && cached.expires > Date.now()) {
    return cached.summary;
  }

  // Cache expirado mas existe: retorna dado antigo imediatamente (stale) + recalcula em background
  if (cached && !summaryRecomputingFor.has(cacheKey)) {
    summaryRecomputingFor.add(cacheKey);
    void buildLeadsGeoSummaryInner(tenantId, query)
      .then((fresh) => {
        summaryCache.set(cacheKey, { expires: Date.now() + SUMMARY_CACHE_TTL_MS, summary: fresh });
        summaryRecomputingFor.delete(cacheKey);
      })
      .catch(() => summaryRecomputingFor.delete(cacheKey));
    return { ...cached.summary, stale: true };
  }

  // Sem cache (primeira carga): calcula normalmente
  const summary = await buildLeadsGeoSummaryInner(tenantId, query);
  summaryCache.set(cacheKey, { expires: Date.now() + SUMMARY_CACHE_TTL_MS, summary });
  summaryRecomputingFor.delete(cacheKey);
  return summary;
}

/** Pré-aquece o cache para os tenants ativos nos últimos 30 dias. Chamado no startup. */
export async function warmupLeadsGeoCache(): Promise<void> {
  try {
    const pool = getZapmassPool();
    if (!pool) return;
    const r = await pool.query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id::text FROM zapmass.contacts
       WHERE updated_at > NOW() - INTERVAL '30 days'
       LIMIT 20`
    );
    for (const row of r.rows) {
      try {
        // Modo light + Blumenau: aquece o cache do painel sem varrer geocode de toda a base.
        await buildLeadsGeoSummary(row.tenant_id, {
          layer: 'neighborhood',
          city: 'Blumenau · SC',
          light: true
        });
        console.log(`[geo-warmup] tenant ${row.tenant_id} pré-aquecido`);
      } catch (e) {
        console.warn('[geo-warmup] falha para tenant', row.tenant_id, e);
      }
    }
  } catch (e) {
    console.warn('[geo-warmup] erro geral:', e);
  }
}

/** Resposta rápida para mapa territorial de Blumenau (35 bairros, modo light). */
function buildBlumenauLightNeighborhoodSummary(
  contacts: Contact[],
  query: LeadsGeoQuery
): LeadsGeoSummary {
  const cache = readGeoCache();
  const selectedNb = query.neighborhood?.split('·')[0]?.trim() || '';
  const selectedNbKey = selectedNb ? normBlumenauNbKey(selectedNb) : '';

  const byKey = new Map<string, GeoCluster>();
  BLUMENAU_OFFICIAL_NEIGHBORHOODS.forEach((name, idx) => {
    const spread = blumenauSpreadCoord(idx);
    byKey.set(normBlumenauNbKey(name), {
      key: clusterKey('neighborhood', { city: 'Blumenau', neighborhood: name }),
      label: name,
      city: 'Blumenau',
      state: 'SC',
      neighborhood: name,
      ddd: '47',
      count: 0,
      lat: spread.lat,
      lng: spread.lng,
      precision: 'neighborhood',
      mapped: false,
      sampleNames: []
    });
  });
  const semKey = normBlumenauNbKey('Sem bairro');
  byKey.set(semKey, {
    key: clusterKey('neighborhood', { city: 'Blumenau', neighborhood: 'Sem bairro' }),
    label: 'Sem bairro',
    city: 'Blumenau',
    state: 'SC',
    neighborhood: 'Sem bairro',
    ddd: '47',
    count: 0,
    lat: blumenauSpreadCoord(0).lat,
    lng: blumenauSpreadCoord(0).lng,
    precision: 'neighborhood',
    mapped: false,
    sampleNames: []
  });

  let filteredTotal = 0;
  let withNeighborhood = 0;
  const byNeighborhood: Record<string, number> = {};

  for (const raw of contacts) {
    const c = hydrateContactForGeo(raw);
    const cityRaw = `${c.city || ''} ${c.state || ''}`.trim();
    if (!isBlumenauCity(cityRaw) && !isBlumenauCity(c.city || '')) continue;

    const official = matchOfficialNeighborhood(c.neighborhood || '');
    const nbName = official || 'Sem bairro';
    if (selectedNbKey && normBlumenauNbKey(nbName) !== selectedNbKey) continue;

    filteredTotal++;
    if (official) withNeighborhood++;
    const slot = byKey.get(normBlumenauNbKey(nbName));
    if (!slot) continue;
    slot.count++;
    byNeighborhood[nbName] = (byNeighborhood[nbName] || 0) + 1;
    if (slot.sampleNames.length < 5 && c.name) {
      slot.sampleNames.push(String(c.name).slice(0, 40));
    }
  }

  let clusters = [...byKey.values()].sort((a, b) => b.count - a.count);
  clusters = consolidateBlumenauOfficialNeighborhoods(clusters, byNeighborhood, cache);

  const top = clusters.find((c) => c.count > 0) || clusters[0];
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
      withAnyAddress: filteredTotal,
      withCity: filteredTotal,
      withNeighborhood,
      withPhone: contacts.filter((c) => (c.phone || '').replace(/\D/g, '').length >= 10).length,
      clusters: clusters.length,
      clustersMapped: clusters.filter((c) => c.mapped && c.lat != null).length,
      clustersPending: clusters.filter((c) => !cache[c.key]).length,
      filteredTotal
    },
    layer: 'neighborhood',
    clusters,
    byState: { SC: filteredTotal },
    byDdd: { '47': filteredTotal },
    byCity: { 'Blumenau · SC': filteredTotal },
    byNeighborhood,
    filters: {
      cities: ['Blumenau · SC'],
      states: ['SC'],
      ddds: ['47'],
      neighborhoods: [...BLUMENAU_OFFICIAL_NEIGHBORHOODS]
    },
    topConcentration,
    contactPins: [],
    pinStats: { withFullAddress: 0, pinsMapped: 0, pinsApproximate: 0, pinsPending: 0 },
    mapViewport: { lat: -26.9194, lng: -49.0661, zoom: 12 },
    officialNeighborhoods: [...BLUMENAU_OFFICIAL_NEIGHBORHOODS],
  };
}

function nbSpreadAroundCity(
  city: string,
  state: string,
  index: number
): { lat: number; lng: number } {
  const base = cityToApproxCoord(city, state) || ufToCoord(state) || { lat: -14.235, lng: -51.925 };
  const golden = Math.PI * (3 - Math.sqrt(5));
  const angle = index * golden;
  const r = 0.014 + Math.sqrt(index + 1) * 0.005;
  const cosLat = Math.cos((base.lat * Math.PI) / 180);
  return {
    lat: base.lat + r * Math.cos(angle),
    lng: base.lng + (r * Math.sin(angle)) / (cosLat || 1),
  };
}

function contactMatchesCityQuery(c: Contact, cityQuery: string): boolean {
  const fc = parseGeoFilterCity(cityQuery);
  const h = hydrateContactForGeo(c);
  const cityNorm = normKeyPart(h.city || '');
  const filterNorm = normKeyPart(fc.city);
  if (!filterNorm) return true;
  if (cityNorm !== filterNorm) return false;
  const st = String(h.state || knownUfForCity(h.city || '')).trim();
  if (fc.state && st && normKeyPart(st) !== normKeyPart(fc.state)) return false;
  return true;
}

function osmCentroidForName(
  name: string,
  byNameKey: Map<string, { lat: number; lng: number }>
): { lat: number; lng: number } | null {
  const hit = byNameKey.get(normNbKey(name));
  if (!hit || (hit.lat === 0 && hit.lng === 0)) return null;
  return hit;
}

function contactMatchesStateQuery(c: Contact, stateCode: string): boolean {
  return contactMatchesFilters(c, { state: stateCode });
}

/** Resposta rápida — bairros agregados por UF (sem lista OSM por município). */
function buildStateLightNeighborhoodSummary(
  contacts: Contact[],
  query: LeadsGeoQuery
): LeadsGeoSummary {
  const stateCode = String(query.state || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const cache = readGeoCache();
  const selectedNb = query.neighborhood?.split('·')[0]?.trim() || '';
  const selectedNbKey = selectedNb ? normNeighborhoodKey(selectedNb) : '';

  const byKey = new Map<string, GeoCluster>();
  const byNeighborhood: Record<string, number> = {};
  let filteredTotal = 0;
  let withNeighborhood = 0;
  let withPhone = 0;
  let spreadIdx = 0;

  for (const raw of contacts) {
    const c = hydrateContactForGeo(raw);
    if (!contactMatchesStateQuery(c, stateCode)) continue;

    filteredTotal++;
    if ((c.phone || '').replace(/\D/g, '').length >= 10) withPhone++;

    const { city: cityName } = resolveContactCityState(c);
    let nb = normNeighborhood(c.neighborhood || '', cityName);
    if (!nb) nb = 'Sem bairro';
    if (selectedNbKey && normNeighborhoodKey(nb) !== selectedNbKey) continue;

    withNeighborhood++;
    const nbKey = normNeighborhoodKey(nb);
    const label = `${nb} · ${stateCode}`;
    byNeighborhood[label] = (byNeighborhood[label] || 0) + 1;

    let slot = byKey.get(nbKey);
    if (!slot) {
      const spread = nbSpreadAroundCity(stateCode, stateCode, spreadIdx++);
      const cacheKey = clusterKey('neighborhood', { city: stateCode, neighborhood: nb });
      const cached = cache[cacheKey];
      slot = {
        key: cacheKey,
        label: nb,
        city: cityName || '—',
        state: stateCode,
        neighborhood: nb,
        ddd: phoneToDdd(c.phone || '') || '—',
        count: 0,
        lat: cached?.lat ?? spread.lat,
        lng: cached?.lng ?? spread.lng,
        precision: 'neighborhood',
        mapped: Boolean(cached?.lat != null),
        sampleNames: [],
      };
      byKey.set(nbKey, slot);
    }
    slot.count++;
    if (slot.sampleNames.length < 5 && c.name) {
      slot.sampleNames.push(String(c.name).slice(0, 40));
    }
  }

  const clusters = [...byKey.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label, 'pt-BR');
  });

  const top = clusters.find((c) => c.count > 0) || clusters[0];
  const topConcentration = top
    ? {
        label: top.label,
        count: top.count,
        sharePct: filteredTotal > 0 ? Math.round((1000 * top.count) / filteredTotal) / 10 : 0,
        key: top.key,
      }
    : null;

  const ufCoord = ufToCoord(stateCode);
  const mapViewport = ufCoord ? { lat: ufCoord.lat, lng: ufCoord.lng, zoom: 7 } : null;

  return {
    stats: {
      totalContacts: contacts.length,
      withAnyAddress: filteredTotal,
      withCity: filteredTotal,
      withNeighborhood,
      withPhone,
      clusters: clusters.length,
      clustersMapped: clusters.filter((c) => c.mapped && c.lat != null).length,
      clustersPending: clusters.filter((c) => !cache[c.key]).length,
      filteredTotal,
    },
    layer: 'neighborhood',
    clusters,
    byState: { [stateCode]: filteredTotal },
    byDdd: {},
    byCity: {},
    byNeighborhood,
    filters: {
      cities: [],
      states: [stateCode],
      ddds: [],
      neighborhoods: clusters.map((c) => c.neighborhood).filter(Boolean),
    },
    topConcentration,
    contactPins: [],
    pinStats: { withFullAddress: 0, pinsMapped: 0, pinsApproximate: 0, pinsPending: 0 },
    mapViewport,
  };
}

/** Resposta rápida para mapa territorial de qualquer cidade (sem geocode pesado). */
async function buildCityLightNeighborhoodSummary(
  contacts: Contact[],
  query: LeadsGeoQuery,
  ibgeIndex: ReturnType<typeof getIbgeMunicipiosIndex>
): Promise<LeadsGeoSummary> {
  const fc = parseGeoFilterCity(query.city || '');
  const cityName = titleCasePlaceName(fc.city);
  const stateCode = fc.state || knownUfForCity(cityName) || '';
  const cityLabel = stateCode ? `${cityName} · ${stateCode}` : cityName;
  const cache = readGeoCache();
  const selectedNb = query.neighborhood?.split('·')[0]?.trim() || '';
  const selectedNbKey = selectedNb ? normNeighborhoodKey(selectedNb) : '';

  const bundle = await resolveNeighborhoodBundle(cityName, stateCode, ibgeIndex);
  const officialList = bundle.names;
  const osmCentroids = new Map<string, { lat: number; lng: number }>();
  for (const nb of bundle.neighborhoods) {
    if (nb.centroid && (nb.centroid.lat !== 0 || nb.centroid.lng !== 0)) {
      osmCentroids.set(nb.nameKey, nb.centroid);
    }
  }

  const byKey = new Map<string, GeoCluster>();
  const byNeighborhood: Record<string, number> = {};
  let filteredTotal = 0;
  let withNeighborhood = 0;
  let withPhone = 0;

  for (const [idx, name] of officialList.entries()) {
    const nbKey = normNeighborhoodKey(name);
    const osm = osmCentroidForName(name, osmCentroids);
    const spread = nbSpreadAroundCity(cityName, stateCode, idx);
    const cacheKey = clusterKey('neighborhood', { city: cityName, neighborhood: name });
    const cached = cache[cacheKey];
    byKey.set(nbKey, {
      key: cacheKey,
      label: `${name} · ${cityName}`,
      city: cityName,
      state: stateCode || '—',
      neighborhood: name,
      ddd: '—',
      count: 0,
      lat: cached?.lat ?? osm?.lat ?? spread.lat,
      lng: cached?.lng ?? osm?.lng ?? spread.lng,
      precision: 'neighborhood',
      mapped: Boolean(cached?.lat != null || osm != null),
      sampleNames: [],
    });
  }

  for (const raw of contacts) {
    const c = hydrateContactForGeo(raw);
    if (!contactMatchesCityQuery(c, query.city || '')) continue;

    filteredTotal++;
    if ((c.phone || '').replace(/\D/g, '').length >= 10) withPhone++;

    let nb = normNeighborhood(c.neighborhood || '', cityName);
    if (officialList.length > 0) {
      nb = resolveContactNeighborhoodForCity(cityName, stateCode, nb, officialList);
    } else if (!nb) {
      nb = 'Sem bairro';
    }
    if (selectedNbKey && normNeighborhoodKey(nb) !== selectedNbKey) continue;

    withNeighborhood++;
    const nbKey = normNeighborhoodKey(nb);
    const label = `${nb} · ${cityName}`;
    byNeighborhood[label] = (byNeighborhood[label] || 0) + 1;

    let slot = byKey.get(nbKey);
    if (!slot) {
      if (officialList.length > 0) continue;
      const osm = osmCentroidForName(nb, osmCentroids);
      const spread = nbSpreadAroundCity(cityName, stateCode, byKey.size);
      const cacheKey = clusterKey('neighborhood', { city: cityName, neighborhood: nb });
      const cached = cache[cacheKey];
      slot = {
        key: cacheKey,
        label,
        city: cityName,
        state: stateCode || '—',
        neighborhood: nb,
        ddd: phoneToDdd(c.phone || '') || '—',
        count: 0,
        lat: cached?.lat ?? osm?.lat ?? spread.lat,
        lng: cached?.lng ?? osm?.lng ?? spread.lng,
        precision: 'neighborhood',
        mapped: Boolean(cached?.lat != null || osm != null),
        sampleNames: [],
      };
      byKey.set(nbKey, slot);
    }
    slot.count++;
    if (slot.sampleNames.length < 5 && c.name) {
      slot.sampleNames.push(String(c.name).slice(0, 40));
    }
  }

  const clusters = [...byKey.values()].sort((a, b) => {
    const ai = officialList.findIndex((n) => normNbKey(n) === normNbKey(a.neighborhood));
    const bi = officialList.findIndex((n) => normNbKey(n) === normNbKey(b.neighborhood));
    if (ai >= 0 && bi >= 0 && ai !== bi) return ai - bi;
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label, 'pt-BR');
  });
  const top = clusters.find((c) => c.count > 0) || clusters[0];
  const topConcentration = top
    ? {
        label: top.label,
        count: top.count,
        sharePct: filteredTotal > 0 ? Math.round((1000 * top.count) / filteredTotal) / 10 : 0,
        key: top.key,
      }
    : null;

  const cityCoord = cityToApproxCoord(cityName, stateCode) || ufToCoord(stateCode);
  const mapViewport = cityCoord
    ? { lat: cityCoord.lat, lng: cityCoord.lng, zoom: clusters.length > 0 ? 12 : 11 }
    : null;

  const nbLabels =
    officialList.length > 0
      ? officialList
      : clusters.map((c) => c.neighborhood).filter(Boolean);

  return {
    stats: {
      totalContacts: contacts.length,
      withAnyAddress: filteredTotal,
      withCity: filteredTotal,
      withNeighborhood,
      withPhone,
      clusters: clusters.length,
      clustersMapped: clusters.filter((c) => c.mapped && c.lat != null).length,
      clustersPending: clusters.filter((c) => !cache[c.key]).length,
      filteredTotal,
    },
    layer: 'neighborhood',
    clusters,
    byState: stateCode ? { [stateCode]: filteredTotal } : {},
    byDdd: {},
    byCity: { [cityLabel]: filteredTotal },
    byNeighborhood,
    filters: {
      cities: [cityLabel],
      states: stateCode ? [stateCode] : [],
      ddds: [],
      neighborhoods: nbLabels,
    },
    topConcentration,
    contactPins: [],
    pinStats: { withFullAddress: 0, pinsMapped: 0, pinsApproximate: 0, pinsPending: 0 },
    mapViewport,
    officialNeighborhoods: officialList.length > 0 ? officialList : undefined,
  };
}

async function buildLeadsGeoSummaryInner(
  tenantId: string,
  query: LeadsGeoQuery = {}
): Promise<LeadsGeoSummary> {
  const layer: GeoLayer =
    query.layer === 'neighborhood' || query.layer === 'city' || query.layer === 'ddd' || query.layer === 'state'
      ? query.layer
      : 'city';

  const contacts = await loadTenantContacts(tenantId);
  const lightMode = query.light === true;

  if (lightMode && layer === 'neighborhood' && query.state?.trim() && !query.city?.trim() && !query.neighborhood?.trim()) {
    return buildStateLightNeighborhoodSummary(contacts, query);
  }

  if (lightMode && layer === 'neighborhood' && query.city?.trim() && !query.neighborhood?.trim()) {
    const ibgeIndex = getIbgeMunicipiosIndex();
    if (isBlumenauCity(query.city || '')) {
      return buildBlumenauLightNeighborhoodSummary(contacts, query);
    }
    return buildCityLightNeighborhoodSummary(contacts, query, ibgeIndex);
  }

  const ibgeIndex = getIbgeMunicipiosIndex();
  const nbToCityMap = buildNeighborhoodToCityMap(
    contacts.map((c) => ({
      city: c.city,
      state: c.state,
      neighborhood: c.neighborhood,
      zipCode: c.zipCode,
      phone: c.phone
    })),
    ibgeIndex
  );
  const cache = readGeoCache();
  const nameSearchActive = (query.name || '').trim().length >= 2;
  let filtered = contacts.filter((c) => contactMatchesFilters(c, query));
  if (nameSearchActive && filtered.length > 0 && filtered.length <= 20) {
    filtered = await ensureContactsGeocodedForNameSearch(tenantId, filtered);
    invalidateLeadsGeoSummaryCache(tenantId);
  }

  // Memoiza por ASSINATURA do endereço (não por id): bases grandes repetem muito a
  // mesma cidade/bairro/UF, então a resolução pesada (fuzzy IBGE) roda só uma vez por
  // endereço único — o que evita travar o event loop com dezenas de milhares de contatos.
  const geoPlaceMemo = new Map<string, ReturnType<typeof resolveContactGeoPlace>>();
  const geoPlaceSig = (c: Contact): string => {
    const uf = phoneDigitsToUf((c.phone || '').replace(/\D/g, '')) || '';
    return `${c.city || ''}|${c.state || ''}|${c.neighborhood || ''}|${c.zipCode || ''}|${uf}`;
  };
  const memoGeoPlace = (c: Contact) => {
    const k = geoPlaceSig(c);
    const hit = geoPlaceMemo.get(k);
    if (hit) return hit;
    const place = resolveContactGeoPlace(c, nbToCityMap);
    geoPlaceMemo.set(k, place);
    return place;
  };

  const canonCityMemo = new Map<string, string>();
  const memoCanonCity = (city: string, stateHint: string, phone?: string, zipCode?: string) => {
    const k = `${normKeyPart(city)}|${stateHint}|${phone || ''}|${zipCode || ''}`;
    const hit = canonCityMemo.get(k);
    if (hit !== undefined) return hit;
    const canon = canonicalizeClusterCity(city, stateHint, phone, zipCode, ibgeIndex);
    canonCityMemo.set(k, canon);
    return canon;
  };

  const stateMemo = new Map<string, string>();
  const memoContactState = (c: Contact): string => {
    const uf = phoneDigitsToUf((c.phone || '').replace(/\D/g, '')) || '';
    const k = `${c.city || ''}|${c.state || ''}|${uf}`;
    const hit = stateMemo.get(k);
    if (hit !== undefined) return hit;
    const st = resolveContactState(c);
    stateMemo.set(k, st);
    return st;
  };

  /** Pins aproximados em espiral são caros com dezenas de milhares de contatos. */
  const skipApproxPins = lightMode || (!nameSearchActive && filtered.length > 2500);

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
  const maxContactPins = lightMode
    ? 0
    : nameSearchActive
      ? 800
      : query.neighborhood
        ? 6000
        : query.city
          ? 3500
          : 1500;
  let filteredWithFullAddress = 0;
  let pinsMapped = 0;
  let pinsApproximate = 0;
  let pinsPending = 0;

  let scanned = 0;
  for (const c of contacts) {
    if (++scanned % 1500 === 0) await yieldEventLoop();
    if (hasAnyAddressField(c)) withAnyAddress++;
    if (normCity(c.city || '')) withCity++;
    if (normNeighborhood(c.neighborhood || '')) withNeighborhood++;
    if ((c.phone || '').replace(/\D/g, '').length >= 10) withPhone++;

    const place = memoGeoPlace(c);
    // Usa memoContactState como fallback para garantir que a UF nunca fica vazia
    // quando place.state não veio preenchido (mantém consistência com o loop de clusters).
    const stResolved = memoContactState(c) || place.state || knownUfForCity(place.city) || '';
    const cityCanon = place.city
      ? memoCanonCity(place.city, stResolved, c.phone, c.zipCode)
      : '';
    const nb = normNeighborhood(place.neighborhood || c.neighborhood || '', cityCanon || place.city);
    const st = stResolved;
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

  let processed = 0;
  for (const raw of filtered) {
    if (++processed % 1500 === 0) await yieldEventLoop();
    const c = hydrateContactForGeo(raw);
    const place = memoGeoPlace(c);
    const stResolved = memoContactState(c) || place.state || knownUfForCity(place.city) || '';
    const st = stResolved || '—';
    const cityCanon = place.city
      ? memoCanonCity(place.city, stResolved, c.phone, c.zipCode)
      : '';
    const city = cityCanon || '—';
    const nb = normNeighborhood(place.neighborhood || c.neighborhood || '', cityCanon || place.city) || '—';
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
      const picked = nameSearchActive ? null : pickClusterCoords(draft, cache);
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
      if (stored) {
        const maxKm = hasTrustedStreetGeocode(c) ? 90 : 40;
        if (
          isCoordPlausibleForCity(stored.lat, stored.lng, city, st, maxKm) ||
          hasTrustedStreetGeocode(c)
        ) {
          cluster.lat = stored.lat;
          cluster.lng = stored.lng;
          cluster.mapped = true;
        }
      }
    }
    if (cluster.sampleNames.length < 3 && (c.name || '').trim()) {
      cluster.sampleNames.push((c.name || '').trim());
    }

    if (hasFullStreetAddress(c)) filteredWithFullAddress++;

    const storedPin = storedContactCoords(c);
    if (storedPin) {
      pinsMapped++;
      appendContactPin(
        contactPins,
        maxContactPins,
        c,
        storedPin.lat,
        storedPin.lng,
        hasTrustedStreetGeocode(c) ? 'address' : contactPinPrecision(c),
        false,
        nbToCityMap
      );
    } else if (hasFullStreetAddress(c)) {
      pinsPending++;
    } else if (
      !skipApproxPins &&
      (normNeighborhood(c.neighborhood || '') || normCity(c.city || ''))
    ) {
      const { city: pinCity, state: pinState } = resolveContactCityState(c, nbToCityMap);
      const nb = normNeighborhood(c.neighborhood || '', pinCity);
      const approx = resolveContactPinCoord(
        c,
        pinCity || '—',
        pinState || '—',
        nb || '—',
        pinsApproximate,
        Math.max(filtered.length, 1),
        cache
      );
      if (approx?.approximate) {
        pinsApproximate++;
        appendContactPin(
          contactPins,
          maxContactPins,
          c,
          approx.lat,
          approx.lng,
          contactPinPrecision(c),
          true,
          nbToCityMap
        );
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

  let clusters = mergeDuplicateClusters([...clusterMap.values()], layer);
  clusters = alignClustersToExactPins(clusters, contactPins);

  if (isBlumenauCity(query.city || '') && layer === 'neighborhood') {
    clusters = consolidateBlumenauOfficialNeighborhoods(clusters, byNeighborhood, cache);
  }

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

/** Agrega clusters em exatamente os 35 bairros oficiais de Blumenau (mapa leve). */
function consolidateBlumenauOfficialNeighborhoods(
  clusters: GeoCluster[],
  byNeighborhood: Record<string, number>,
  cache: GeoCacheFile
): GeoCluster[] {
  const byKey = new Map<string, GeoCluster>();

  BLUMENAU_OFFICIAL_NEIGHBORHOODS.forEach((name, idx) => {
    const spread = blumenauSpreadCoord(idx);
    const key = clusterKey('neighborhood', { city: 'Blumenau', neighborhood: name });
    byKey.set(normBlumenauNbKey(name), {
      key,
      label: name,
      city: 'Blumenau',
      state: 'SC',
      neighborhood: name,
      ddd: '47',
      count: 0,
      lat: spread.lat,
      lng: spread.lng,
      precision: 'neighborhood',
      mapped: false,
      sampleNames: []
    });
  });

  for (const c of clusters) {
    const official = matchOfficialNeighborhood(c.neighborhood || c.label);
    if (!official) continue;
    const k = normBlumenauNbKey(official);
    const slot = byKey.get(k);
    if (!slot) continue;
    slot.count += c.count;
    if (c.sampleNames?.length) {
      slot.sampleNames = [...slot.sampleNames, ...c.sampleNames].slice(0, 5);
    }
    if (c.lat != null && c.lng != null && (c.mapped || !slot.mapped)) {
      slot.lat = c.lat;
      slot.lng = c.lng;
      slot.mapped = c.mapped || !!cache[c.key];
    }
  }

  for (const [label, count] of Object.entries(byNeighborhood)) {
    const official = matchOfficialNeighborhood(label);
    if (!official) continue;
    const k = normBlumenauNbKey(official);
    const slot = byKey.get(k);
    if (!slot) continue;
    slot.count = Math.max(slot.count, count);
  }

  for (const slot of byKey.values()) {
    if (slot.lat != null && slot.lng != null) continue;
    const picked = pickClusterCoords(slot, cache);
    if (picked) {
      slot.lat = picked.lat;
      slot.lng = picked.lng;
      slot.mapped = picked.mapped;
    }
  }

  return [...byKey.values()].sort((a, b) => b.count - a.count);
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
      const hit = await geocodeClusterQuery(
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

  if (geocoded > 0) {
    writeGeoCache(cache);
    invalidateLeadsGeoSummaryCache(tenantId);
  }

  const refreshed = await buildLeadsGeoSummary(tenantId, {
    layer,
    city: opts?.city,
    neighborhood: opts?.neighborhood
  });
  const stillPending = refreshed.clusters.filter((c) => !cache[c.key]).length;
  return { geocoded, failed, pending: stillPending, googleStatus: lastGoogleStatus, summary: refreshed };
}

function contactNeedsGeocode(c: Contact): boolean {
  const hasZip = (c.zipCode || '').replace(/\D/g, '').length === 8;
  if (
    !hasFullStreetAddress(c) &&
    !normCity(c.city || '') &&
    !normNeighborhood(c.neighborhood || '') &&
    !hasZip
  ) {
    return false;
  }
  const stored = storedContactCoords(c);
  if (!stored) {
    return (
      hasFullStreetAddress(c) ||
      Boolean(normNeighborhood(c.neighborhood || '')) ||
      Boolean(normCity(c.city || '')) ||
      hasZip
    );
  }
  if (!hasFullStreetAddress(c)) return false;
  const precision = c.geocodePrecision;
  if (!precision || precision === 'city' || precision === 'neighborhood') return true;
  if (precision === 'cep' && hasFullStreetAddress(c)) return false;
  if (isLikelyCityCenterOnly(c, stored.lat, stored.lng)) return true;
  return false;
}

export function isContactGeocodeAvailable(): boolean {
  return isGoogleGeocodeEnabled() || isNominatimEnabled() || true;
}

export async function geocodeContactsWithAddress(
  tenantId: string,
  opts?: { max?: number; city?: string; state?: string; neighborhood?: string; name?: string; force?: boolean }
): Promise<{ geocoded: number; failed: number; summary: LeadsGeoSummary }> {
  const max = Math.min(Math.max(opts?.max ?? 60, 1), 250);

  const contacts = await loadTenantContacts(tenantId);
  const pending = contacts
    .filter((c) => {
      if (
        !contactMatchesFilters(c, {
          city: opts?.city,
          state: opts?.state,
          neighborhood: opts?.neighborhood,
          name: opts?.name
        })
      ) {
        return false;
      }
      if (opts?.force && hasFullStreetAddress(c)) return true;
      const hasBadCoords =
        Number.isFinite(c.latitude) &&
        Number.isFinite(c.longitude) &&
        !contactCoordsValid(c, c.latitude!, c.longitude!);
      if (hasBadCoords) return true;
      return contactNeedsGeocode(c);
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
      geocodedAt: new Date().toISOString(),
      geocodePrecision: hit.precision
    });
    geocoded++;
  }

  if (geocoded > 0) invalidateLeadsGeoSummaryCache(tenantId);

  const summary = await buildLeadsGeoSummary(tenantId, {
    layer: opts?.neighborhood || opts?.city ? 'neighborhood' : 'city',
    city: opts?.city,
    state: opts?.state,
    neighborhood: opts?.neighborhood,
    name: opts?.name
  });
  return { geocoded, failed, summary };
}

const ADDRESS_GEO_FIELDS = ['street', 'number', 'city', 'state', 'neighborhood', 'zipCode'] as const;

export function contactAddressFieldsChanged(
  before: Contact,
  after: Partial<Contact>
): boolean {
  for (const k of ADDRESS_GEO_FIELDS) {
    if (!(k in after)) continue;
    const prev = String(before[k] ?? '').trim();
    const next = String(after[k] ?? '').trim();
    if (prev !== next) return true;
  }
  return false;
}

/** Geocodifica um contato após salvar endereço (não bloqueia a API se falhar). */
export async function geocodeSingleContactIfNeeded(
  tenantId: string,
  contact: Contact
): Promise<Contact> {
  if (!isContactGeocodeAvailable()) return contact;
  if (!contactNeedsGeocode(contact)) return contact;

  const hit = await geocodeContactAddress(contact);
  if (!hit) return contact;

  const updated = await updateContact(tenantId, contact.id, {
    latitude: hit.lat,
    longitude: hit.lng,
    geocodedAt: new Date().toISOString(),
    geocodePrecision: hit.precision
  });
  return updated || contact;
}
