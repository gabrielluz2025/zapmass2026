import fs from 'fs';
import path from 'path';
import type { Contact } from '../src/types.js';
import { geocodeBrazilAddress, isGoogleGeocodeEnabled } from './googleGeocode.js';
import { getZapmassPool } from './db/postgres.js';
import { rowToContact, type ContactRow } from './repositories/contactMapper.js';
import { listContacts, updateContact } from './repositories/contactsRepository.js';

export type GeoClusterPrecision = 'address' | 'city' | 'state';

export type GeoCluster = {
  key: string;
  city: string;
  state: string;
  count: number;
  lat: number | null;
  lng: number | null;
  precision: GeoClusterPrecision;
  sampleNames: string[];
};

export type LeadsGeoSummary = {
  stats: {
    totalContacts: number;
    withAnyAddress: number;
    withFullAddress: number;
    withCity: number;
    withCoordinates: number;
    clusters: number;
    clustersMapped: number;
  };
  clusters: GeoCluster[];
  byState: Record<string, number>;
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

function hasAnyAddressField(c: Contact): boolean {
  return Boolean(
    (c.street || '').trim() ||
      (c.city || '').trim() ||
      (c.state || '').trim() ||
      (c.zipCode || '').trim() ||
      (c.neighborhood || '').trim()
  );
}

function hasFullAddress(c: Contact): boolean {
  const street = (c.street || '').trim();
  const city = (c.city || '').trim();
  return street.length > 2 && city.length > 1;
}

function buildGeocodeQuery(c: Contact, precision: GeoClusterPrecision): string | null {
  const city = normCity(c.city || '');
  const state = normState(c.state || '');
  const zip = (c.zipCode || '').replace(/\D/g, '');
  const street = (c.street || '').trim();
  const number = (c.number || '').trim();
  const neighborhood = (c.neighborhood || '').trim();

  if (precision === 'address' && street && city) {
    const parts = [street, number, neighborhood, city, state, zip ? `CEP ${zip}` : '', 'Brasil'].filter(
      Boolean
    );
    return parts.join(', ');
  }
  if (precision === 'city' && city) {
    return [city, state, 'Brasil'].filter(Boolean).join(', ');
  }
  if (precision === 'state' && state) {
    return `${state}, Brasil`;
  }
  return null;
}

function clusterKey(city: string, state: string, precision: GeoClusterPrecision): string {
  return `${precision}:${state || '—'}:${city || '—'}`.toLowerCase();
}

function pickClusterPrecision(c: Contact): GeoClusterPrecision | null {
  if (hasFullAddress(c)) return 'address';
  if (normCity(c.city || '')) return 'city';
  if (normState(c.state || '')) return 'state';
  return null;
}

export async function buildLeadsGeoSummary(tenantId: string): Promise<LeadsGeoSummary> {
  const pool = getZapmassPool();
  let contacts: Contact[] = [];
  if (pool) {
    const r = await pool.query<ContactRow>(
      `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
       FROM zapmass.contacts WHERE tenant_id = $1::uuid`,
      [tenantId]
    );
    contacts = r.rows.map(rowToContact);
  } else {
    contacts = await listContacts(tenantId, { limit: 50_000, offset: 0 });
  }

  const cache = readGeoCache();
  const clusterMap = new Map<string, GeoCluster>();
  const byState: Record<string, number> = {};

  let withAnyAddress = 0;
  let withFullAddress = 0;
  let withCity = 0;
  let withCoordinates = 0;

  for (const c of contacts) {
    if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) withCoordinates++;
    if (!hasAnyAddressField(c)) continue;
    withAnyAddress++;
    if (hasFullAddress(c)) withFullAddress++;
    if (normCity(c.city || '')) withCity++;

    const precision = pickClusterPrecision(c);
    if (!precision) continue;

    const city = precision === 'state' ? '' : normCity(c.city || '');
    const state = normState(c.state || '');
    const key = clusterKey(city, state, precision);

    if (state) byState[state] = (byState[state] || 0) + 1;

    let cluster = clusterMap.get(key);
    if (!cluster) {
      const cached = cache[key];
      let lat: number | null = null;
      let lng: number | null = null;
      if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
        lat = c.latitude!;
        lng = c.longitude!;
      } else if (cached) {
        lat = cached.lat;
        lng = cached.lng;
      }
      cluster = {
        key,
        city: city || (precision === 'state' ? state : '—'),
        state: state || '—',
        count: 0,
        lat,
        lng,
        precision,
        sampleNames: []
      };
      clusterMap.set(key, cluster);
    }
    cluster.count++;
    if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
      cluster.lat = c.latitude!;
      cluster.lng = c.longitude!;
    }
    if (cluster.sampleNames.length < 3 && (c.name || '').trim()) {
      cluster.sampleNames.push((c.name || '').trim());
    }
  }

  const clusters = [...clusterMap.values()].sort((a, b) => b.count - a.count);
  const clustersMapped = clusters.filter((c) => c.lat != null && c.lng != null).length;

  return {
    stats: {
      totalContacts: contacts.length,
      withAnyAddress,
      withFullAddress,
      withCity,
      withCoordinates,
      clusters: clusters.length,
      clustersMapped
    },
    clusters: clusters.slice(0, 500),
    byState
  };
}

