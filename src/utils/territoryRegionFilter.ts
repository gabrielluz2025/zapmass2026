/** Filtro territorial — cidade ou estado (UF). */

export const BRAZIL_UF_CODES = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;

export type BrazilUf = (typeof BRAZIL_UF_CODES)[number];

export const BRAZIL_UF_NAMES: Record<BrazilUf, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AM: 'Amazonas',
  AP: 'Amapá',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso',
  PA: 'Pará',
  PB: 'Paraíba',
  PE: 'Pernambuco',
  PI: 'Piauí',
  PR: 'Paraná',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RO: 'Rondônia',
  RR: 'Roraima',
  RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina',
  SE: 'Sergipe',
  SP: 'São Paulo',
  TO: 'Tocantins',
};

const UF_NAME_TO_CODE = new Map<string, BrazilUf>(
  Object.entries(BRAZIL_UF_NAMES).map(([code, name]) => [normUfKey(name), code as BrazilUf])
);

function normUfKey(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function resolveBrazilStateCode(raw: string): BrazilUf | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && BRAZIL_UF_CODES.includes(upper as BrazilUf)) {
    return upper as BrazilUf;
  }

  const key = normUfKey(trimmed);
  const hit = UF_NAME_TO_CODE.get(key);
  if (hit) return hit;

  for (const [nameKey, code] of UF_NAME_TO_CODE) {
    if (nameKey.length >= 4 && (nameKey.includes(key) || key.includes(nameKey))) {
      return code;
    }
  }
  return null;
}

export type TerritoryRegionApply =
  | { mode: 'city'; label: string }
  | { mode: 'state'; state: BrazilUf; label: string };

export function formatStateLabel(state: BrazilUf): string {
  return `${BRAZIL_UF_NAMES[state]} · ${state}`;
}

export function searchBrazilStates(query: string, limit = 8): BrazilUf[] {
  const q = normUfKey(query);
  if (!q) return [];
  const out: BrazilUf[] = [];
  for (const code of BRAZIL_UF_CODES) {
    if (code.toLowerCase().startsWith(q) || normUfKey(BRAZIL_UF_NAMES[code]).includes(q)) {
      out.push(code);
      if (out.length >= limit) break;
    }
  }
  return out;
}
