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

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length]!;
}

function pickIbgeMatch(
  matches: IbgeMunicipio[],
  hints: string[]
): IbgeMunicipio {
  let pick = matches[0]!;
  if (matches.length > 1 && hints.length > 0) {
    for (const h of hints) {
      const hit = matches.find((m) => m.uf === h);
      if (hit) {
        pick = hit;
        break;
      }
    }
  }
  return pick;
}

function ibgeResult(m: IbgeMunicipio) {
  return {
    city: titleCaseIbgeName(m.nome),
    state: m.uf,
    ibgeId: m.id
  };
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

  return ibgeResult(pickIbgeMatch(matches, hints));
}

/** Corrige grafia quebrada (Indalal → Indaial, Antnio → Antônio Carlos) via IBGE. */
export function fuzzyResolveCityWithIbge(
  index: IbgeCityIndex | null | undefined,
  input: {
    city: string;
    stateHint?: string;
    phoneUf?: string;
    parsedEmbeddedUf?: string;
  }
): { city: string; state: string; ibgeId?: number } | null {
  const exact = resolveCityWithIbge(index, input);
  if (exact) return exact;
  if (!index || index.size === 0) return null;

  const key = normCityKey(input.city);
  if (!key || key.length < 3) return null;

  const hints = [
    input.stateHint?.toUpperCase().slice(0, 2),
    input.parsedEmbeddedUf?.toUpperCase().slice(0, 2),
    input.phoneUf?.toUpperCase().slice(0, 2)
  ].filter(Boolean) as string[];
  const stateFilter = hints[0];

  let best: { m: IbgeMunicipio; dist: number } | null = null;
  const maxDist = key.length <= 5 ? 1 : key.length <= 8 ? 2 : 3;

  for (const [idxKey, matches] of index) {
    if (Math.abs(idxKey.length - key.length) > maxDist) continue;
    const dist = levenshtein(key, idxKey);
    if (dist > maxDist) continue;
    for (const m of matches) {
      if (stateFilter && m.uf !== stateFilter) continue;
      if (!best || dist < best.dist) best = { m, dist };
    }
  }

  return best ? ibgeResult(best.m) : null;
}

/** Separa "Blumenau - SC", "Blumenau · sc", "Blumenau, SC" em cidade + UF. */
export function parseCitySearchQuery(raw: string): { cityPart: string; stateHint?: string } {
  const s = String(raw || '').trim();
  if (!s) return { cityPart: '' };

  const parts = s.split(/\s*[-–—·,/]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!.toUpperCase();
    const uf = last.length === 2 ? last : last.match(/\b([A-Z]{2})\b/)?.[1];
    if (uf && /^[A-Z]{2}$/.test(uf)) {
      return {
        cityPart: parts.slice(0, -1).join(' ').trim(),
        stateHint: uf,
      };
    }
  }

  const trailUf = s.match(/\b([A-Za-z]{2})\s*$/);
  if (trailUf && parts.length === 1) {
    const uf = trailUf[1]!.toUpperCase();
    if (/^[A-Z]{2}$/.test(uf)) {
      return {
        cityPart: s.slice(0, trailUf.index).trim().replace(/[-–—·,/]\s*$/, ''),
        stateHint: uf,
      };
    }
  }

  return { cityPart: s };
}

export type IbgeCitySuggestion = {
  city: string;
  state: string;
  ibgeId?: number;
};

/** Busca municípios no índice IBGE — prefixo, contém, sem acento, com UF opcional. */
export function searchIbgeCities(
  index: IbgeCityIndex | null | undefined,
  query: string,
  limit = 12
): IbgeCitySuggestion[] {
  if (!index || index.size === 0) return [];
  const { cityPart, stateHint } = parseCitySearchQuery(query);
  const q = normCityKey(cityPart);
  if (!q || q.length < 2) return [];

  const scored: Array<IbgeCitySuggestion & { score: number }> = [];

  for (const [key, entries] of index) {
    let score: number | null = null;
    if (key === q) score = 0;
    else if (key.startsWith(q)) score = 1 + (key.length - q.length) * 0.01;
    else if (q.length >= 3 && key.includes(q)) score = 2 + key.indexOf(q) * 0.01;
    else if (q.length >= 4 && key.startsWith(q.slice(0, Math.min(4, q.length)))) score = 2.5;

    if (score === null) continue;
    for (const e of entries) {
      if (stateHint && e.uf !== stateHint) continue;
      scored.push({
        city: titleCaseIbgeName(e.nome),
        state: e.uf,
        ibgeId: e.id,
        score,
      });
    }
  }

  scored.sort(
    (a, b) => a.score - b.score || a.city.localeCompare(b.city, 'pt-BR') || a.state.localeCompare(b.state)
  );

  const seen = new Set<string>();
  const out: IbgeCitySuggestion[] = [];
  for (const item of scored) {
    const k = `${normCityKey(item.city)}|${item.state}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ city: item.city, state: item.state, ibgeId: item.ibgeId });
    if (out.length >= limit) break;
  }

  if (out.length < limit) {
    const fuzzy = fuzzyResolveCityWithIbge(index, { city: cityPart, stateHint });
    if (fuzzy) {
      const k = `${normCityKey(fuzzy.city)}|${fuzzy.state}`;
      if (!seen.has(k)) out.push(fuzzy);
    }
  }

  return out.slice(0, limit);
}

/** Resolve texto digitado para cidade+UF canônicos (IBGE). */
export function resolveCitySearchLabel(
  index: IbgeCityIndex | null | undefined,
  query: string
): { city: string; state: string; label: string } | null {
  const { cityPart, stateHint } = parseCitySearchQuery(query);
  if (!cityPart || cityPart.length < 2) return null;

  if (stateHint) {
    const exact = resolveCityWithIbge(index, { city: cityPart, stateHint });
    if (exact) return { ...exact, label: `${exact.city} · ${exact.state}` };
  }

  const hit = searchIbgeCities(index, query, 1)[0];
  if (hit) return { city: hit.city, state: hit.state, label: `${hit.city} · ${hit.state}` };
  return null;
}