export async function geocodeLeadsGeoClusters(
  tenantId: string,
  opts?: { max?: number }
): Promise<{ geocoded: number; failed: number; summary: LeadsGeoSummary }> {
  const max = Math.min(Math.max(opts?.max ?? 40, 1), 80);
  if (!isGoogleGeocodeEnabled()) {
    throw new Error(
      'Configure GOOGLE_MAPS_API_KEY no servidor (.env) com Geocoding API ativa no Google Cloud.'
    );
  }

  const summary = await buildLeadsGeoSummary(tenantId);
  const pending = summary.clusters.filter((c) => c.lat == null || c.lng == null).slice(0, max);
  const cache = readGeoCache();
  let geocoded = 0;
  let failed = 0;

  for (const cluster of pending) {
    const sampleContact: Contact = {
      id: 'sample',
      name: cluster.sampleNames[0] || 'Contato',
      phone: '',
      city: cluster.city !== '—' ? cluster.city : undefined,
      state: cluster.state !== '—' ? cluster.state : undefined,
      tags: [],
      status: 'VALID'
    };
    const query = buildGeocodeQuery(sampleContact, cluster.precision);
    if (!query) {
      failed++;
      continue;
    }
    const hit = await geocodeBrazilAddress(query);
    if (!hit) {
      failed++;
      await new Promise((r) => setTimeout(r, 120));
      continue;
    }
    cache[cluster.key] = { lat: hit.lat, lng: hit.lng, at: new Date().toISOString() };
    geocoded++;
    await new Promise((r) => setTimeout(r, 150));
  }

  if (geocoded > 0) writeGeoCache(cache);

  const refreshed = await buildLeadsGeoSummary(tenantId);
  return { geocoded, failed, summary: refreshed };
}

/** Geocodifica contatos individuais com endereço completo e persiste lat/lng no CRM. */
export async function geocodeContactsWithAddress(
  tenantId: string,
  opts?: { max?: number }
): Promise<{ geocoded: number; failed: number }> {
  const max = Math.min(Math.max(opts?.max ?? 25, 1), 50);
  if (!isGoogleGeocodeEnabled()) {
    throw new Error('Configure GOOGLE_MAPS_API_KEY no servidor.');
  }

  const contacts = await listContacts(tenantId, { limit: 10_000, offset: 0 });

  const pending = contacts
    .filter(
      (c) =>
        hasFullAddress(c) &&
        !(Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
    )
    .slice(0, max);

  let geocoded = 0;
  let failed = 0;

  for (const c of pending) {
    const precision = 'address' as const;
    const query = buildGeocodeQuery(c, precision);
    if (!query) {
      failed++;
      continue;
    }
    const hit = await geocodeBrazilAddress(query);
    if (!hit) {
      failed++;
      await new Promise((r) => setTimeout(r, 120));
      continue;
    }
    await updateContact(tenantId, c.id, {
      latitude: hit.lat,
      longitude: hit.lng,
      geocodedAt: new Date().toISOString()
    });
    geocoded++;
    await new Promise((r) => setTimeout(r, 150));
  }

  return { geocoded, failed };
}
