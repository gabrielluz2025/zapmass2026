import { DEFAULT_OPERATING_CITY_LABEL, normalizeCityLabel } from './tenantOperatingLocation.js';

export type IpGeolocationResult =
  | { ok: true; cityLabel: string; latitude: number; longitude: number; countryCode?: string }
  | { ok: false; status: string; message?: string };

function titleCaseCity(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1))
    .join(' ');
}

function formatCityLabel(city: string, region: string, countryCode: string): string {
  const cityName = titleCaseCity(city);
  if (!cityName) return DEFAULT_OPERATING_CITY_LABEL;
  const cc = String(countryCode || '').trim().toUpperCase();
  const reg = String(region || '').trim().toUpperCase();
  if (cc === 'BR' && /^[A-Z]{2}$/.test(reg)) {
    return normalizeCityLabel(`${cityName} · ${reg}`);
  }
  if (reg) return normalizeCityLabel(`${cityName} · ${reg}`);
  return normalizeCityLabel(cityName);
}

export function isIpGeolocationEnabled(): boolean {
  return process.env.IP_GEO_DISABLED !== '1';
}

async function fetchIpApi(ip: string): Promise<IpGeolocationResult> {
  const fields = 'status,message,countryCode,region,regionName,city,lat,lon';
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}&lang=pt-BR`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, status: 'HTTP_ERROR', message: `ip-api retornou ${res.status}.` };
    }
    const data = (await res.json()) as {
      status?: string;
      message?: string;
      countryCode?: string;
      region?: string;
      regionName?: string;
      city?: string;
      lat?: number;
      lon?: number;
    };
    if (data.status !== 'success') {
      return {
        ok: false,
        status: data.status || 'FAIL',
        message: data.message || 'ip-api sem resultado.'
      };
    }
    const lat = Number(data.lat);
    const lng = Number(data.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, status: 'INVALID_COORDS', message: 'Coordenadas inválidas (ip-api).' };
    }
    return {
      ok: true,
      cityLabel: formatCityLabel(data.city || data.regionName || '', data.region || '', data.countryCode || ''),
      latitude: lat,
      longitude: lng,
      countryCode: data.countryCode
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIpWhoIs(ip: string): Promise<IpGeolocationResult> {
  const url = `https://ipwho.is/${encodeURIComponent(ip)}?lang=pt`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, status: 'HTTP_ERROR', message: `ipwho.is retornou ${res.status}.` };
    }
    const data = (await res.json()) as {
      success?: boolean;
      message?: string;
      country_code?: string;
      region_code?: string;
      city?: string;
      latitude?: number;
      longitude?: number;
    };
    if (!data.success) {
      return {
        ok: false,
        status: 'FAIL',
        message: data.message || 'ipwho.is sem resultado.'
      };
    }
    const lat = Number(data.latitude);
    const lng = Number(data.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, status: 'INVALID_COORDS', message: 'Coordenadas inválidas (ipwho.is).' };
    }
    return {
      ok: true,
      cityLabel: formatCityLabel(data.city || '', data.region_code || '', data.country_code || ''),
      latitude: lat,
      longitude: lng,
      countryCode: data.country_code
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Geolocalização aproximada por IP (sem permissão do navegador).
 */
export async function resolveIpGeolocation(ip: string): Promise<IpGeolocationResult> {
  if (!isIpGeolocationEnabled()) {
    return { ok: false, status: 'DISABLED', message: 'Geolocalização por IP desativada.' };
  }

  const trimmed = String(ip || '').trim();
  if (!trimmed) {
    return { ok: false, status: 'NO_IP', message: 'IP do cliente indisponível.' };
  }

  const primary = await fetchIpApi(trimmed);
  if (primary.ok) return primary;

  const fallback = await fetchIpWhoIs(trimmed);
  if (fallback.ok) return fallback;

  const errStatus =
    fallback.ok === false ? fallback.status : primary.ok === false ? primary.status : 'FAIL';
  const errMessage =
    fallback.ok === false
      ? fallback.message
      : primary.ok === false
        ? primary.message
        : 'Não foi possível localizar pelo IP.';

  return {
    ok: false,
    status: errStatus,
    message: errMessage
  };
}
