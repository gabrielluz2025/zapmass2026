/** Lookup de municípios brasileiros (fonte: API localidades IBGE). */

export type IbgeMunicipio = {
  id: number;
  nome: string;
  uf: string;
};

export type IbgeCityIndex = Map<string, IbgeMunicipio[]>;

export function normCityKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

export function buildIbgeCityIndex(municipios: IbgeMunicipio[]): IbgeCityIndex {
  const index: IbgeCityIndex = new Map();
  for (const m of municipios) {
    const key = normCityKey(m.nome);
    if (!key) continue;
    const list = index.get(key) || [];
    list.push(m);
    index.set(key, list);
  }
  return index;
}

function titleCaseIbgeName(nome: string): string {
  const lowerParticles = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const lo = w.toLocaleLowerCase('pt-BR');
      if (i > 0 && lowerParticles.has(lo)) return lo;
      return lo.charAt(0).toLocaleUpperCase('pt-BR') + lo.slice(1);
    })
    .join(' ');
}

export function resolveCityWithIbge(
  index: IbgeCityIndex | null | undefined,
  input: {
    city: string;
    stateHint?: string;
    phoneUf?: string;
    parsedEmbeddedUf?: string;
  }
): { city: string; state: string; ibgeId?: number } | null {
  if (!index || index.size === 0) return null;
  const key = normCityKey(input.city);
  if (!key) return null;

  const matches = index.get(key);
  if (!matches || matches.length === 0) return null;

  const hints = [
    input.stateHint?.toUpperCase().slice(0, 2),
    input.parsedEmbeddedUf?.toUpperCase().slice(0, 2),
    input.phoneUf?.toUpperCase().slice(0, 2)
  ].filter(Boolean) as string[];

  let pick = matches[0];
  if (matches.length > 1 && hints.length > 0) {
    for (const h of hints) {
      const hit = matches.find((m) => m.uf === h);
      if (hit) {
        pick = hit;
        break;
      }
    }
  }

  return {
    city: titleCaseIbgeName(pick.nome),
    state: pick.uf,
    ibgeId: pick.id
  };
}
