import fs from 'fs';
import path from 'path';

export type MunicipioCoordsIndex = Record<string, Record<string, [number, number]>>;

const COORDS_PATHS = [
  path.join(process.cwd(), 'dist', 'geo', 'municipio_coords.json'),
  path.join(process.cwd(), 'public', 'geo', 'municipio_coords.json'),
  path.join(process.cwd(), 'data', 'municipio_coords.json'),
];

let index: MunicipioCoordsIndex | null = null;

function normKey(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function loadIndex(): MunicipioCoordsIndex {
  if (index) return index;
  for (const p of COORDS_PATHS) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      index = JSON.parse(raw) as MunicipioCoordsIndex;
      return index;
    } catch {
      /* tenta próximo caminho */
    }
  }
  index = {};
  return index;
}

export function lookupMunicipioCoord(city: string, uf: string): { lat: number; lng: number } | null {
  const data = loadIndex();
  const st = String(uf || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const key = normKey(city.split('·')[0] || city);
  if (!st || !key) return null;
  const hit = data[st]?.[key];
  if (!hit) return null;
  return { lat: hit[0], lng: hit[1] };
}

export function getMunicipioCoordsForUf(uf: string): Record<string, [number, number]> {
  const data = loadIndex();
  const st = String(uf || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  return data[st] || {};
}
