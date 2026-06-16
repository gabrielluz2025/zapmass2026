/**
 * Polígonos dos estados brasileiros (IBGE) para o choropleth do mapa.
 *
 * Fonte: API oficial de malhas do IBGE (gratuita, sem chave):
 *   https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF
 *
 * Cada feature vem com properties.codarea = código IBGE da UF (ex.: "35" = SP).
 * Injetamos properties.uf (sigla) para o cliente cruzar com a conversão por estado.
 *
 * Cache: memória (processo) + disco (data/br_states_geojson.json) para sobreviver
 * a restarts e nunca depender do IBGE em tempo de request após a primeira carga.
 */
import fs from 'fs';
import path from 'path';

const IBGE_CODE_TO_UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'
};

const IBGE_URL =
  'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=intermediaria&intrarregiao=UF';

const CACHE_PATH = path.join(process.cwd(), 'data', 'br_states_geojson.json');

type GeoJsonFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: unknown;
};
type GeoJsonFC = { type: 'FeatureCollection'; features: GeoJsonFeature[] };

let memoryCache: GeoJsonFC | null = null;
let inflight: Promise<GeoJsonFC> | null = null;

function annotateUf(fc: GeoJsonFC): GeoJsonFC {
  for (const f of fc.features || []) {
    const code = String((f.properties?.codarea ?? f.properties?.id ?? '') as string).trim();
    const uf = IBGE_CODE_TO_UF[code];
    if (uf) {
      f.properties = { ...f.properties, uf };
    }
  }
  return fc;
}

function readDiskCache(): GeoJsonFC | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const j = JSON.parse(raw) as GeoJsonFC;
    if (j && j.type === 'FeatureCollection' && Array.isArray(j.features) && j.features.length > 0) {
      return j;
    }
  } catch {
    /* sem cache em disco */
  }
  return null;
}

function writeDiskCache(fc: GeoJsonFC): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(fc), 'utf8');
  } catch {
    /* cache opcional */
  }
}

export async function getBrazilStatesGeoJson(): Promise<GeoJsonFC> {
  if (memoryCache) return memoryCache;

  const disk = readDiskCache();
  if (disk) {
    memoryCache = annotateUf(disk);
    return memoryCache;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const resp = await fetch(IBGE_URL, { signal: controller.signal });
      if (!resp.ok) throw new Error(`IBGE respondeu ${resp.status}`);
      const fc = (await resp.json()) as GeoJsonFC;
      if (!fc || fc.type !== 'FeatureCollection') throw new Error('GeoJSON inválido do IBGE');
      const annotated = annotateUf(fc);
      memoryCache = annotated;
      writeDiskCache(annotated);
      return annotated;
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();

  return inflight;
}
