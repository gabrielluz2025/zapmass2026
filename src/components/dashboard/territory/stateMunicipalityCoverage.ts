import { normCityKey } from '../../../utils/ibgeCityLookup';
import { resolveMunicipioCoord, type MunicipioCoordsIndex } from '../../../utils/municipioCoords';
import { resolveBrazilStateCode } from '../../../utils/territoryRegionFilter';
import type { NeighborhoodRow } from './types';

export type StateMunicipalityCoverage = {
  /** Total de municípios oficiais na UF (IBGE). */
  total: number;
  /** Municípios com pelo menos um contato na base. */
  withContacts: number;
  /** Municípios sem nenhum contato. */
  withoutContacts: number;
  /** Linhas de cidade com contatos que não casam com município IBGE da UF. */
  unmappedContactCities: number;
};

/** Cobertura de contatos por município oficial (catálogo IBGE / municipio_coords). */
export function computeStateMunicipalityCoverage(
  stateCode: string,
  contactRows: NeighborhoodRow[],
  coordsIndex: MunicipioCoordsIndex | null | undefined
): StateMunicipalityCoverage | null {
  const uf = resolveBrazilStateCode(stateCode) || stateCode;
  const catalog = coordsIndex?.[uf];
  if (!catalog || Object.keys(catalog).length === 0) return null;

  const total = Object.keys(catalog).length;
  const matchedKeys = new Set<string>();
  let unmappedContactCities = 0;

  for (const row of contactRows) {
    if (row.count <= 0) continue;
    const cityName = row.label.split('·')[0]?.trim() || row.label;
    const hit = resolveMunicipioCoord(cityName, uf, coordsIndex);
    if (hit?.municipioKey) {
      matchedKeys.add(hit.municipioKey);
      continue;
    }
    const fallbackKey = normCityKey(cityName);
    if (fallbackKey && catalog[fallbackKey]) {
      matchedKeys.add(fallbackKey);
      continue;
    }
    unmappedContactCities++;
  }

  const withContacts = matchedKeys.size;
  return {
    total,
    withContacts,
    withoutContacts: Math.max(0, total - withContacts),
    unmappedContactCities,
  };
}

export function formatMunicipalityCoverageLine(c: StateMunicipalityCoverage): string {
  return `${c.withContacts.toLocaleString('pt-BR')} com contatos · ${c.withoutContacts.toLocaleString('pt-BR')} sem contatos · ${c.total.toLocaleString('pt-BR')} municípios`;
}
