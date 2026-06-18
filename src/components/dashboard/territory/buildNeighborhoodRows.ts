import type { Contact } from '../../../types';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import type { GeoCluster } from '../../../services/leadsGeoApi';
import { parseGeoFilterCity } from '../../../utils/contactAddressNormalize';
import {
  matchCityOfficialNeighborhood,
  normNbKey,
  officialSpreadCoord,
} from '../../../../shared/officialNeighborhoods';
import { clusterMatchesFilterCity, dominantNeighborhoodTemp, matchesCity, matchesNeighborhood, normalizeKey, type NbTempStats } from './territoryMapUtils';
import type { NeighborhoodRow } from './types';

function emptyStats(label: string): NbTempStats {
  return { label, hot: 0, warm: 0, cold: 0, new: 0, total: 0 };
}

function statsFromContacts(
  contacts: Contact[],
  city: string,
  stateCode: string,
  cityName: string,
  scope: 'city' | 'state',
  tempsByContact: Record<string, { temp: ContactTemperature }>,
  officialList: string[] | null
): Map<string, NbTempStats> {
  const map = new Map<string, NbTempStats>();

  if (officialList && officialList.length > 0 && scope === 'city') {
    for (const name of officialList) {
      map.set(normNbKey(name), emptyStats(name));
    }
  }

  for (const c of contacts) {
    if (scope === 'city') {
      if (!matchesCity(c.city || '', city, c.state || '')) continue;
    } else if (stateCode) {
      const st = normalizeKey(c.state || '');
      if (st && st !== normalizeKey(stateCode)) continue;
      if (!st && !matchesCity(c.city || '', city)) continue;
    }

    let nbLabel = (c.neighborhood || '').trim();
    if (officialList && officialList.length > 0 && scope === 'city') {
      const official = matchCityOfficialNeighborhood(cityName, stateCode, nbLabel);
      if (official) {
        nbLabel = official;
      } else if (nbLabel) {
        // Bairro fora da lista oficial — mantém como está (ex.: Sem bairro)
      }
    }
    if (!nbLabel) nbLabel = 'Sem bairro';

    const key = normNbKey(nbLabel) || normalizeKey(nbLabel).replace(/\s+/g, '') || 'sem';
    const slot = map.get(key) || emptyStats(nbLabel);
    if (!map.has(key)) map.set(key, slot);

    const t = tempsByContact[c.id]?.temp || 'new';
    slot[t]++;
    slot.total++;
  }

  return map;
}

function mergeClusterNeighborhoods(
  map: Map<string, NbTempStats>,
  clusters: GeoCluster[],
  cityName: string,
  stateCode: string,
  officialList: string[] | null
): void {
  for (const cl of clusters) {
    const rawLabel = (cl.label.split('·')[0]?.trim() || cl.neighborhood || '').trim();
    if (!rawLabel || rawLabel === '—') continue;

    let label = rawLabel;
    if (officialList && officialList.length > 0) {
      const official = matchCityOfficialNeighborhood(cityName, stateCode, rawLabel);
      if (official) label = official;
    }

    const key = normNbKey(label) || normalizeKey(label).replace(/\s+/g, '') || 'sem';
    const slot = map.get(key) || emptyStats(label);
    if (!map.has(key)) map.set(key, slot);

    if (cl.count > slot.total) {
      const delta = cl.count - slot.total;
      slot.new += delta;
      slot.total += delta;
    }
  }
}

function coordForNeighborhood(
  label: string,
  clusters: GeoCluster[],
  cityName: string,
  stateCode: string,
  officialList: string[] | null
): { lat: number | null; lng: number | null } {
  const key = normNbKey(label);
  const cluster = clusters.find((c) => {
    const cl = c.label.split('·')[0]?.trim() || c.label;
    return normNbKey(cl) === key || normalizeKey(cl) === normalizeKey(label);
  });
  if (cluster?.lat != null && cluster?.lng != null) {
    return { lat: cluster.lat, lng: cluster.lng };
  }
  if (officialList && officialList.length > 0) {
    const idx = officialList.findIndex((n) => normNbKey(n) === key);
    if (idx >= 0) {
      const { lat, lng } = officialSpreadCoord(cityName, stateCode, idx, officialList.length);
      return { lat, lng };
    }
  }
  return { lat: null, lng: null };
}

