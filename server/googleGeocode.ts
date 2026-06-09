/** Geocodificação via Google Geocoding API (crédito mensal gratuito do Google Maps Platform). */

/** Chave só para Maps JavaScript API no navegador (restrição por HTTP referrer). */
export function getGoogleMapsJsApiKey(): string {
  return (process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

/** Chave para Geocoding no servidor (restrição por IP da VPS — sem referrer). */
export function getGoogleGeocodingApiKey(): string {
  return (process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

/** @deprecated use getGoogleMapsJsApiKey */
export function getGoogleMapsApiKey(): string {
  return getGoogleMapsJsApiKey() || getGoogleGeocodingApiKey();
}

export function isGoogleMapsJsEnabled(): boolean {
  return Boolean(getGoogleMapsJsApiKey());
}

export function isGoogleGeocodeEnabled(): boolean {
  return Boolean(getGoogleGeocodingApiKey());
}

export type GeocodeResult =
  | { ok: true; lat: number; lng: number; formattedAddress?: string }
  | { ok: false; status: string; errorMessage?: string };

export async function geocodeBrazilAddressDetailed(query: string): Promise<GeocodeResult> {
  const key = getGoogleGeocodingApiKey();
  const q = String(query || '').trim();
  if (!key) {
    return {
      ok: false,
      status: 'NO_KEY',
      errorMessage:
        'Configure GOOGLE_GEOCODING_API_KEY no servidor (chave com restrição por IP, sem referrer).'
    };
  }
  if (q.length < 3) return { ok: false, status: 'INVALID_QUERY' };

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', q);
  url.searchParams.set('region', 'br');
  url.searchParams.set('language', 'pt-BR');
  url.searchParams.set('key', key);

  const r = await fetch(url.toString());
  if (!r.ok) return { ok: false, status: 'HTTP_ERROR' };
  const j = (await r.json()) as {
    status?: string;
    error_message?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  const status = j.status || 'UNKNOWN';
  if (status !== 'OK' || !j.results?.[0]?.geometry?.location) {
    const msg = j.error_message || '';
    if (msg.includes('referer restrictions')) {
      return {
        ok: false,
        status,
        errorMessage:
          'A chave de Geocoding não pode ter restrição por site (referrer). Crie GOOGLE_GEOCODING_API_KEY com restrição por IP da VPS.'
      };
    }
    return { ok: false, status, errorMessage: msg || undefined };
  }
  const loc = j.results[0].geometry.location;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, status: 'INVALID_COORDS' };
  return {
    ok: true,
    lat,
    lng,
    formattedAddress: j.results[0].formatted_address
  };
}

export async function geocodeBrazilAddress(
  query: string
): Promise<{ lat: number; lng: number; formattedAddress?: string } | null> {
  const hit = await geocodeBrazilAddressDetailed(query);
  if (!hit.ok) return null;
  return { lat: hit.lat, lng: hit.lng, formattedAddress: hit.formattedAddress };
}
