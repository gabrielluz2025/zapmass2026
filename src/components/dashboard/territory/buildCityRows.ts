import type { Contact } from '../../../types';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import type { GeoCluster } from '../../../services/leadsGeoApi';
import { parseGeoFilterCity, resolveContactCityState } from '../../../utils/contactAddressNormalize';
import { approxCityCoord, isCoordPlausibleForCity } from '../../../utils/contactGeoValidate';
import { resolveBrazilStateCode } from '../../../utils/territoryRegionFilter';
import {
  dominantNeighborhoodTemp,
  normalizeKey,
  type NbTempStats,
} from './territoryMapUtils';
import type { NeighborhoodRow } from './types';

function emptyStats(label: string): NbTempStats {
  return { label, hot: 0, warm: 0, cold: 0, new: 0, total: 0, clusterCount: 0 };
}

function cityLabelFromContact(c: Contact): string {
  const resolved = resolveContactCityState({
    city: c.city,
    state: c.state,
    phone: c.phone,
  });
  const city = resolved.city.trim();
  const st = resolved.state.trim().toUpperCase().slice(0, 2);
  if (!city) return '';
  return st ? `${city} · ${st}` : city;
}

function cityKey(label: string): string {
  return normalizeKey(label).replace(/\s+/g, '');
}

function mergeCityClusters(
  map: Map<string, NbTempStats>,
  clusters: GeoCluster[],
  stateCode: string
): void {
  const uf = resolveBrazilStateCode(stateCode) || stateCode;
  for (const cl of clusters) {
    if (cl.precision !== 'city' && !cl.label.includes('·')) continue;
    if (normalizeKey(cl.state || '') !== normalizeKey(uf)) continue;
    const label = cl.label.includes('·') ? cl.label : `${cl.city} · ${cl.state || uf}`;
    const key = cityKey(label);
    const slot = map.get(key) || emptyStats(label);
    slot.clusterCount = Math.max(slot.clusterCount || 0, cl.count);
    if (!map.has(key)) map.set(key, slot);
  }
}

function coordForCity(
  label: string,
  clusters: GeoCluster[],
  stateCode: string
): { lat: number | null; lng: number | null } {
  const key = cityKey(label);
  const uf = resolveBrazilStateCode(stateCode) || stateCode;
  const cityName = label.split('·')[0]?.trim() || label;
  const cluster = clusters.find((c) => {
    if (normalizeKey(c.state || '') !== normalizeKey(uf)) return false;
    if (cityKey(c.label) === key) return true;
    return c.precision === 'city' && normalizeKey(c.city) === normalizeKey(cityName);
  });
  if (cluster?.lat != null && cluster?.lng != null) {
    if (isCoordPlausibleForCity(cluster.lat, cluster.lng, cityName, uf, 95)) {
      return { lat: cluster.lat, lng: cluster.lng };
    }
  }
  const parsed = parseGeoFilterCity(label);
  const parsedCityName = parsed.city || cityName;
  const st = parsed.state || uf;
  const approx = approxCityCoord(parsedCityName, st);
  return approx ? { lat: approx.lat, lng: approx.lng } : { lat: null, lng: null };
}

/** Agrega contatos por município dentro de uma UF (visão estado). */
export function buildCityRows(input: {
  contacts: Contact[];
  stateCode: string;
  tempsByContact: Record<string, { temp: ContactTemperature }>;
  clusters: GeoCluster[];
}): NeighborhoodRow[] {
  const uf = resolveBrazilStateCode(input.stateCode) || input.stateCode;
  const statsMap = new Map<string, NbTempStats>();

  for (const c of input.contacts) {
    const resolved = resolveContactCityState({
      city: c.city,
      state: c.state,
      phone: c.phone,
    });
    const contactUf =
      resolveBrazilStateCode(resolved.state) ||
      resolved.state.trim().toUpperCase().slice(0, 2);
    if (contactUf !== uf) continue;

    const label = cityLabelFromContact(c);
    if (!label) continue;
    const key = cityKey(label);
    const slot = statsMap.get(key) || emptyStats(label);
    if (!statsMap.has(key)) statsMap.set(key, slot);

    const t = input.tempsByContact[c.id]?.temp || 'new';
    slot[t]++;
    slot.total++;
  }

  mergeCityClusters(statsMap, input.clusters, uf);

  const rows: NeighborhoodRow[] = [];
  for (const stats of statsMap.values()) {
    if (stats.total <= 0 && (stats.clusterCount || 0) <= 0) continue;
    const { lat, lng } = coordForCity(stats.label, input.clusters, uf);
    rows.push({
      key: cityKey(stats.label),
      label: stats.label,
      count: Math.max(stats.total, stats.clusterCount || 0),
      hot: stats.hot,
      warm: stats.warm,
      cold: stats.cold,
      new: stats.new,
      lat,
      lng,
      dominant: stats.total > 0 ? dominantNeighborhoodTemp(stats) : 'new',
    });
  }

  return rows
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, 'pt-BR');
    })
    .map((row, idx) => ({ ...row, index: idx + 1 }));
}
