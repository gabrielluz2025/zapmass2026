/**
 * Gera public/data/municipio_coords.json a partir da base kelvins/municipios-brasileiros.
 * Uso: node scripts/build-municipio-coords.mjs
 */
import fs from 'fs';
import path from 'path';

const UF_BY_CODE = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const url = 'https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/json/municipios.json';
const rows = await fetch(url).then((r) => r.json());
const out = {};

for (const m of rows) {
  const uf = UF_BY_CODE[m.codigo_uf];
  if (!uf) continue;
  const key = norm(m.nome);
  if (!key) continue;
  if (!out[uf]) out[uf] = {};
  out[uf][key] = [Math.round(m.latitude * 10000) / 10000, Math.round(m.longitude * 10000) / 10000];
}

const target = path.join(process.cwd(), 'public', 'geo', 'municipio_coords.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out));
console.log(`[municipio-coords] ${Object.keys(out).length} UFs → ${target}`);
