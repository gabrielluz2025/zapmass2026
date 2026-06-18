import fs from 'fs';
import path from 'path';
import { titleCasePlaceName } from '../src/utils/contactAddressNormalize.js';
import { resolveCityWithIbge, type IbgeCityIndex } from '../src/utils/ibgeCityLookup.js';
import {
  getStaticOfficialNeighborhoods,
  normNbKey,
} from '../shared/officialNeighborhoods.js';

const CACHE_DIR = path.join(process.cwd(), 'data', 'ibge_neighborhoods');
const FETCH_TIMEOUT_MS = 8_000;

type IbgeNamedRow = { id?: number; nome?: string };

function readCache(ibgeId: number): string[] | null {
  try {
    const raw = fs.readFileSync(path.join(CACHE_DIR, `${ibgeId}.json`), 'utf8');
    const j = JSON.parse(raw) as { neighborhoods?: string[] };
    if (!Array.isArray(j.neighborhoods)) return null;
    return j.neighborhoods;
  } catch {
    return null;
  }
}

function writeCache(ibgeId: number, neighborhoods: string[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CACHE_DIR, `${ibgeId}.json`),
      JSON.stringify({ at: new Date().toISOString(), neighborhoods }, null, 0),
      'utf8'
    );
  } catch {
    /* cache opcional */
  }
}

async function fetchIbgeNames(url: string): Promise<string[]> {
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) return [];
  const rows = (await r.json()) as IbgeNamedRow[];
  if (!Array.isArray(rows)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const nome = titleCasePlaceName(String(row.nome || '').trim());
    if (!nome || nome.length < 2) continue;
    const k = normNbKey(nome);
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(nome);
  }
  return names.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function fetchIbgeNeighborhoodNames(ibgeId: number): Promise<string[]> {
  const sub = await fetchIbgeNames(
    `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${ibgeId}/subdistritos`
  );
  if (sub.length >= 2) return sub;

  const dist = await fetchIbgeNames(
    `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${ibgeId}/distritos`
  );
  return dist;
}

/**
 * Lista oficial de bairros/divisões do município:
 * 1) registro estático (Blumenau, Indaial…)
 * 2) cache IBGE subdistritos/distritos
 */
export async function resolveOfficialNeighborhoods(
  city: string,
  state: string,
  ibgeIndex: IbgeCityIndex | null | undefined
): Promise<string[]> {
  const staticList = getStaticOfficialNeighborhoods(city, state);
  if (staticList && staticList.length > 0) return staticList;

  const hit = resolveCityWithIbge(ibgeIndex, { city, stateHint: state });
  const ibgeId = hit?.ibgeId;
  if (!ibgeId) return [];

  const cached = readCache(ibgeId);
  if (cached && cached.length > 0) return cached;

  try {
    const fresh = await fetchIbgeNeighborhoodNames(ibgeId);
    if (fresh.length > 0) {
      writeCache(ibgeId, fresh);
      return fresh;
    }
  } catch (e) {
    console.warn('[municipalityNeighborhoods] IBGE fetch failed', city, state, e);
  }
  return [];
}
