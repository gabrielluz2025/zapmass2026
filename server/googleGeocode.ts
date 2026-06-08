/** Geocodificação via Google Geocoding API (crédito mensal gratuito do Google Maps Platform). */

export function isGoogleGeocodeEnabled(): boolean {
  return Boolean((process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY || '').trim());
}

export function getGoogleMapsApiKey(): string {
  return (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY || '').trim();
}

export async function geocodeBrazilAddress(
  query: string
): Promise<{ lat: number; lng: number; formattedAddress?: string } | null> {
  const key = getGoogleMapsApiKey();
  const q = String(query || '').trim();
  if (!key || q.length < 3) return null;

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', q);
  url.searchParams.set('region', 'br');
  url.searchParams.set('language', 'pt-BR');
  url.searchParams.set('key', key);

  const r = await fetch(url.toString());
  if (!r.ok) return null;
  const j = (await r.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  if (j.status !== 'OK' || !j.results?.[0]?.geometry?.location) return null;
  const loc = j.results[0].geometry.location;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    formattedAddress: j.results[0].formatted_address
  };
}
