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
  approximate?: boolean;
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
  pinStats: {
    withFullAddress: number;
    pinsMapped: number;
    pinsApproximate: number;
    pinsPending: number;
  };
  mapViewport?: { lat: number; lng: number; zoom: number } | null;
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
  /** Resposta leve: só agregação por bairro, sem pins individuais. */
  light?: boolean;
};

function buildQueryString(q: LeadsGeoQuery): string {
  const p = new URLSearchParams();
  if (q.layer) p.set('layer', q.layer);
  if (q.state) p.set('state', q.state);
  if (q.city) p.set('city', q.city);
  if (q.ddd) p.set('ddd', q.ddd);
  if (q.neighborhood) p.set('neighborhood', q.neighborhood);
  if (q.name) p.set('name', q.name);
  if (q.light) p.set('light', '1');
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
  buildRef: string | null;
}> {
  const j = await apiFetchJson<{
    enabled?: boolean;
    geocodeEnabled?: boolean;
    mapProvider?: LeadsGeoMapProvider;
    googleMapsAvailable?: boolean;
    nominatimEnabled?: boolean;
    mapKey?: string | null;
    buildRef?: string | null;
  }>('/api/leads-geo/config');
  return {
    enabled: j.enabled !== false,
    geocodeEnabled: !!j.geocodeEnabled,
    mapProvider: j.mapProvider === 'google' ? 'google' : 'openstreetmap',
    googleMapsAvailable: !!j.googleMapsAvailable,
    nominatimEnabled: j.nominatimEnabled !== false,
    mapKey: j.mapKey ?? null,
    buildRef: j.buildRef ?? null
  };
}

const LEADS_GEO_SUMMARY_TIMEOUT_MS = 120_000;

export async function fetchLeadsGeoSummary(query: LeadsGeoQuery = {}): Promise<LeadsGeoSummary> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), LEADS_GEO_SUMMARY_TIMEOUT_MS);
  let j: LeadsGeoSummary & { ok?: boolean };
  try {
    j = await apiFetchJson<LeadsGeoSummary & { ok?: boolean }>(
      `/api/leads-geo/summary${buildQueryString(query)}`,
      { signal: ctrl.signal }
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(
        'O mapa demorou demais para carregar. Tente Atualizar ou filtre por cidade para acelerar.'
      );
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
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
    pinStats: j.pinStats || { withFullAddress: 0, pinsMapped: 0, pinsApproximate: 0, pinsPending: 0 },
    stale: j.stale === true ? true : undefined
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
  opts: { max?: number; city?: string; neighborhood?: string; name?: string; force?: boolean } = {}
): Promise<{ geocoded: number; failed: number; summary: LeadsGeoSummary }> {
  return apiFetchJson('/api/leads-geo/geocode-contacts', {
    method: 'POST',
    body: JSON.stringify(opts)
  });
}

export type AddressNormDiff = {
  contactId: string;
  name: string;
  field: string;
  before: string;
  after: string;
  source: 'cep_viacep' | 'cep_brasilapi' | 'abbreviation' | 'state_name' | 'titlecase';
};

export type NormalizeAddressesResult = {
  ok: boolean;
  processed: number;
  changed: number;
  unchanged: number;
  failed: number;
  diffs: AddressNormDiff[];
};

/** Dispara a normalização inteligente de endereços (ViaCEP + IBGE + regras) em lote. */
export async function apiNormalizeAddresses(
  opts: { max?: number } = {}
): Promise<NormalizeAddressesResult> {
  return apiFetchJson('/api/leads-geo/normalize-addresses', {
    method: 'POST',
    body: JSON.stringify(opts)
  });
}

// ── Mapa de Inteligência Comercial ────────────────────────────────────────────

export type RegionTemperature = 'hot' | 'warm' | 'cold' | 'untouched';

export type RegionConversion = {
  key: string;
  label: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  leads: number;
  contacted: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  replyRate: number;
  deliveryRate: number;
  coverageRate: number;
  temperature: RegionTemperature;
  score: number;
};

export type HeatPoint = { lat: number; lng: number; weight: number };

export type CommercialIntelligence = {
  generatedAt: string;
  national: {
    totalLeads: number;
    geoLeads: number;
    contactedLeads: number;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    failed: number;
    replyRate: number;
    deliveryRate: number;
    coveragePct: number;
    statesCovered: number;
    campaignsConsidered: number;
  };
  byCity: RegionConversion[];
  byState: RegionConversion[];
  heatPoints: HeatPoint[];
  hotZones: RegionConversion[];
  coldZones: RegionConversion[];
};

const INTELLIGENCE_TIMEOUT_MS = 120_000;

/** Carrega o Mapa de Inteligência Comercial (geografia x conversão de campanhas). */
export async function fetchCommercialIntelligence(): Promise<CommercialIntelligence> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), INTELLIGENCE_TIMEOUT_MS);
  try {
    const j = await apiFetchJson<CommercialIntelligence & { ok?: boolean }>(
      '/api/leads-geo/intelligence',
      { signal: ctrl.signal }
    );
    return {
      generatedAt: j.generatedAt,
      national: j.national,
      byCity: Array.isArray(j.byCity) ? j.byCity : [],
      byState: Array.isArray(j.byState) ? j.byState : [],
      heatPoints: Array.isArray(j.heatPoints) ? j.heatPoints : [],
      hotZones: Array.isArray(j.hotZones) ? j.hotZones : [],
      coldZones: Array.isArray(j.coldZones) ? j.coldZones : []
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('O mapa demorou demais para carregar. Tente novamente.');
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

/** GeoJSON dos estados (IBGE) para o choropleth. */
export async function fetchBrazilStatesGeoJson(): Promise<{
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; properties: Record<string, unknown>; geometry: unknown }>;
}> {
  return apiFetchJson('/api/leads-geo/br-states-geojson');
}

/** Dispara normalização básica (IBGE + regras) em segundo plano via contacts API. */
export async function apiNormalizeBatch(opts: { batchSize?: number } = {}): Promise<{ ok: boolean; message: string }> {
  return apiFetchJson('/api/contacts/normalize-batch', {
    method: 'POST',
    body: JSON.stringify(opts)
  });
}

/** Dispara normalização full (ViaCEP) via contacts API paginada. */
export async function apiNormalizeAddressesFull(opts: { offset?: number; limit?: number } = {}): Promise<{
  ok: boolean;
  scanned: number;
  updated: number;
  samples: Array<{ from: string; to: string }>;
  hasMore: boolean;
  nextOffset: number;
}> {
  return apiFetchJson('/api/contacts/normalize-addresses', {
    method: 'POST',
    body: JSON.stringify(opts)
  });
}
