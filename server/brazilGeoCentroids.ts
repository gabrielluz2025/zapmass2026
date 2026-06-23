import { phoneDigitsToUf } from '../src/utils/brazilPhoneGeo.js';
import { spreadCityInUf } from '../src/utils/ufCitySpread.js';

/** Centróides aproximados por UF (mapa imediato sem Google — DDD / estado). */
export const UF_CENTER: Record<string, { lat: number; lng: number }> = {
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
  SC: { lat: -27.595, lng: -48.548 },
  SE: { lat: -10.947, lng: -37.073 },
  SP: { lat: -23.55, lng: -46.633 },
  TO: { lat: -10.184, lng: -48.333 }
};

/** Coordenada aproximada por DDD (espalha dentro da UF). */
export function dddToApproxCoord(ddd: string): { lat: number; lng: number } | null {
  const d = String(ddd || '').replace(/\D/g, '').slice(0, 2);
  if (d.length < 2) return null;
  const uf = phoneDigitsToUf(d + '900000000');
  if (!uf || !UF_CENTER[uf]) return null;
  const base = UF_CENTER[uf];
  const n = parseInt(d, 10) || 0;
  const latOff = ((n % 5) - 2) * 0.38;
  const lngOff = ((n % 7) - 3) * 0.38;
  return { lat: base.lat + latOff, lng: base.lng + lngOff };
}

export function ufToCoord(uf: string): { lat: number; lng: number } | null {
  const key = String(uf || '').trim().toUpperCase().slice(0, 2);
  return UF_CENTER[key] ?? null;
}

export function phoneToDdd(phone: string): string | null {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  if (d.length < 10) return null;
  return d.slice(0, 2);
}

function normKeyPart(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Coordenadas conhecidas (cidade+UF) — mapa imediato sem Google Geocoding. */
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  scblumenau: { lat: -26.9194, lng: -49.0661 },
  scgaspar: { lat: -26.9318, lng: -48.9589 },
  scindaial: { lat: -26.8978, lng: -49.2317 },
  sctimbo: { lat: -26.8241, lng: -49.2722 },
  scpuerre: { lat: -26.9256, lng: -49.3703 },
  scbrusque: { lat: -27.098, lng: -48.9178 },
  scjoinville: { lat: -26.3045, lng: -48.8487 },
  scflorianopolis: { lat: -27.5954, lng: -48.548 },
  scitajai: { lat: -26.9078, lng: -48.6619 },
  scbalneariocamboriu: { lat: -26.9906, lng: -48.6348 },
  spblumenau: { lat: -26.9194, lng: -49.0661 },
  spsaoPaulo: { lat: -23.5505, lng: -46.6333 },
  sprj: { lat: -22.9068, lng: -43.1729 }
};

/** Posição aproximada por cidade (tabela conhecida ou espiral dentro da UF). */
export function cityToApproxCoord(city: string, state: string): { lat: number; lng: number } | null {
  return spreadCityInUf(city, state);
}

export const UF_NAMES: Record<string, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AM: 'Amazonas',
  AP: 'Amapá',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso',
  PA: 'Pará',
  PB: 'Paraíba',
  PE: 'Pernambuco',
  PI: 'Piauí',
  PR: 'Paraná',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RO: 'Rondônia',
  RR: 'Roraima',
  RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina',
  SE: 'Sergipe',
  SP: 'São Paulo',
  TO: 'Tocantins'
};
