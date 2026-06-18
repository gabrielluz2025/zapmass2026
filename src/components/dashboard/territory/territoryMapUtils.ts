import type { GeoCluster } from '../../../services/leadsGeoApi';
import type { Contact } from '../../../types';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import {
  BLUMENAU_OFFICIAL_NEIGHBORHOODS,
  matchOfficialNeighborhood,
  normBlumenauNbKey,
} from '../../../../shared/blumenauNeighborhoods';
import { TEMP_ORDER } from './territoryConstants';

export function normalizeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchesNeighborhood(contactNb: string, selected: string): boolean {
  const a = normalizeKey(contactNb);
  const b = normalizeKey(selected);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function matchesCity(contactCity: string, filterCity: string): boolean {
  const base = normalizeKey(filterCity.split('·')[0] || filterCity);
  const c = normalizeKey(contactCity);
  if (!base) return true;
  if (!c) return false;
  const baseToken = base.split(' ')[0] || base;
  return c.includes(baseToken) || base.includes(c.split(' ')[0] || c);
}

/** Filtra clusters da API — evita bairros de outra cidade no mapa. */
export function clusterMatchesFilterCity(cluster: GeoCluster, filterCity: string): boolean {
  if (!filterCity.trim()) return true;
  const parts = filterCity.split('·').map((p) => p.trim());
  const filterCityName = parts[0] || filterCity;
  const filterState = parts[1] || '';

  const clusterCity = String(cluster.city || '').trim();
  const clusterState = String(cluster.state || '').trim();

  if (clusterCity && !matchesCity(clusterCity, filterCityName)) return false;
  if (filterState && clusterState) {
    if (normalizeKey(clusterState) !== normalizeKey(filterState)) return false;
  }
  return true;
}

export function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return n > 0 ? String(n) : '';
}

export function rankBarVisualPct(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  return Math.round((Math.sqrt(count) / Math.sqrt(maxCount)) * 100);
}

export function formatSharePct(count: number, total: number): string {
  if (total <= 0 || count <= 0) return '0%';
  const pct = (count / total) * 100;
  return pct >= 10 ? `${Math.round(pct)}%` : pct >= 1 ? `${pct.toFixed(1)}%` : '<1%';
}

export type NbTempStats = {
  label: string;
  hot: number;
  warm: number;
  cold: number;
  new: number;
  total: number;
};

export function dominantNeighborhoodTemp(stats: NbTempStats): ContactTemperature {
  const ranked: [ContactTemperature, number][] = [
    ['hot', stats.hot],
    ['warm', stats.warm],
    ['cold', stats.cold],
    ['new', stats.new],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : 'new';
}

export function buildBlumenauNbStats(
  contacts: Contact[],
  city: string,
  tempsByContact: Record<string, { temp: ContactTemperature }>
): Map<string, NbTempStats> {
  const map = new Map<string, NbTempStats>();
  for (const name of BLUMENAU_OFFICIAL_NEIGHBORHOODS) {
    map.set(normBlumenauNbKey(name), {
      label: name,
      hot: 0,
      warm: 0,
      cold: 0,
      new: 0,
      total: 0,
    });
  }
  for (const c of contacts) {
    if (!matchesCity(c.city || '', city)) continue;
    const official = matchOfficialNeighborhood(c.neighborhood || '');
    if (!official) continue;
    const slot = map.get(normBlumenauNbKey(official));
    if (!slot) continue;
    const t = tempsByContact[c.id]?.temp || 'new';
    slot[t]++;
    slot.total++;
  }
  return map;
}
