import { apiFetchJson } from '../utils/apiFetchAuth';

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

export async function fetchLeadsGeoConfig(): Promise<{ enabled: boolean; mapKey: string | null }> {
  const j = await apiFetchJson<{ enabled?: boolean; mapKey?: string | null }>('/api/leads-geo/config');
  return { enabled: !!j.enabled, mapKey: j.mapKey ?? null };
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
    topConcentration: j.topConcentration ?? null
  };
}

export async function apiGeocodeLeadsClusters(
  opts: { max?: number; layer?: GeoLayer; force?: boolean } = {}
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