export function buildNeighborhoodRows(input: {
  contacts: Contact[];
  city: string;
  scope: 'city' | 'state';
  tempsByContact: Record<string, { temp: ContactTemperature }>;
  clusters: GeoCluster[];
  officialNeighborhoods: string[] | null;
}): NeighborhoodRow[] {
  const parsed = parseGeoFilterCity(input.city);
  const stateCode = parsed.state || input.city.split('·')[1]?.trim() || '';
  const cityName = parsed.city || input.city.split('·')[0]?.trim() || input.city;
  const officialList =
    input.scope === 'city' && input.officialNeighborhoods && input.officialNeighborhoods.length > 0
      ? input.officialNeighborhoods
      : null;

  const statsMap = statsFromContacts(
    input.contacts,
    input.city,
    stateCode,
    cityName,
    input.scope,
    input.tempsByContact,
    officialList
  );

  if (input.scope === 'city') {
    mergeClusterNeighborhoods(statsMap, input.clusters, cityName, stateCode, officialList);
  }

  const rows: NeighborhoodRow[] = [];
  let order = 0;
  for (const stats of statsMap.values()) {
    const isOfficialSlot =
      officialList && officialList.some((n) => normNbKey(n) === normNbKey(stats.label));
    if (stats.total <= 0 && input.scope === 'city' && isOfficialSlot) {
      // Mantém bairros oficiais vazios visíveis
    } else if (stats.total <= 0) {
      continue;
    }
    const { lat, lng } = coordForNeighborhood(
      stats.label,
      input.clusters,
      cityName,
      stateCode,
      officialList
    );
    rows.push({
      key: normNbKey(stats.label) || normalizeKey(stats.label),
      label: stats.label,
      count: stats.total,
      hot: stats.hot,
      warm: stats.warm,
      cold: stats.cold,
      new: stats.new,
      lat,
      lng,
      dominant: stats.total > 0 ? dominantNeighborhoodTemp(stats) : 'new',
      order: officialList ? officialList.findIndex((n) => normNbKey(n) === normNbKey(stats.label)) : order++,
    });
  }

  return rows.sort((a, b) => {
    const ao = a.order ?? 9999;
    const bo = b.order ?? 9999;
    if (officialList && ao >= 0 && bo >= 0 && ao !== bo) return ao - bo;
    if (a.count === 0 && b.count > 0) return 1;
    if (b.count === 0 && a.count > 0) return -1;
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label, 'pt-BR');
  }).map((row, idx) => ({ ...row, index: idx + 1 }));
}

export function filterClustersForScope(
  clusters: GeoCluster[],
  city: string,
  scope: 'city' | 'state',
  hasOfficialList: boolean
): GeoCluster[] {
  if (scope === 'city') {
    return clusters.filter(
      (c) => c.lat != null && c.lng != null && (hasOfficialList || clusterMatchesFilterCity(c, city))
    );
  }
  const stateCode = city.split('·')[1]?.trim();
  if (!stateCode) return clusters.filter((c) => c.lat != null && c.lng != null);
  return clusters.filter(
    (c) => c.lat != null && c.lng != null && normalizeKey(c.state || '') === normalizeKey(stateCode)
  );
}

export function sumRegionTemps(rows: NeighborhoodRow[]): Record<ContactTemperature, number> {
  const t = { hot: 0, warm: 0, cold: 0, new: 0 };
  for (const r of rows) {
    t.hot += r.hot;
    t.warm += r.warm;
    t.cold += r.cold;
    t.new += r.new;
  }
  return t;
}

export function rowMatchesTempFilter(
  row: NeighborhoodRow,
  filter: 'all' | ContactTemperature,
  showEmptyNeighborhoods = false
): boolean {
  if (filter === 'all') return showEmptyNeighborhoods || row.count > 0;
  return row[filter] > 0;
}

export { matchesNeighborhood, matchesCity };
