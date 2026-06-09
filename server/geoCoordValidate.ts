import { cityToApproxCoord, ufToCoord } from './brazilGeoCentroids.js';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Corrige sinal invertido ou lat/lng trocados (causa comum de pins no oceano). */
export function fixBrazilCoord(lat: number, lng: number): { lat: number; lng: number } {
  let la = Number(lat);
  let ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return { lat: la, lng: ln };

  if (ln > 0 && ln <= 75) ln = -ln;
  if (la > 0 && la <= 35) la = -la;

  if (la >= -75 && la <= -32 && ln >= -35 && ln <= 5) {
    const tmp = la;
    la = ln;
    ln = tmp;
    if (ln > 0 && ln <= 75) ln = -ln;
    if (la > 0 && la <= 35) la = -la;
  }

  return { lat: la, lng: ln };
}

export function isInsideBrazilBounds(lat: number, lng: number): boolean {
  return lat >= -35 && lat <= 6 && lng >= -75 && lng <= -32;
}

/** Rejeita coordenadas fora do Brasil ou muito longe da cidade cadastrada. */
export function isCoordPlausibleForCity(
  lat: number,
  lng: number,
  city: string,
  state: string,
  maxKm = 55
): boolean {
  const fixed = fixBrazilCoord(lat, lng);
  if (!isInsideBrazilBounds(fixed.lat, fixed.lng)) return false;

  const cityTrim = String(city || '').trim();
  const stateTrim = String(state || '').trim();
  if (!cityTrim && !stateTrim) return false;

  const ref =
    cityToApproxCoord(cityTrim, stateTrim) ||
    (stateTrim ? ufToCoord(stateTrim) : null);
  if (!ref) return false;

  const radius = cityTrim ? maxKm : Math.max(maxKm, 280);
  return haversineKm(ref.lat, ref.lng, fixed.lat, fixed.lng) <= radius;
}
