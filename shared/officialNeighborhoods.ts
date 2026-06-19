/**
 * Bairros oficiais por município — listas curadas + OpenStreetMap (Overpass API).
 */
import { BLUMENAU_OFFICIAL_NEIGHBORHOODS, BLUMENAU_NB_ALIASES } from './blumenauNeighborhoods.js';

export const INDAIAL_OFFICIAL_NEIGHBORHOODS = [
  'Arapongas',
  'Benedito',
  'Carijós',
  'Centro',
  'Das Nações',
  'Do Sol',
  'Dos Estados',
  'Encano Baixo',
  'Encano do Norte',
  'Estrada das Areias',
  'Estradinha',
  'João Paulo II',
  'Mulde',
  'Ribeirão das Pedras',
  'Rio Morto',
  'Tapajós',
  'Warnow',
] as const;

export type CityOfficialEntry = {
  city: string;
  state: string;
  neighborhoods: readonly string[];
  aliases?: Record<string, string>;
};

const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  scblumenau: { lat: -26.9194, lng: -49.0661 },
  scindaial: { lat: -26.8978, lng: -49.2317 },
};

const STATIC_REGISTRY: CityOfficialEntry[] = [
  {
    city: 'Blumenau',
    state: 'SC',
    neighborhoods: BLUMENAU_OFFICIAL_NEIGHBORHOODS,
    aliases: Object.fromEntries(
      Object.entries(BLUMENAU_NB_ALIASES).map(([k, v]) => [k, v as string])
    ),
  },
  {
    city: 'Indaial',
    state: 'SC',
    neighborhoods: INDAIAL_OFFICIAL_NEIGHBORHOODS,
    aliases: {
      sol: 'Do Sol',
      dosol: 'Do Sol',
      estados: 'Dos Estados',
      nacoes: 'Das Nações',
      dasnacoes: 'Das Nações',
      encano: 'Encano Baixo',
      encanobaixo: 'Encano Baixo',
      encanocentral: 'Encano Baixo',
      encanoalto: 'Encano Baixo',
      poláquia: 'Estrada das Areias',
      polaquia: 'Estrada das Areias',
      carijos: 'Carijós',
      tapajos: 'Tapajós',
      ribeiraodaspedras: 'Ribeirão das Pedras',
      joaopauloii: 'João Paulo II',
      estradadasareias: 'Estrada das Areias',
    },
  },
];

export function normNbKey(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function cityOfficialKey(city: string, state: string): string {
  return `${normNbKey(city.split('·')[0] || city)}|${String(state || '').toUpperCase().slice(0, 2)}`;
}

function findRegistryEntry(city: string, state: string): CityOfficialEntry | null {
  const cityNorm = normNbKey(city.split('·')[0] || city);
  const st = String(state || '').toUpperCase().slice(0, 2);
  return (
    STATIC_REGISTRY.find((e) => normNbKey(e.city) === cityNorm && e.state === st) || null
  );
}

export function getStaticOfficialNeighborhoods(city: string, state: string): string[] | null {
  const entry = findRegistryEntry(city, state);
  return entry ? [...entry.neighborhoods] : null;
}

export function hasStaticOfficialNeighborhoods(city: string, state: string): boolean {
  return getStaticOfficialNeighborhoods(city, state) !== null;
}

/** Compat — Blumenau. */
export function isBlumenauCity(city: string): boolean {
  const base = normNbKey(String(city || '').split('·')[0] || city);
  return base.includes('blumenau') || base === 'blumenau';
}

function matchFromEntry(entry: CityOfficialEntry, raw: string): string | null {
  const key = normNbKey(raw);
  if (!key) return null;
  if (entry.aliases?.[key]) return entry.aliases[key];
  // O próprio nome da cidade não é um bairro — evita "Blumenau" casar por substring
  // com "Jardim Blumenau" (que corromperia o bairro real do contato).
  if (key === normNbKey(entry.city)) return null;
  for (const name of entry.neighborhoods) {
    const nk = normNbKey(name);
    if (key === nk) return name;
    // Substring só quando os tamanhos são próximos (evita "blumenau" ⊂ "jardimblumenau").
    if (key.length >= 4 && nk.length >= 4 && (key.includes(nk) || nk.includes(key))) {
      const ratio = Math.min(key.length, nk.length) / Math.max(key.length, nk.length);
      if (ratio >= 0.6) return name;
    }
  }
  return null;
}

/** Mapeia bairro do cadastro para nome oficial do município (lista estática). */
export function matchCityOfficialNeighborhood(
  city: string,
  state: string,
  raw: string
): string | null {
  const entry = findRegistryEntry(city, state);
  if (!entry) return null;
  return matchFromEntry(entry, raw);
}

/** Casa bairro do contato com um nome da lista oficial/OSM do município. */
export function matchOfficialNeighborhoodInList(
  raw: string,
  officialList: readonly string[]
): string | null {
  const key = normNbKey(raw);
  if (!key) return null;
  for (const name of officialList) {
    const nk = normNbKey(name);
    if (key === nk) return name;
    if (key.length >= 4 && nk.length >= 4 && (key.includes(nk) || nk.includes(key))) return name;
  }
  return null;
}

/**
 * Normaliza bairro do contato para a lista do município.
 * Fora da lista → "Sem bairro" (evita centenas de rótulos soltos no cadastro).
 */
export function resolveContactNeighborhoodForCity(
  city: string,
  state: string,
  raw: string,
  officialList: readonly string[] | null | undefined
): string {
  const trimmed = String(raw || '').trim();
  if (!officialList || officialList.length === 0) {
    return trimmed || 'Sem bairro';
  }
  if (!trimmed) return 'Sem bairro';
  const staticMatch = matchCityOfficialNeighborhood(city, state, trimmed);
  if (staticMatch) return staticMatch;
  const listMatch = matchOfficialNeighborhoodInList(trimmed, officialList);
  if (listMatch) return listMatch;
  return 'Sem bairro';
}

/** Compat Blumenau — delega para matchCityOfficialNeighborhood. */
export function matchOfficialNeighborhoodForBlumenau(raw: string): string | null {
  return matchCityOfficialNeighborhood('Blumenau', 'SC', raw);
}

export function officialSpreadCoord(
  city: string,
  state: string,
  index: number,
  total: number
): { lat: number; lng: number } {
  const ck = `${String(state || '').toLowerCase().slice(0, 2)}${normNbKey(city)}`;
  const center = CITY_CENTERS[ck] || { lat: -14.235, lng: -51.925 };
  const angle = (index / Math.max(total, 1)) * 2 * Math.PI;
  const ring = index % 4;
  const radius = 0.008 + ring * 0.005;
  return {
    lat: center.lat + Math.cos(angle) * radius,
    lng: center.lng + Math.sin(angle) * radius * 1.12,
  };
}
