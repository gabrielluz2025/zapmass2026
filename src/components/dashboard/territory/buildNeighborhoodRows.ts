import type { Contact } from '../../../types';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import type { GeoCluster } from '../../../services/leadsGeoApi';
import { parseGeoFilterCity } from '../../../utils/contactAddressNormalize';
import { normNbKey, officialSpreadCoord, resolveContactNeighborhoodForCity } from '../../../../shared/officialNeighborhoods';
import { isCoordPlausibleForCity } from '../../../utils/contactGeoValidate';
import { clusterMatchesFilterCity, clusterMatchesFilterState, dominantNeighborhoodTemp, matchesCity, matchesNeighborhood, matchesStateContact, normalizeKey, type NbTempStats } from './territoryMapUtils';
import { resolveBrazilStateCode } from '../../../utils/territoryRegionFilter';
import type { NeighborhoodRow } from './types';

function emptyStats(label: string): NbTempStats {
  return { label, hot: 0, warm: 0, cold: 0, new: 0, total: 0, clusterCount: 0 };
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
      if (!matchesStateContact(c, stateCode)) continue;
    }

    let nbLabel = (c.neighborhood || '').trim();
    if (officialList && officialList.length > 0 && scope === 'city') {
      nbLabel = resolveContactNeighborhoodForCity(cityName, stateCode, nbLabel, officialList);
    } else if (!nbLabel) {
      nbLabel = 'Sem bairro';
    }

    const key = normNbKey(nbLabel) || normalizeKey(nbLabel).replace(/\s+/g, '') || 'sem';
    const slot = map.get(key) || emptyStats(nbLabel);
    if (!map.has(key)) {
      if (officialList && officialList.length > 0 && scope === 'city') {
        const inList = officialList.some((n) => normNbKey(n) === key);
        const isSem = key === normNbKey('Sem bairro');
        if (!inList && !isSem) continue;
      }
      map.set(key, slot);
    }

    const t = tempsByContact[c.id]?.temp || 'new';
    slot[t]++;
    slot.total++;
  }

  return map;
}

function clusterNeighborhoodLabel(cluster: GeoCluster): string {
  return (cluster.label.split('·')[0]?.trim() || cluster.neighborhood || cluster.label).trim();
}

function mergeClusterNeighborhoods(
  map: Map<string, NbTempStats>,
  clusters: GeoCluster[],
  cityName: string,
  stateCode: string,
  officialList: string[] | null
): void {
  const cityFilter = stateCode ? `${cityName} · ${stateCode}` : cityName;
  for (const cl of clusters) {
    if (!clusterMatchesFilterCity(cl, cityFilter)) continue;
    const rawLabel = clusterNeighborhoodLabel(cl);
    if (!rawLabel || rawLabel === '—') continue;

    let label = rawLabel;
    if (officialList && officialList.length > 0) {
      label = resolveContactNeighborhoodForCity(cityName, stateCode, rawLabel, officialList);
      if (label === 'Sem bairro') continue;
    }

    const key = normNbKey(label) || normalizeKey(label).replace(/\s+/g, '') || 'sem';
    const slot = map.get(key);
    if (!slot) continue;

    slot.clusterCount = Math.max(slot.clusterCount || 0, cl.count);
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
  const cityFilter = stateCode ? `${cityName} · ${stateCode}` : cityName;
  const cluster = clusters.find((c) => {
    if (!clusterMatchesFilterCity(c, cityFilter)) return false;
    const cl = clusterNeighborhoodLabel(c);
    return normNbKey(cl) === key || normalizeKey(cl) === normalizeKey(label);
  });
  if (cluster?.lat != null && cluster?.lng != null) {
    if (isCoordPlausibleForCity(cluster.lat, cluster.lng, cityName, stateCode, 55)) {
      return { lat: cluster.lat, lng: cluster.lng };
    }
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
  filterState?: string;
}): NeighborhoodRow[] {
  const parsed = parseGeoFilterCity(input.city);
  const stateCode =
    input.filterState || parsed.state || input.city.split('·')[1]?.trim() || '';
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
      count: Math.max(stats.total, stats.clusterCount || 0),
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
    const aSem = normNbKey(a.label) === normNbKey('Sem bairro');
    const bSem = normNbKey(b.label) === normNbKey('Sem bairro');
    if (officialList) {
      if (aSem && !bSem) return 1;
      if (bSem && !aSem) return -1;
      if (ao >= 0 && bo >= 0 && ao !== bo) return ao - bo;
    }
    if (a.count === 0 && b.count > 0) return 1;
    if (b.count === 0 && a.count > 0) return -1;
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label, 'pt-BR');
  }).map((row, idx) => ({ ...row, index: idx + 1 }));
}

export function filterClustersForScope(
  clusters: GeoCluster[],
  filterLabel: string,
  scope: 'city' | 'state',
  stateCode?: string,
  _hasOfficialList?: boolean
): GeoCluster[] {
  if (scope === 'city') {
    return clusters.filter(
      (c) => c.lat != null && c.lng != null && clusterMatchesFilterCity(c, filterLabel)
    );
  }
  const uf =
    (stateCode && resolveBrazilStateCode(stateCode)) ||
    resolveBrazilStateCode(filterLabel.split('·').pop()?.trim() || '') ||
    filterLabel.split('·').pop()?.trim() ||
    '';
  if (!uf) return clusters.filter((c) => c.lat != null && c.lng != null);
  return clusters.filter(
    (c) =>
      c.lat != null &&
      c.lng != null &&
      clusterMatchesFilterState(c, uf)
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
