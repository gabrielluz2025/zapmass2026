import type { Contact } from '../../../types';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import type { GeoCluster } from '../../../services/leadsGeoApi';
import {
  BLUMENAU_OFFICIAL_NEIGHBORHOODS,
  blumenauSpreadCoord,
  matchOfficialNeighborhood,
  normBlumenauNbKey,
} from '../../../../shared/blumenauNeighborhoods';
import { clusterMatchesFilterCity, dominantNeighborhoodTemp, matchesCity, matchesNeighborhood, normalizeKey, type NbTempStats } from './territoryMapUtils';
import type { NeighborhoodRow } from './types';

function emptyStats(label: string): NbTempStats {
  return { label, hot: 0, warm: 0, cold: 0, new: 0, total: 0 };
}

function statsFromContacts(
  contacts: Contact[],
  city: string,
  stateCode: string,
  scope: 'city' | 'state',
  tempsByContact: Record<string, { temp: ContactTemperature }>,
  blumenauFocus: boolean
): Map<string, NbTempStats> {
  const map = new Map<string, NbTempStats>();

  if (blumenauFocus && scope === 'city') {
    for (const name of BLUMENAU_OFFICIAL_NEIGHBORHOODS) {
      map.set(normBlumenauNbKey(name), emptyStats(name));
    }
  }

  for (const c of contacts) {
    if (scope === 'city') {
      if (!matchesCity(c.city || '', city)) continue;
    } else if (stateCode) {
      const st = normalizeKey(c.state || '');
      if (st && st !== normalizeKey(stateCode)) continue;
      if (!st && !matchesCity(c.city || '', city)) continue;
    }

    let nbLabel = (c.neighborhood || '').trim();
    if (blumenauFocus && scope === 'city') {
      const official = matchOfficialNeighborhood(nbLabel);
      if (!official) continue;
      nbLabel = official;
    }
    if (!nbLabel) nbLabel = 'Sem bairro';

    const key = normBlumenauNbKey(nbLabel) || normalizeKey(nbLabel).replace(/\s+/g, '') || 'sem';
    const slot = map.get(key) || emptyStats(nbLabel);
    if (!map.has(key)) map.set(key, slot);

    const t = tempsByContact[c.id]?.temp || 'new';
    slot[t]++;
    slot.total++;
  }

  return map;
}

function coordForNeighborhood(
  label: string,
  clusters: GeoCluster[],
  blumenauFocus: boolean
): { lat: number | null; lng: number | null } {
  const key = normBlumenauNbKey(label);
  const cluster = clusters.find((c) => {
    const cl = c.label.split('·')[0]?.trim() || c.label;
    return normBlumenauNbKey(cl) === key || normalizeKey(cl) === normalizeKey(label);
  });
  if (cluster?.lat != null && cluster?.lng != null) {
    return { lat: cluster.lat, lng: cluster.lng };
  }
  if (blumenauFocus) {
    const idx = BLUMENAU_OFFICIAL_NEIGHBORHOODS.findIndex((n) => normBlumenauNbKey(n) === key);
    if (idx >= 0) {
      const { lat, lng } = blumenauSpreadCoord(idx);
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
  blumenauFocus: boolean;
}): NeighborhoodRow[] {
  const stateCode = input.city.split('·')[1]?.trim() || '';
  const statsMap = statsFromContacts(
    input.contacts,
    input.city,
    stateCode,
    input.scope,
    input.tempsByContact,
    input.blumenauFocus && input.scope === 'city'
  );

  const rows: NeighborhoodRow[] = [];
  for (const stats of statsMap.values()) {
    if (stats.total <= 0 && input.scope === 'city' && input.blumenauFocus) {
      // Mantém bairros oficiais vazios visíveis em Blumenau
    } else if (stats.total <= 0) {
      continue;
    }
    const { lat, lng } = coordForNeighborhood(stats.label, input.clusters, input.blumenauFocus);
    rows.push({
      key: normBlumenauNbKey(stats.label) || normalizeKey(stats.label),
      label: stats.label,
      count: stats.total,
      hot: stats.hot,
      warm: stats.warm,
      cold: stats.cold,
      new: stats.new,
      lat,
      lng,
      dominant: stats.total > 0 ? dominantNeighborhoodTemp(stats) : 'new',
    });
  }

  return rows.sort((a, b) => b.count - a.count);
}

export function filterClustersForScope(
  clusters: GeoCluster[],
  city: string,
  scope: 'city' | 'state',
  blumenauFocus: boolean
): GeoCluster[] {
  if (scope === 'city') {
    return clusters.filter(
      (c) => c.lat != null && c.lng != null && (blumenauFocus || clusterMatchesFilterCity(c, city))
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

export function rowMatchesTempFilter(row: NeighborhoodRow, filter: 'all' | ContactTemperature): boolean {
  if (filter === 'all') return row.count > 0;
  return row[filter] > 0;
}

export { matchesNeighborhood, matchesCity };
