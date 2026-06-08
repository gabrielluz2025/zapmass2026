import { apiFetchJson } from '../utils/apiFetchAuth';

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

export async function fetchLeadsGeoConfig(): Promise<{ enabled: boolean; mapKey: string | null }> {
  const j = await apiFetchJson<{ enabled?: boolean; mapKey?: string | null }>('/api/leads-geo/config');
  return { enabled: !!j.enabled, mapKey: j.mapKey ?? null };
}

export async function fetchLeadsGeoSummary(): Promise<LeadsGeoSummary> {
  const j = await apiFetchJson<LeadsGeoSummary & { ok?: boolean }>('/api/leads-geo/summary');
  return {
    stats: j.stats,
    clusters: Array.isArray(j.clusters) ? j.clusters : [],
    byState: j.byState && typeof j.byState === 'object' ? j.byState : {}
  };
}

export async function apiGeocodeLeadsClusters(max = 40): Promise<{
  geocoded: number;
  failed: number;
  summary: LeadsGeoSummary;
}> {
  return apiFetchJson('/api/leads-geo/geocode-clusters', {
    method: 'POST',
    body: JSON.stringify({ max })
  });
}
