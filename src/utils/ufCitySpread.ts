import { lookupMunicipioCoord, resolveMunicipioCoord, type MunicipioCoordsIndex } from './municipioCoords';
import { isCoordLikelyOnLand } from './brazilMapCoords';

/** Posição aproximada de município dentro da UF (IBGE real ou espiral de fallback). */

const UF_CENTER: Record<string, { lat: number; lng: number }> = {
  AC: { lat: -9.974, lng: -67.81 },
  AL: { lat: -9.665, lng: -35.735 },
  AM: { lat: -3.119, lng: -60.021 },
  AP: { lat: 0.034, lng: -51.069 },
  BA: { lat: -12.971, lng: -38.501 },
  CE: { lat: -3.717, lng: -38.543 },
  DF: { lat: -15.794, lng: -47.882 },
  ES: { lat: -20.315, lng: -40.312 },
  GO: { lat: -16.686, lng: -49.264 },
  MA: { lat: -2.53, lng: -44.306 },
  MG: { lat: -19.916, lng: -43.934 },
  MS: { lat: -20.469, lng: -54.62 },
  MT: { lat: -15.601, lng: -56.097 },
  PA: { lat: -1.455, lng: -48.502 },
  PB: { lat: -7.119, lng: -34.845 },
  PE: { lat: -8.047, lng: -34.877 },
  PI: { lat: -5.089, lng: -42.801 },
  PR: { lat: -25.428, lng: -49.273 },
  RJ: { lat: -22.906, lng: -43.172 },
  RN: { lat: -5.794, lng: -35.211 },
  RO: { lat: -8.761, lng: -63.903 },
  RR: { lat: 2.823, lng: -60.675 },
  RS: { lat: -30.034, lng: -51.217 },
  SC: { lat: -27.35, lng: -49.15 },
  SE: { lat: -10.947, lng: -37.073 },
  SP: { lat: -23.55, lng: -46.633 },
  TO: { lat: -10.184, lng: -48.333 },
};

/** Extensão típica da UF em graus (para espalhar municípios sem sobrepor tudo). */
const UF_SPAN: Record<string, { lat: number; lng: number }> = {
  SC: { lat: 2.4, lng: 3.2 },
  PR: { lat: 3.0, lng: 4.0 },
  RS: { lat: 3.5, lng: 4.2 },
  SP: { lat: 4.5, lng: 5.5 },
};

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  scblumenau: { lat: -26.9194, lng: -49.0661 },
  scgaspar: { lat: -26.9318, lng: -48.9589 },
  scindaial: { lat: -26.8978, lng: -49.2317 },
  sctimbo: { lat: -26.8241, lng: -49.2722 },
  scbrusque: { lat: -27.098, lng: -48.9178 },
  scjoinville: { lat: -26.3045, lng: -48.8487 },
  scflorianopolis: { lat: -27.5954, lng: -48.548 },
  scitajai: { lat: -26.9078, lng: -48.6619 },
  scbalneariocamboriu: { lat: -26.9906, lng: -48.6348 },
  sccamboriu: { lat: -27.028, lng: -48.653 },
  prcuritiba: { lat: -25.428, lng: -49.273 },
};

function normKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Coordenada aproximada por cidade+UF (IBGE, tabela conhecida ou espiral dentro da UF). */
export function spreadCityInUf(
  city: string,
  state: string,
  coordsIndex?: MunicipioCoordsIndex | null
): { lat: number; lng: number } | null {
  const st = String(state || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const cityNorm = normKey(city.split('·')[0] || city);
  if (!cityNorm) return null;

  const ibge = resolveMunicipioCoord(city, st, coordsIndex);
  if (ibge) return { lat: ibge.lat, lng: ibge.lng };

  const known = CITY_COORDS[`${st.toLowerCase()}${cityNorm}`];
  if (known) return known;

  const base = UF_CENTER[st];
  if (!base) return null;

  let hash = 0;
  for (const ch of cityNorm) hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_000;

  const golden = Math.PI * (3 - Math.sqrt(5));
  const angle = hash * golden;
  const t = ((hash % 991) + 1) / 992;
  const r = 0.12 + Math.sqrt(t) * 0.88;

  const span = UF_SPAN[st] || { lat: 2.8, lng: 3.6 };
  const cosLat = Math.cos((base.lat * Math.PI) / 180);

  const spread = {
    lat: base.lat + r * span.lat * 0.48 * Math.cos(angle),
    lng: base.lng + (r * span.lng * 0.48 * Math.sin(angle)) / (cosLat || 1),
  };
  return isCoordLikelyOnLand(spread.lat, spread.lng) ? spread : null;
}
