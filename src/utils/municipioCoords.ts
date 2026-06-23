/** Coordenadas reais de municípios brasileiros (fonte: IBGE via kelvins/municipios-brasileiros). */

export type MunicipioCoordsIndex = Record<string, Record<string, [number, number]>>;

let index: MunicipioCoordsIndex | null = null;
let loadPromise: Promise<MunicipioCoordsIndex> | null = null;

function normKey(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function lookupMunicipioCoord(
  city: string,
  uf: string,
  coordsIndex: MunicipioCoordsIndex | null | undefined
): { lat: number; lng: number } | null {
  if (!coordsIndex) return null;
  const st = String(uf || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const key = normKey(city.split('·')[0] || city);
  if (!st || !key) return null;
  const hit = coordsIndex[st]?.[key];
  if (!hit) return null;
  return { lat: hit[0], lng: hit[1] };
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
