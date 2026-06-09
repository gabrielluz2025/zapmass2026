import { cityToApproxCoord } from './brazilGeoCentroids.js';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Rejeita coordenadas fora do Brasil ou muito longe da cidade cadastrada. */
export function isCoordPlausibleForCity(
  lat: number,
  lng: number,
  city: string,
  state: string,
  maxKm = 55
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -35 || lat > 6 || lng < -75 || lng > -32) return false;
  const cityTrim = String(city || '').trim();
  const stateTrim = String(state || '').trim();
  if (!cityTrim) return false;
  const ref = cityToApproxCoord(cityTrim, stateTrim);
  if (!ref) return true;
  return haversineKm(ref.lat, ref.lng, lat, lng) <= maxKm;
}
