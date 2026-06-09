import { apiFetchJson } from '../utils/apiFetchAuth';

export type GeoLayer = 'neighborhood' | 'city' | 'ddd' | 'state';

export type GeoClusterPrecision = 'neighborhood' | 'city' | 'ddd' | 'state' | 'cep';

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
  pinStats: { withFullAddress: number; pinsMapped: number; pinsPending: number };
  mapViewport?: { lat: number; lng: number; zoom: number } | null;
};

export type LeadsGeoQuery = {
  layer?: GeoLayer;
  state?: string;
  city?: string;
  ddd?: string;
  neighborhood?: string;
};

function buildQueryString(q: LeadsGeoQuery): string {
  const p = new URLSearchParams();
  if (q.layer) p.set('layer', q.layer);
  if (q.state) p.set('state', q.state);
  if (q.city) p.set('city', q.city);
  if (q.ddd) p.set('ddd', q.ddd);
  if (q.neighborhood) p.set('neighborhood', q.neighborhood);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export type LeadsGeoMapProvider = 'openstreetmap' | 'google';

export async function fetchLeadsGeoConfig(): Promise<{
  enabled: boolean;
  geocodeEnabled: boolean;
  mapProvider: LeadsGeoMapProvider;
  googleMapsAvailable: boolean;
  nominatimEnabled: boolean;
  mapKey: string | null;
}> {
  const j = await apiFetchJson<{
    enabled?: boolean;
    geocodeEnabled?: boolean;
    mapProvider?: LeadsGeoMapProvider;
    googleMapsAvailable?: boolean;
    nominatimEnabled?: boolean;
    mapKey?: string | null;
  }>('/api/leads-geo/config');
  return {
    enabled: j.enabled !== false,
    geocodeEnabled: !!j.geocodeEnabled,
    mapProvider: j.mapProvider === 'google' ? 'google' : 'openstreetmap',
    googleMapsAvailable: !!j.googleMapsAvailable,
    nominatimEnabled: j.nominatimEnabled !== false,
    mapKey: j.mapKey ?? null
  };
}

export async function fetchLeadsGeoSummary(query: LeadsGeoQuery = {}): Promise<LeadsGeoSummary> {
  const j = await apiFetchJson<LeadsGeoSummary & { ok?: boolean }>(
    `/api/leads-geo/summary${buildQueryString(query)}`
  );
  return {
    stats: j.stats,
    layer: j.layer || query.layer || 'city',
    clusters: Array.isArray(j.clusters) ? j.clusters : [],
    byState: j.byState && typeof j.byState === 'object' ? j.byState : {},
    byDdd: j.byDdd && typeof j.byDdd === 'object' ? j.byDdd : {},
    byCity: j.byCity && typeof j.byCity === 'object' ? j.byCity : {},
    byNeighborhood: j.byNeighborhood && typeof j.byNeighborhood === 'object' ? j.byNeighborhood : {},
    filters: j.filters || { cities: [], states: [], ddds: [], neighborhoods: [] },
    topConcentration: j.topConcentration ?? null,
    contactPins: Array.isArray(j.contactPins) ? j.contactPins : [],
    pinStats: j.pinStats || { withFullAddress: 0, pinsMapped: 0, pinsPending: 0 }
  };
}

export async function apiGeocodeLeadsClusters(
  opts: { max?: number; layer?: GeoLayer; force?: boolean; city?: string; neighborhood?: string } = {}
): Promise<{
  geocoded: number;
  failed: number;
  pending: number;
  summary: LeadsGeoSummary;
}> {
  return apiFetchJson('/api/leads-geo/geocode-clusters', {
    method: 'POST',
    body: JSON.stringify(opts)
  });
}

export async function apiGeocodeContacts(
  opts: { max?: number; city?: string; neighborhood?: string } = {}
): Promise<{ geocoded: number; failed: number; summary: LeadsGeoSummary }> {
  return apiFetchJson('/api/leads-geo/geocode-contacts', {
    method: 'POST',
    body: JSON.stringify(opts)
  });
}
