/** Geocodificação gratuita via OpenStreetMap Nominatim (sem chave Google). */

const USER_AGENT = 'ZapMassCRM/1.0 (leads-geo-map)';

export type NominatimResult =
  | { ok: true; lat: number; lng: number; displayName?: string }
  | { ok: false; status: string };

export type NominatimReverseResult =
  | { ok: true; city: string; state: string; label: string; lat: number; lng: number }
  | { ok: false; status: string };

let lastRequestAt = 0;

async function throttleNominatim(): Promise<void> {
  const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export function isNominatimEnabled(): boolean {
  return process.env.NOMINATIM_DISABLED !== '1';
}

const BR_STATE_UF: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO'
};

function normStateKey(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function titleCaseCity(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1))
    .join(' ');
}

function resolveBrazilUf(stateRaw: string, isoCode?: string): string {
  const iso = String(isoCode || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(iso) && Object.values(BR_STATE_UF).includes(iso)) return iso;
  const st = String(stateRaw || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(st) && Object.values(BR_STATE_UF).includes(st)) return st;
  return BR_STATE_UF[normStateKey(stateRaw)] || '';
}

function formatCityLabel(city: string, state: string): string {
  const c = titleCaseCity(city);
  const uf = resolveBrazilUf(state, state);
  if (!c) return '';
  return uf ? `${c} · ${uf}` : c;
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

/** Geocodificação reversa (GPS → cidade · UF) via Nominatim. */
export async function reverseGeocodeNominatim(
  lat: number,
  lng: number
): Promise<NominatimReverseResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, status: 'INVALID_COORDS' };
  }
  if (!isNominatimEnabled()) return { ok: false, status: 'DISABLED' };

  await throttleNominatim();

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '10');
  url.searchParams.set('accept-language', 'pt-BR');

  try {
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    });
    if (!r.ok) return { ok: false, status: 'HTTP_ERROR' };
    const row = (await r.json()) as {
      lat?: string;
      lon?: string;
      address?: Record<string, string>;
    };
    const addr = row?.address || {};
    const city =
      addr.city ||
      addr.town ||
      addr.municipality ||
      addr.village ||
      addr.county ||
      '';
    const state = resolveBrazilUf(addr.state || '', addr['ISO3166-2-lvl4']?.replace(/^BR-/, ''));
    const label = formatCityLabel(city, state);
    if (!label) return { ok: false, status: 'ZERO_RESULTS' };
    const outLat = Number(row?.lat ?? lat);
    const outLng = Number(row?.lon ?? lng);
    return {
      ok: true,
      city: titleCaseCity(city),
      state,
      label,
      lat: outLat,
      lng: outLng
    };
  } catch {
    return { ok: false, status: 'NETWORK_ERROR' };
  }
}

export type NominatimStructuredInput = {
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  postalcode?: string;
};

export async function geocodeNominatimStructured(
  input: NominatimStructuredInput
): Promise<NominatimResult> {
  const street = String(input.street || '').trim();
  const city = String(input.city || '').trim();
  const state = String(input.state || '').trim();
  if (!city && !street) return { ok: false, status: 'INVALID_QUERY' };

  await throttleNominatim();

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'br');
  if (street) url.searchParams.set('street', street);
  if (city) url.searchParams.set('city', city);
  if (state) url.searchParams.set('state', state);
  url.searchParams.set('country', input.country || 'Brasil');
  if (input.postalcode) url.searchParams.set('postalcode', input.postalcode);

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
