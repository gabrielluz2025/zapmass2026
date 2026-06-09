/** Geocodificação gratuita via OpenStreetMap Nominatim (sem chave Google). */

const USER_AGENT = 'ZapMassCRM/1.0 (leads-geo-map)';

export type NominatimResult =
  | { ok: true; lat: number; lng: number; displayName?: string }
  | { ok: false; status: string };

let lastRequestAt = 0;

async function throttleNominatim(): Promise<void> {
  const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export async function geocodeNominatim(query: string): Promise<NominatimResult> {
  const q = String(query || '').trim();
  if (q.length < 3) return { ok: false, status: 'INVALID_QUERY' };

  await throttleNominatim();

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'br');

  try {
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    });
    if (!r.ok) return { ok: false, status: 'HTTP_ERROR' };
    const rows = (await r.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const hit = rows?.[0];
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, status: 'ZERO_RESULTS' };
    return { ok: true, lat, lng, displayName: hit?.display_name };
  } catch {
    return { ok: false, status: 'NETWORK_ERROR' };
  }
}

export function isNominatimEnabled(): boolean {
  return process.env.NOMINATIM_DISABLED !== '1';
}
