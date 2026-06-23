import type { GeoCluster } from '../../../services/leadsGeoApi';
import type { Contact } from '../../../types';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { citiesMatch, normPlaceKey, parseGeoFilterCity } from '../../../utils/contactAddressNormalize';
import { phoneDigitsToUf } from '../../../utils/brazilPhoneGeo';
import { resolveBrazilStateCode } from '../../../utils/territoryRegionFilter';
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

export function matchesCity(contactCity: string, filterCity: string, contactState?: string): boolean {
  return citiesMatch(contactCity, filterCity, contactState);
}

/** Contato pertence à UF (campo state ou DDD do telefone). */
export function matchesStateContact(contact: Contact, stateCode: string): boolean {
  const uf = String(stateCode || '').trim().toUpperCase().slice(0, 2);
  if (!uf) return true;
  const st = String(contact.state || '').trim().toUpperCase().slice(0, 2);
  if (st && st === uf) return true;
  const fromPhone = phoneDigitsToUf(contact.phone || '');
  if (fromPhone === uf) return true;
  return false;
}

export function contactStateCode(contact: Contact): string {
  const st = String(contact.state || '').trim().toUpperCase().slice(0, 2);
  if (st && resolveBrazilStateCode(st)) return st;
  return phoneDigitsToUf(contact.phone || '') || '';
}

/** Filtra clusters da API — evita bairros de outra cidade no mapa. */
export function clusterMatchesFilterCity(cluster: GeoCluster, filterCity: string): boolean {
  if (!filterCity.trim()) return true;
  const fc = parseGeoFilterCity(filterCity);
  if (!fc.city.trim()) return true;

  const clusterCity = String(cluster.city || '').trim();
  const clusterState = String(cluster.state || '').trim();

  if (clusterCity && clusterCity !== '—') {
    if (normPlaceKey(clusterCity) !== normPlaceKey(fc.city)) return false;
  }
  if (fc.state && clusterState && clusterState !== '—') {
    if (normPlaceKey(clusterState) !== normPlaceKey(fc.state)) return false;
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
  /** Contagem agregada no servidor (clusters) — pode ser maior que contatos já hidratados no client. */
  clusterCount?: number;
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
