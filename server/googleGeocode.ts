/** Geocodificação via Google Geocoding API (crédito mensal gratuito do Google Maps Platform). */

export function isGoogleGeocodeEnabled(): boolean {
  return Boolean((process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY || '').trim());
}

export function getGoogleMapsApiKey(): string {
  return (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY || '').trim();
}

export type GeocodeResult =
  | { ok: true; lat: number; lng: number; formattedAddress?: string }
  | { ok: false; status: string; errorMessage?: string };

export async function geocodeBrazilAddressDetailed(query: string): Promise<GeocodeResult> {
  const key = getGoogleMapsApiKey();
  const q = String(query || '').trim();
  if (!key) return { ok: false, status: 'NO_KEY', errorMessage: 'GOOGLE_MAPS_API_KEY ausente no servidor.' };
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
    return { ok: false, status, errorMessage: j.error_message };
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
