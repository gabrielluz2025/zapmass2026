/**
 * Validação de coordenadas de contato no cliente (espelha regras do servidor).
 */
import { fixBrazilCoord, isInsideBrazilBounds, isMapCoordValid } from './brazilMapCoords';
import { spreadCityInUf } from './ufCitySpread';
import type { Contact } from '../types';
import { isBlumenauCity } from '../../shared/blumenauNeighborhoods';

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  scblumenau: { lat: -26.9194, lng: -49.0661 },
  scjoinville: { lat: -26.3045, lng: -48.8487 },
  scflorianopolis: { lat: -27.5954, lng: -48.548 },
  spsaoPaulo: { lat: -23.5505, lng: -46.6333 },
  cefortaleza: { lat: -3.717, lng: -38.543 },
};

const UF_CENTER: Record<string, { lat: number; lng: number }> = {
  SC: { lat: -27.595, lng: -48.548 },
  SP: { lat: -23.55, lng: -46.633 },
  CE: { lat: -3.717, lng: -38.543 },
  PR: { lat: -25.428, lng: -49.273 },
  RS: { lat: -30.034, lng: -51.217 },
};

function normKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cityToApproxCoord(city: string, state: string): { lat: number; lng: number } | null {
  return spreadCityInUf(city, state);
}

export function approxCityCoord(
  city: string,
  state: string,
  coordsIndex?: import('./municipioCoords').MunicipioCoordsIndex | null
): { lat: number; lng: number } | null {
  return spreadCityInUf(city, state, coordsIndex);
}

export function isCoordPlausibleForCity(
  lat: number,
  lng: number,
  city: string,
  state: string,
  maxKm = 55
): boolean {
  const fixed = fixBrazilCoord(lat, lng);
  if (!isInsideBrazilBounds(fixed.lat, fixed.lng)) return false;
  const cityTrim = String(city || '').split('·')[0].trim();
  const stateTrim = String(state || '').trim().toUpperCase().slice(0, 2);
  if (!cityTrim && !stateTrim) return false;
  const ref = cityToApproxCoord(cityTrim, stateTrim) || (stateTrim ? UF_CENTER[stateTrim] : null);
  if (!ref) return false;
  const radius = cityTrim ? maxKm : Math.min(165, Math.max(maxKm, 120));
  return haversineKm(ref.lat, ref.lng, fixed.lat, fixed.lng) <= radius;
}

/** Coordenada dentro de um raio razoável do centro da UF (visão estadual sem cidade). */
export function isCoordPlausibleForState(
  lat: number,
  lng: number,
  state: string,
  maxKm = 165
): boolean {
  const st = String(state || '').trim().toUpperCase().slice(0, 2);
  const ref = UF_CENTER[st];
  const fixed = fixBrazilCoord(lat, lng);
  if (!isInsideBrazilBounds(fixed.lat, fixed.lng)) return false;
  if (!ref) return true;
  return haversineKm(ref.lat, ref.lng, fixed.lat, fixed.lng) <= maxKm;
}

/** CEP incompatível com a cidade cadastrada (ex.: 60xxx em Blumenau). */
export function cepMatchesContactCity(zip: string, city: string, state: string): boolean {
  const digits = String(zip || '').replace(/\D/g, '');
  if (digits.length !== 8) return true;
  const cityNorm = normKey(city.split('·')[0] || city);
  const st = String(state || '').trim().toUpperCase().slice(0, 2);

  if (isBlumenauCity(city) || (cityNorm.includes('blumenau') && st === 'SC')) {
    return digits.startsWith('890');
  }
  if (cityNorm.includes('fortaleza') && st === 'CE') {
    return digits.startsWith('60');
  }
  if (cityNorm.includes('joinville') && st === 'SC') {
    return digits.startsWith('89');
  }
  return true;
}

function hasFullStreetAddress(c: {
  street?: string;
  number?: string;
}): boolean {
  return Boolean((c.street || '').trim() && (c.number || '').trim());
}

function hasTrustedGeocode(c: {
  street?: string;
  number?: string;
  geocodePrecision?: Contact['geocodePrecision'];
}): boolean {
  return (
    hasFullStreetAddress(c) ||
    c.geocodePrecision === 'street' ||
    c.geocodePrecision === 'cep'
  );
}

export type ContactCoordInput = {
  latitude?: number;
  longitude?: number;
  city?: string;
  state?: string;
  zipCode?: string;
  street?: string;
  number?: string;
  geocodePrecision?: Contact['geocodePrecision'];
};

/** Só aceita coordenada que bate com cidade/CEP e precisão confiável. */
export function resolveTrustedContactCoord(
  c: ContactCoordInput
): { lat: number; lng: number; verified: boolean } | null {
  if (c.latitude == null || c.longitude == null) return null;
  if (!cepMatchesContactCity(c.zipCode || '', c.city || '', c.state || '')) return null;

  const fixed = fixBrazilCoord(c.latitude, c.longitude);
  if (!isMapCoordValid(fixed.lat, fixed.lng)) return null;

  const city = (c.city || '').split('·')[0].trim();
  const state = (c.state || '').trim();

  if (!city && state) {
    if (isCoordPlausibleForState(fixed.lat, fixed.lng, state)) {
      return { ...fixed, verified: false };
    }
    return null;
  }

  if (hasTrustedGeocode(c)) {
    const maxKm = c.geocodePrecision === 'cep' ? 40 : 25;
    if (isCoordPlausibleForCity(fixed.lat, fixed.lng, city, state, maxKm)) {
      return { ...fixed, verified: true };
    }
    return null;
  }

  if (c.geocodePrecision === 'neighborhood') {
    if (isCoordPlausibleForCity(fixed.lat, fixed.lng, city, state, 22)) {
      return { ...fixed, verified: false };
    }
    return null;
  }

  if (isCoordPlausibleForCity(fixed.lat, fixed.lng, city, state, 18)) {
    return { ...fixed, verified: false };
  }

  return null;
}
