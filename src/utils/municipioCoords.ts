/** Coordenadas reais de municípios brasileiros (fonte: IBGE via kelvins/municipios-brasileiros). */

import { isCoordLikelyOnLand } from './brazilMapCoords';

export type MunicipioCoordsIndex = Record<string, Record<string, [number, number]>>;

export type MunicipioCoordHit = {
  lat: number;
  lng: number;
  /** Chave normalizada do município IBGE (ex.: barravelha). */
  municipioKey?: string;
  /** Nome canônico para exibição (ex.: Barra Velha). */
  canonicalCity?: string;
};

let index: MunicipioCoordsIndex | null = null;
let loadPromise: Promise<MunicipioCoordsIndex> | null = null;

const MUNICIPIO_ALIASES: Record<string, Record<string, { key: string; label: string }>> = {
  SC: {
    barraco: { key: 'barravelha', label: 'Barra Velha' },
  },
};

function normKey(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length]!;
}

function titleFromNormKey(key: string): string {
  if (!key) return '';
  return key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function hitFromKey(
  coordsIndex: MunicipioCoordsIndex,
  st: string,
  key: string,
  canonicalCity?: string
): MunicipioCoordHit | null {
  const pair = coordsIndex[st]?.[key];
  if (!pair) return null;
  const [lat, lng] = pair;
  if (!isCoordLikelyOnLand(lat, lng)) return null;
  return {
    lat,
    lng,
    municipioKey: key,
    canonicalCity: canonicalCity || titleFromNormKey(key),
  };
}

export function lookupMunicipioCoord(
  city: string,
  uf: string,
  coordsIndex: MunicipioCoordsIndex | null | undefined
): { lat: number; lng: number } | null {
  const hit = resolveMunicipioCoord(city, uf, coordsIndex);
  return hit ? { lat: hit.lat, lng: hit.lng } : null;
}

/** Resolve município por alias, match exato ou fuzzy no índice IBGE da UF. */
export function resolveMunicipioCoord(
  city: string,
  uf: string,
  coordsIndex: MunicipioCoordsIndex | null | undefined
): MunicipioCoordHit | null {
  if (!coordsIndex) return null;
  const st = String(uf || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  let key = normKey(city.split('·')[0] || city);
  if (!st || !key) return null;

  const alias = MUNICIPIO_ALIASES[st]?.[key];
  if (alias) {
    const aliased = hitFromKey(coordsIndex, st, alias.key, alias.label);
    if (aliased) return aliased;
  }

  const exact = hitFromKey(coordsIndex, st, key);
  if (exact) return exact;

  const ufKeys = Object.keys(coordsIndex[st] || {});
  if (ufKeys.length === 0) return null;

  const prefix = key.slice(0, Math.min(4, key.length));
  let bestKey: string | null = null;
  let bestDist = Infinity;
  const maxDist = key.length <= 5 ? 2 : key.length <= 8 ? 3 : 4;

  for (const candidate of ufKeys) {
    if (candidate.length < 3) continue;
    const sharesPrefix = candidate.startsWith(prefix) || key.startsWith(candidate.slice(0, 4));
    if (!sharesPrefix && Math.abs(candidate.length - key.length) > maxDist) continue;
    const dist = levenshtein(key, candidate);
    if (dist > maxDist) continue;
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = candidate;
    }
  }

  if (bestKey) return hitFromKey(coordsIndex, st, bestKey);
  return null;
}

/** Carrega índice de coordenadas (cache em memória + fetch único). */
export function loadMunicipioCoords(): Promise<MunicipioCoordsIndex> {
  if (index) return Promise.resolve(index);
  if (!loadPromise) {
    loadPromise = fetch('/geo/municipio_coords.json')
      .then((r) => {
        if (!r.ok) throw new Error(`coords HTTP ${r.status}`);
        return r.json() as Promise<MunicipioCoordsIndex>;
      })
      .then((data) => {
        index = data;
        return data;
      })
      .catch(() => {
        loadPromise = null;
        return {};
      });
  }
  return loadPromise;
}

export function getMunicipioCoordsIndex(): MunicipioCoordsIndex | null {
  return index;
}
