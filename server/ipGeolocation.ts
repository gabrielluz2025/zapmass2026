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

/**
 * Geolocalização aproximada por IP (sem permissão do navegador).
 * ip-api.com — uso no servidor; limite gratuito ~45 req/min por IP de origem.
 */
export async function resolveIpGeolocation(ip: string): Promise<IpGeolocationResult> {
  if (!isIpGeolocationEnabled()) {
    return { ok: false, status: 'DISABLED', message: 'Geolocalização por IP desativada.' };
  }

  const trimmed = String(ip || '').trim();
  if (!trimmed) {
    return { ok: false, status: 'NO_IP', message: 'IP do cliente indisponível.' };
  }

  const fields = 'status,message,countryCode,region,regionName,city,lat,lon';
  const url = `http://ip-api.com/json/${encodeURIComponent(trimmed)}?fields=${fields}&lang=pt-BR`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, status: 'HTTP_ERROR', message: `Serviço de IP retornou ${res.status}.` };
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
        message: data.message || 'Não foi possível localizar pelo IP.'
      };
    }

    const lat = Number(data.lat);
    const lng = Number(data.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, status: 'INVALID_COORDS', message: 'Coordenadas inválidas do serviço de IP.' };
    }

    const cityLabel = formatCityLabel(
      data.city || data.regionName || '',
      data.region || '',
      data.countryCode || ''
    );

    return {
      ok: true,
      cityLabel,
      latitude: lat,
      longitude: lng,
      countryCode: data.countryCode
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 'FETCH_ERROR', message: msg };
  }
}
