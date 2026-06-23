/**
 * Polígonos dos municípios por UF (IBGE) para contornos no atlas territorial.
 */
import fs from 'fs';
import path from 'path';
import { normCityKey } from '../src/utils/ibgeCityLookup.js';
import { ensureIbgeMunicipiosIndex } from './ibgeMunicipios.js';

const UF_TO_IBGE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43',
  MS: '50', MT: '51', GO: '52', DF: '53',
};

type GeoJsonFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: unknown;
};
export type MunicipiosGeoJson = { type: 'FeatureCollection'; features: GeoJsonFeature[] };

const memoryCache = new Map<string, MunicipiosGeoJson>();
const inflight = new Map<string, Promise<MunicipiosGeoJson>>();

function cachePath(uf: string): string {
  return path.join(process.cwd(), 'data', `municipios_geojson_${uf.toLowerCase()}.json`);
}

function publicCachePath(uf: string): string {
  return path.join(process.cwd(), 'public', 'geo', `municipios_${uf.toLowerCase()}.geojson`);
}

function readDiskCache(uf: string): MunicipiosGeoJson | null {
  for (const p of [publicCachePath(uf), cachePath(uf)]) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const j = JSON.parse(raw) as MunicipiosGeoJson;
      if (j?.type === 'FeatureCollection' && Array.isArray(j.features) && j.features.length > 0) {
        return j;
      }
    } catch {
      /* tenta próximo */
    }
  }
  return null;
}

function writeDiskCache(uf: string, fc: MunicipiosGeoJson): void {
  try {
    const p = cachePath(uf);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(fc), 'utf8');
  } catch {
    /* cache opcional */
  }
}

async function annotateFeatures(uf: string, fc: MunicipiosGeoJson): Promise<MunicipiosGeoJson> {
  const index = await ensureIbgeMunicipiosIndex();
  const byId = new Map<number, { nome: string; uf: string }>();
  if (index) {
    for (const list of index.values()) {
      for (const m of list) {
        byId.set(m.id, { nome: m.nome, uf: m.uf });
      }
    }
  }

  for (const f of fc.features || []) {
    const codarea = String(f.properties?.codarea ?? '').trim();
    const ibgeId = codarea ? Number(codarea) : 0;
    const hit = ibgeId > 0 ? byId.get(ibgeId) : undefined;
    const nome = hit?.nome || String(f.properties?.nome || '');
    const nameKey = normCityKey(nome);
    f.properties = {
      ...f.properties,
      uf,
      ibgeId: ibgeId || undefined,
      nome,
      nameKey,
    };
  }
  return fc;
}

async function fetchFromIbge(uf: string): Promise<MunicipiosGeoJson> {
  const code = UF_TO_IBGE[uf];
  if (!code) throw new Error(`UF inválida: ${uf}`);

  const url =
    `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${code}` +
    `?formato=application/vnd.geo+json&qualidade=intermediaria&intrarregiao=municipio`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`IBGE respondeu ${resp.status}`);
    const fc = (await resp.json()) as MunicipiosGeoJson;
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
      throw new Error('GeoJSON inválido do IBGE');
    }
    return annotateFeatures(uf, fc);
  } finally {
    clearTimeout(timer);
  }
}

export async function getMunicipiosGeoJsonByUf(ufRaw: string): Promise<MunicipiosGeoJson> {
  const uf = String(ufRaw || '').trim().toUpperCase().slice(0, 2);
  if (!UF_TO_IBGE[uf]) throw new Error(`UF inválida: ${ufRaw}`);

  const cached = memoryCache.get(uf);
  if (cached) return cached;

  const disk = readDiskCache(uf);
  if (disk) {
    const annotated = await annotateFeatures(uf, disk);
    memoryCache.set(uf, annotated);
    return annotated;
  }

  let pending = inflight.get(uf);
  if (!pending) {
    pending = (async () => {
      const fc = await fetchFromIbge(uf);
      memoryCache.set(uf, fc);
      writeDiskCache(uf, fc);
      return fc;
    })();
    inflight.set(uf, pending);
    pending.finally(() => inflight.delete(uf));
  }
  return pending;
}
