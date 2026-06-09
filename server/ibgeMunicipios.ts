import fs from 'fs';
import path from 'path';
import {
  buildIbgeCityIndex,
  type IbgeCityIndex,
  type IbgeMunicipio
} from '../src/utils/ibgeCityLookup.js';

const CACHE_PATH = path.join(process.cwd(), 'data', 'ibge_municipios.json');
const IBGE_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';

let index: IbgeCityIndex | null = null;
let loadPromise: Promise<IbgeCityIndex> | null = null;

type IbgeApiRow = {
  id: number;
  nome: string;
  microrregiao?: {
    mesorregiao?: {
      UF?: { sigla?: string };
    };
  };
};

function parseIbgeRows(rows: IbgeApiRow[]): IbgeMunicipio[] {
  const out: IbgeMunicipio[] = [];
  for (const row of rows) {
    const uf = String(row.microrregiao?.mesorregiao?.UF?.sigla || '')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    const nome = String(row.nome || '').trim();
    if (!nome || !uf) continue;
    out.push({ id: Number(row.id), nome, uf });
  }
  return out;
}

async function fetchFromIbgeApi(): Promise<IbgeMunicipio[]> {
  const r = await fetch(IBGE_URL, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`IBGE HTTP ${r.status}`);
  const rows = (await r.json()) as IbgeApiRow[];
  if (!Array.isArray(rows) || rows.length < 100) {
    throw new Error('Resposta IBGE inválida');
  }
  return parseIbgeRows(rows);
}

function readCacheFile(): IbgeMunicipio[] | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const j = JSON.parse(raw) as { municipios?: IbgeMunicipio[]; at?: string };
    if (!Array.isArray(j.municipios) || j.municipios.length < 100) return null;
    return j.municipios;
  } catch {
    return null;
  }
}

function writeCacheFile(municipios: IbgeMunicipio[]): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(
      CACHE_PATH,
      JSON.stringify({ at: new Date().toISOString(), municipios }, null, 0),
      'utf8'
    );
  } catch {
    /* cache opcional */
  }
}

async function loadMunicipios(): Promise<IbgeMunicipio[]> {
  const cached = readCacheFile();
  if (cached) return cached;
  const fresh = await fetchFromIbgeApi();
  writeCacheFile(fresh);
  return fresh;
}

export async function ensureIbgeMunicipiosIndex(): Promise<IbgeCityIndex> {
  if (index) return index;
  if (!loadPromise) {
    loadPromise = loadMunicipios()
      .then((rows) => {
        index = buildIbgeCityIndex(rows);
        console.log(`[ibge] ${rows.length} municípios indexados para padronização de cidades`);
        return index;
      })
      .catch((e) => {
        loadPromise = null;
        throw e;
      });
  }
  return loadPromise;
}

export function getIbgeMunicipiosIndex(): IbgeCityIndex | null {
  return index;
}

/** Atualiza cache local a partir da API IBGE (admin / deploy). */
export async function refreshIbgeMunicipiosCache(): Promise<number> {
  const fresh = await fetchFromIbgeApi();
  writeCacheFile(fresh);
  index = buildIbgeCityIndex(fresh);
  loadPromise = Promise.resolve(index);
  return fresh.length;
}
