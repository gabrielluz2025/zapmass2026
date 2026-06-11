import { phoneDigitsToUf } from './brazilPhoneGeo';
import { fuzzyResolveCityWithIbge, type IbgeCityIndex } from './ibgeCityLookup';

const BRAZIL_UFS = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
]);

const PT_PARTICLES_LOWER = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o']);

/** Fallback offline quando IBGE ainda não carregou. */
const KNOWN_CITY_UF: Record<string, string> = {
  blumenau: 'SC',
  gaspar: 'SC',
  indaial: 'SC',
  timbo: 'SC',
  pomerode: 'SC',
  brusque: 'SC',
  joinville: 'SC',
  itajai: 'SC',
  balneariocamboriu: 'SC',
  camboriu: 'SC',
  florianopolis: 'SC'
};

function normKeyPart(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Chave de lugar (cidade/bairro) sem acento nem pontuação. */
export function normPlaceKey(s: string): string {
  return normKeyPart(s);
}

/** Chave de bairro tolerante a letras duplicadas (ex.: Fortaaleza → Fortaleza). */
export function normNeighborhoodKey(s: string): string {
  return normPlaceKey(s).replace(/(.)\1+/g, '$1');
}

function collapseDoubledLetters(s: string): string {
  return s.replace(/([\p{L}])\1+/giu, '$1');
}

/** Escolhe o nome mais correto quando dois bairros são a mesma chave canônica. */
export function pickCanonicalNeighborhoodName(a: string, b: string): string {
  if (normNeighborhoodKey(a) !== normNeighborhoodKey(b)) return a;
  if (a.length !== b.length) return a.length < b.length ? a : b;
  if (/(.)\1/.test(a) && !/(.)\1/.test(b)) return b;
  if (/(.)\1/.test(b) && !/(.)\1/.test(a)) return a;
  return a;
}

function cleanWhitespace(raw: string): string {
  return String(raw || '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove caracteres de substituição () de encoding quebrado. */
export function stripBrokenEncoding(raw: string): string {
  return cleanWhitespace(
    String(raw || '')
      .replace(/\uFFFD/g, '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  );
}

/** Corrige texto UTF-8 lido como Latin-1 (ex.: Agrolndia → Agrolândia). */
export function repairUtf8Mojibake(raw: string): string {
  let s = stripBrokenEncoding(raw);
  if (!s) return s;
  if (/[\u00c0-\u00ff]/.test(s)) {
    try {
      const bytes = new Uint8Array([...s].map((ch) => ch.charCodeAt(0) & 0xff));
      const fixed = new TextDecoder('utf-8').decode(bytes);
      if (fixed && !fixed.includes('\uFFFD') && fixed.length > 0) {
        s = cleanWhitespace(fixed);
      }
    } catch {
      /* mantém original */
    }
  }
  return s;
}

function capitalizeHyphenated(lowerWord: string): string {
  return lowerWord
    .split('-')
    .map((seg) => {
      if (!seg) return '';
      const lo = seg.toLocaleLowerCase('pt-BR');
      return lo.charAt(0).toLocaleUpperCase('pt-BR') + lo.slice(1);
    })
    .join('-');
}

export function titleCasePlaceName(raw: string): string {
  const s = cleanWhitespace(raw);
  if (!s) return '';
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const lower = w.toLocaleLowerCase('pt-BR');
      if (i > 0 && PT_PARTICLES_LOWER.has(lower)) return lower;
      return capitalizeHyphenated(lower);
    })
    .join(' ');
}

export function normalizeContactState(raw: string): string {
  const st = cleanWhitespace(raw).toUpperCase().slice(0, 2);
  return BRAZIL_UFS.has(st) ? st : '';
}

/** Limpa bairro: remove colchetes, pontuação solta e sufixo ", Cidade" duplicado. */
export function normalizeContactNeighborhood(raw: string, cityHint?: string): string {
  let s = cleanWhitespace(raw);
  if (!s) return '';

  s = s.replace(/^[\[\(\{<"'«#@]+/g, '').replace(/[\]\)\}>"'»]+$/g, '');
  s = cleanWhitespace(s);

  const embedded = s.match(/^(.+?)\s*[,–/\-]\s*(.+)$/);
  if (embedded) {
    const part1 = cleanWhitespace(embedded[1]);
    const part2 = cleanWhitespace(embedded[2]);
    const cityKey = cityHint ? normKeyPart(cityHint) : '';
    if (cityKey && normKeyPart(part2) === cityKey) {
      s = part1;
    } else if (part2.length >= 3 && !/^\d/.test(part2)) {
      s = part1;
    }
  }

  s = s.replace(/^[^\p{L}\p{N}]+/gu, '').replace(/[^\p{L}\p{N}\s.'-]+$/gu, '');
  s = collapseDoubledLetters(cleanWhitespace(s));
  return titleCasePlaceName(s);
}

export function normalizeContactZipCode(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length >= 8) return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
  if (d.length >= 5) return d.slice(0, 5);
  return d;
}

/** Extrai cidade e UF quando vierem juntos ("BLUMENAU - SC" ou "Blumenau · SC"). */
export function parseEmbeddedCityState(cityRaw: string): { city: string; state: string } {
  let city = cleanWhitespace(cityRaw);
  let state = '';

  const dot = city.match(/^(.+?)\s*·\s*([A-Za-z]{2})\s*$/);
  if (dot) {
    city = cleanWhitespace(dot[1]);
    state = normalizeContactState(dot[2]);
    return { city, state };
  }

  const m = city.match(/^(.+?)\s*[-–/,]\s*([A-Za-z]{2})\s*$/);
  if (m) {
    city = cleanWhitespace(m[1]);
    state = normalizeContactState(m[2]);
  }
  return { city, state };
}

/** Parse valor de filtro do mapa/lista ("Blumenau · SC"). */
export function parseGeoFilterCity(raw: string): { city: string; state: string } {
  return parseEmbeddedCityState(cleanWhitespace(raw));
}

export function knownUfForCity(city: string): string {
  return KNOWN_CITY_UF[normKeyPart(city)] || '';
}

/**
 * Cidade/UF a partir do cadastro — **não usa DDD do telefone** (evita Blumenau/SC virar PE no mapa).
 */
export function resolveAddressCityState(
  input: {
    city?: string;
    state?: string;
  },
  ibgeIndex?: IbgeCityIndex | null
): { city: string; state: string } {
  const cityField = repairUtf8Mojibake(input.city || '');
  const parsed = parseEmbeddedCityState(cityField);
  const cityRaw = parsed.city;
  const stateHint = normalizeContactState(input.state || '') || parsed.state;

  const ibge = fuzzyResolveCityWithIbge(ibgeIndex, {
    city: cityRaw,
    stateHint,
    phoneUf: undefined,
    parsedEmbeddedUf: parsed.state
  });
  if (ibge) {
    return { city: ibge.city, state: ibge.state };
  }

  const knownUf = knownUfForCity(cityRaw);
  if (knownUf) {
    return { city: titleCasePlaceName(cityRaw), state: knownUf };
  }

  return {
    city: titleCasePlaceName(cityRaw),
    state: stateHint || parsed.state
  };
}

export function resolveContactCityState(
  input: {
    city?: string;
    state?: string;
    phone?: string;
  },
  ibgeIndex?: IbgeCityIndex | null
): { city: string; state: string } {
  const fromAddress = resolveAddressCityState(
    { city: input.city, state: input.state },
    ibgeIndex
  );
  if (fromAddress.city) return fromAddress;

  const phoneUf = phoneDigitsToUf(input.phone || '') || '';
  return {
    city: fromAddress.city,
    state: fromAddress.state || phoneUf
  };
}

export type GeoPlaceResolution = { city: string; state: string; neighborhood: string };

function tryResolveMunicipality(
  name: string,
  stateHint: string,
  ibgeIndex?: IbgeCityIndex | null
): { city: string; state: string } | null {
  const trimmed = cleanWhitespace(name);
  if (!trimmed) return null;
  const { city, state } = resolveAddressCityState({ city: trimmed, state: stateHint }, ibgeIndex);
  const ibge = fuzzyResolveCityWithIbge(ibgeIndex, { city, stateHint: state });
  if (ibge) return { city: ibge.city, state: ibge.state };
  const uf = knownUfForCity(city);
  if (uf) return { city: titleCasePlaceName(city), state: uf };
  return null;
}

/**
 * Gazetteer de bairros → cidade quando o campo "cidade" traz apenas o bairro.
 * Cada bairro pode existir em mais de um município (ex.: "Água Verde" em Curitiba/PR e
 * Blumenau/SC). A UF (do cadastro ou inferida pelo DDD do telefone) desempata.
 */
const NEIGHBORHOOD_GAZETTEER: Record<string, Array<{ uf: string; city: string }>> = {
  // --- Curitiba / PR (DDD 41) ---
  aguaverde: [
    { uf: 'PR', city: 'Curitiba' },
    { uf: 'SC', city: 'Blumenau' }
  ],
  batel: [{ uf: 'PR', city: 'Curitiba' }],
  bigorrilho: [{ uf: 'PR', city: 'Curitiba' }],
  reboucas: [{ uf: 'PR', city: 'Curitiba' }],
  portao: [{ uf: 'PR', city: 'Curitiba' }],
  cabral: [{ uf: 'PR', city: 'Curitiba' }],
  juveve: [{ uf: 'PR', city: 'Curitiba' }],
  cristorei: [{ uf: 'PR', city: 'Curitiba' }],
  ahu: [{ uf: 'PR', city: 'Curitiba' }],
  merces: [{ uf: 'PR', city: 'Curitiba' }],
  bomretiro: [{ uf: 'PR', city: 'Curitiba' }],
  hugolange: [{ uf: 'PR', city: 'Curitiba' }],
  jardimsocial: [{ uf: 'PR', city: 'Curitiba' }],
  altodagloria: [{ uf: 'PR', city: 'Curitiba' }],
  altodaxv: [{ uf: 'PR', city: 'Curitiba' }],
  saofrancisco: [{ uf: 'PR', city: 'Curitiba' }],
  cajuru: [{ uf: 'PR', city: 'Curitiba' }],
  boavista: [{ uf: 'PR', city: 'Curitiba' }],
  bacacheri: [{ uf: 'PR', city: 'Curitiba' }],
  santafelicidade: [{ uf: 'PR', city: 'Curitiba' }],
  campocomprido: [{ uf: 'PR', city: 'Curitiba' }],
  cidadeindustrial: [{ uf: 'PR', city: 'Curitiba' }],
  boqueirao: [{ uf: 'PR', city: 'Curitiba' }],
  xaxim: [{ uf: 'PR', city: 'Curitiba' }],
  pinheirinho: [{ uf: 'PR', city: 'Curitiba' }],
  sitiocercado: [{ uf: 'PR', city: 'Curitiba' }],
  uberaba: [{ uf: 'PR', city: 'Curitiba' }],
  hauer: [{ uf: 'PR', city: 'Curitiba' }],
  fazendinha: [{ uf: 'PR', city: 'Curitiba' }],
  novomundo: [{ uf: 'PR', city: 'Curitiba' }],
  capaoraso: [{ uf: 'PR', city: 'Curitiba' }],
  centrocivico: [{ uf: 'PR', city: 'Curitiba' }],
  // --- Blumenau / SC (DDD 47) ---
  fortaleza: [{ uf: 'SC', city: 'Blumenau' }],
  itoupavacentral: [{ uf: 'SC', city: 'Blumenau' }],
  itoupavanzinha: [{ uf: 'SC', city: 'Blumenau' }],
  itoupava: [{ uf: 'SC', city: 'Blumenau' }],
  escolaagricola: [{ uf: 'SC', city: 'Blumenau' }],
  velha: [{ uf: 'SC', city: 'Blumenau' }],
  vorstadt: [{ uf: 'SC', city: 'Blumenau' }],
  pontaguda: [{ uf: 'SC', city: 'Blumenau' }],
  salto: [{ uf: 'SC', city: 'Blumenau' }],
  badenfurt: [{ uf: 'SC', city: 'Blumenau' }],
  progresso: [{ uf: 'SC', city: 'Blumenau' }],
  vilaformosa: [{ uf: 'SC', city: 'Blumenau' }],
  passomanso: [{ uf: 'SC', city: 'Blumenau' }],
  valparaiso: [{ uf: 'SC', city: 'Blumenau' }],
  garcia: [{ uf: 'SC', city: 'Blumenau' }],
  rondonia: [{ uf: 'SC', city: 'Blumenau' }]
};

/** Bairros do Vale do Itajaí (SC) — default quando a base não traz UF/DDD mas o cadastro é claramente regional. */
const SC_VALE_ITAJAI_NB_KEYS = new Set([
  'aguaverde',
  'fortaleza',
  'itoupavacentral',
  'itoupavanzinha',
  'itoupava',
  'escolaagricola',
  'velha',
  'vorstadt',
  'pontaguda',
  'salto',
  'badenfurt',
  'progresso',
  'vilaformosa',
  'passomanso',
  'valparaiso',
  'garcia',
  'rondonia'
]);

function inferUfSignals(stateHint: string, phone?: string, zipCode?: string): string[] {
  const out: string[] = [];
  if (stateHint) out.push(stateHint);
  const phoneUf = phoneDigitsToUf(phone || '');
  if (phoneUf) out.push(phoneUf);
  const cepHit = municipalityFromCepPrefix(zipCode || '', '');
  if (cepHit?.state) out.push(cepHit.state);
  return out;
}

/**
 * Extrai chave de bairro do gazetteer a partir do campo cidade, inclusive compostos
 * ("Água Verde - Blumenau" → aguaverde) que não batem em normNeighborhoodKey direto.
 */
export function gazetteerKeyFromCityField(cityRaw: string): string | null {
  const s = repairUtf8Mojibake(cityRaw || '');
  if (!s) return null;
  const direct = normNeighborhoodKey(s);
  if (NEIGHBORHOOD_GAZETTEER[direct]) return direct;

  const embedded = parseEmbeddedCityState(s);
  const nbKey = normNeighborhoodKey(embedded.city || s);

  for (const cityKey of Object.keys(KNOWN_CITY_UF)) {
    if (nbKey.length > cityKey.length + 2 && nbKey.endsWith(cityKey)) {
      const prefix = nbKey.slice(0, nbKey.length - cityKey.length);
      if (NEIGHBORHOOD_GAZETTEER[prefix]) return prefix;
    }
  }

  for (const entries of Object.values(NEIGHBORHOOD_GAZETTEER)) {
    for (const e of entries) {
      const ck = normKeyPart(e.city);
      if (nbKey.length > ck.length + 2 && nbKey.endsWith(ck)) {
        const prefix = nbKey.slice(0, nbKey.length - ck.length);
        if (NEIGHBORHOOD_GAZETTEER[prefix]) return prefix;
      }
    }
  }

  return null;
}

/** "Água Verde - Blumenau" / "Água Verde, Blumenau" → bairro + município. */
function parseNeighborhoodCityCompound(cityRaw: string): {
  neighborhood: string;
  city: string;
  state: string;
} | null {
  const embedded = parseEmbeddedCityState(cityRaw);
  const s = embedded.city || cityRaw;
  const m = s.match(/^(.+?)\s*[-–,/]\s*(.+)$/);
  if (!m) return null;

  const part1 = cleanWhitespace(m[1]);
  const part2 = cleanWhitespace(m[2]);
  if (!part1 || !part2 || part2.length < 3) return null;

  const part2Uf = normalizeContactState(part2);
  if (part2Uf && part2.length <= 3) return null;

  const cityUf = knownUfForCity(part2);
  const gazNb = gazetteerKeyFromCityField(part1) || normNeighborhoodKey(part1);
  if (!cityUf && !KNOWN_CITY_UF[normKeyPart(part2)]) return null;
  if (!NEIGHBORHOOD_GAZETTEER[gazNb] && !KNOWN_CITY_UF[normKeyPart(part2)]) return null;

  return {
    neighborhood: part1,
    city: titleCasePlaceName(part2),
    state: embedded.state || cityUf || ''
  };
}

function resolveGazetteerNeighborhoodKey(cityRaw: string, nbRaw: string): string {
  return (
    gazetteerKeyFromCityField(cityRaw) ||
    gazetteerKeyFromCityField(nbRaw) ||
    normNeighborhoodKey(parseEmbeddedCityState(cityRaw).city || cityRaw) ||
    normNeighborhoodKey(nbRaw)
  );
}

/** Resolve cidade quando o campo cidade traz só o bairro, desempatando por UF/DDD/CEP. */
function knownNeighborhoodMunicipality(
  nbKey: string,
  stateHint: string,
  phone?: string,
  zipCode?: string
): { city: string; state: string } | null {
  if (!nbKey) return null;
  const candidates = NEIGHBORHOOD_GAZETTEER[nbKey];
  if (!candidates || candidates.length === 0) return null;

  for (const uf of inferUfSignals(stateHint, phone, zipCode)) {
    const match = candidates.find((c) => c.uf === uf);
    if (match) return { city: match.city, state: match.uf };
  }

  // Sem UF: só decide quando o bairro pertence a um único município conhecido.
  if (candidates.length === 1) {
    return { city: candidates[0].city, state: candidates[0].uf };
  }

  // Vale do Itajaí: cadastros só com "Água Verde" no campo cidade, sem UF nem DDD.
  if (SC_VALE_ITAJAI_NB_KEYS.has(nbKey)) {
    const sc = candidates.find((c) => c.uf === 'SC');
    if (sc) return { city: sc.city, state: sc.uf };
  }

  return null;
}

/** CEP → município (prefixos mais usados no Vale do Itajaí / SC). */
function municipalityFromCepPrefix(cep: string, stateHint: string): { city: string; state: string } | null {
  const d = String(cep || '').replace(/\D/g, '');
  if (d.length < 5) return null;
  const p3 = d.slice(0, 3);
  const table: Record<string, { city: string; state: string }> = {
    '890': { city: 'Blumenau', state: 'SC' },
    '891': { city: 'Indaial', state: 'SC' },
    '892': { city: 'Blumenau', state: 'SC' },
    '883': { city: 'Gaspar', state: 'SC' },
    '884': { city: 'Pomerode', state: 'SC' }
  };
  const hit = table[p3];
  if (!hit) return null;
  if (stateHint && stateHint !== hit.state) return null;
  return hit;
}

/**
 * Corrige cadastros com bairro no campo cidade (ex.: "Água Verde" em vez de "Blumenau").
 * Usa mapa aprendido da própria base, troca cidade↔bairro e CEP.
 */
export function resolveGeoPlaceForContact(
  input: ContactAddressInput,
  ibgeIndex?: IbgeCityIndex | null,
  nbToCityMap?: ReadonlyMap<string, { city: string; state: string }>
): GeoPlaceResolution {
  const cityRaw = repairUtf8Mojibake(input.city || '');
  const nbRaw = repairUtf8Mojibake(input.neighborhood || '');
  const embedded = parseEmbeddedCityState(cityRaw);
  const stateHint = normalizeContactState(input.state || '') || embedded.state;
  const cityForResolve = embedded.city || cityRaw;

  const compound = cityRaw ? parseNeighborhoodCityCompound(cityRaw) : null;
  if (compound) {
    return {
      city: compound.city,
      state: compound.state || stateHint || knownUfForCity(compound.city) || '',
      neighborhood: normalizeContactNeighborhood(compound.neighborhood, compound.city)
    };
  }

  const nbKey = resolveGazetteerNeighborhoodKey(cityForResolve, nbRaw);

  // Bairro conhecido no campo cidade — antes do IBGE (evita "Água Verde" virar município no ranking).
  const gazHit = knownNeighborhoodMunicipality(
    nbKey,
    stateHint,
    input.phone,
    input.zipCode
  );
  if (gazHit && (cityForResolve || nbRaw)) {
    const nbSource =
      gazetteerKeyFromCityField(cityForResolve) || normNeighborhoodKey(cityForResolve)
        ? cityForResolve
        : nbRaw || cityForResolve;
    const nb = normalizeContactNeighborhood(nbSource, gazHit.city);
    return { city: gazHit.city, state: gazHit.state, neighborhood: nb };
  }

  const cityHit = tryResolveMunicipality(cityForResolve, stateHint, ibgeIndex);
  const nbHit = tryResolveMunicipality(nbRaw, stateHint, ibgeIndex);

  if (cityHit && cityForResolve) {
    const nb = normalizeContactNeighborhood(nbRaw, cityHit.city);
    return { city: cityHit.city, state: cityHit.state, neighborhood: nb };
  }

  if (nbHit && cityForResolve && !cityHit) {
    const nb = normalizeContactNeighborhood(cityForResolve, nbHit.city);
    return { city: nbHit.city, state: nbHit.state, neighborhood: nb };
  }

  if (cityForResolve && !cityHit && nbToCityMap) {
    const mapped = nbToCityMap.get(nbKey);
    if (mapped) {
      const nb = normalizeContactNeighborhood(cityForResolve, mapped.city);
      return { city: mapped.city, state: mapped.state || stateHint, neighborhood: nb };
    }
  }

  const cepHit = municipalityFromCepPrefix(input.zipCode || '', stateHint);
  if (cityForResolve && !cityHit && cepHit) {
    const nb = normalizeContactNeighborhood(cityForResolve, cepHit.city);
    return { city: cepHit.city, state: cepHit.state, neighborhood: nb };
  }

  const fb = resolveAddressCityState({ city: cityForResolve, state: stateHint }, ibgeIndex);
  const nb = normalizeContactNeighborhood(nbRaw || (!cityHit ? cityForResolve : ''), fb.city);
  return { city: fb.city, state: fb.state, neighborhood: nb };
}

/**
 * Nome canônico de município para ranking/clusters — gazetteer e KNOWN_CITY_UF antes do IBGE
 * (evita reintroduzir bairro como cidade após resolveGeoPlaceForContact).
 */
export function canonicalizeClusterCity(
  city: string,
  stateHint = '',
  phone?: string,
  zipCode?: string,
  ibgeIndex?: IbgeCityIndex | null
): string {
  const parsed = parseEmbeddedCityState(repairUtf8Mojibake(city));
  const gazKey = gazetteerKeyFromCityField(parsed.city || city);
  if (gazKey) {
    const hit = knownNeighborhoodMunicipality(gazKey, stateHint || parsed.state, phone, zipCode);
    if (hit) return hit.city;
  }
  const ibge = fuzzyResolveCityWithIbge(ibgeIndex, {
    city: parsed.city || city,
    stateHint: stateHint || parsed.state,
    phoneUf: phone ? phoneDigitsToUf(phone) : undefined,
    parsedEmbeddedUf: parsed.state
  });
  if (ibge) return ibge.city;
  const knownUf = knownUfForCity(parsed.city || city);
  if (knownUf && parsed.city) return titleCasePlaceName(parsed.city);
  return titleCasePlaceName(parsed.city || city);
}

/** Aprende bairro → cidade a partir de contatos com município válido na base. */
export function buildNeighborhoodToCityMap(
  contacts: ContactAddressInput[],
  ibgeIndex?: IbgeCityIndex | null
): Map<string, { city: string; state: string }> {
  const votes = new Map<string, Map<string, number>>();
  const meta = new Map<string, { city: string; state: string }>();

  const addVote = (nbKey: string, city: string, state: string) => {
    if (!nbKey || !city) return;
    const ck = `${normPlaceKey(city)}|${state}`;
    meta.set(ck, { city, state });
    const bucket = votes.get(nbKey) || new Map<string, number>();
    bucket.set(ck, (bucket.get(ck) || 0) + 1);
    votes.set(nbKey, bucket);
  };

  // Memoiza resolução de município por (texto|UF): bases grandes repetem muito a mesma cidade,
  // evitando milhares de buscas fuzzy no índice IBGE (que travavam o event loop).
  const muniMemo = new Map<string, { city: string; state: string } | null>();
  const resolveMuni = (name: string, stateHint: string) => {
    const k = `${name}|${stateHint}`;
    const cached = muniMemo.get(k);
    if (cached !== undefined) return cached;
    const hit = tryResolveMunicipality(name, stateHint, ibgeIndex);
    muniMemo.set(k, hit);
    return hit;
  };

  for (const c of contacts) {
    const stateHint = normalizeContactState(c.state || '');
    const cityRaw = repairUtf8Mojibake(c.city || '');
    const nbRaw = repairUtf8Mojibake(c.neighborhood || '');

    const cityMuni = resolveMuni(cityRaw, stateHint);
    const nbMuni = resolveMuni(nbRaw, stateHint);
    const nbFromField = normalizeContactNeighborhood(nbRaw, cityMuni?.city || '');

    if (cityMuni && nbFromField) {
      addVote(normNeighborhoodKey(nbFromField), cityMuni.city, cityMuni.state);
    }

    if (!cityMuni && nbMuni && cityRaw) {
      addVote(normNeighborhoodKey(cityRaw), nbMuni.city, nbMuni.state);
    }

    // Bairro conhecido no campo cidade (ex.: 30k com city=Água Verde sem UF) — vota por DDD/CEP/UF.
    const embedded = parseEmbeddedCityState(cityRaw);
    const nbKey =
      gazetteerKeyFromCityField(embedded.city || cityRaw) ||
      normNeighborhoodKey(embedded.city || cityRaw);
    if (!NEIGHBORHOOD_GAZETTEER[nbKey]) continue;
    for (const uf of inferUfSignals(
      stateHint || embedded.state,
      c.phone,
      c.zipCode
    )) {
      const hit = NEIGHBORHOOD_GAZETTEER[nbKey].find((x) => x.uf === uf);
      if (hit) addVote(nbKey, hit.city, hit.uf);
    }
  }

  const result = new Map<string, { city: string; state: string }>();
  for (const [nbKey, bucket] of votes) {
    let bestKey = '';
    let bestN = 0;
    for (const [ck, n] of bucket) {
      if (n > bestN) {
        bestN = n;
        bestKey = ck;
      }
    }
    const hit = meta.get(bestKey);
    if (hit && bestN >= 1) result.set(nbKey, hit);
  }

  // Fallback regional: bairro do Vale do Itajaí sem nenhum voto (cadastro sem UF/DDD/CEP).
  const nbOnlyCounts = new Map<string, number>();
  for (const c of contacts) {
    const cityRaw = repairUtf8Mojibake(c.city || '');
    const embedded = parseEmbeddedCityState(cityRaw);
    const nbKey =
      gazetteerKeyFromCityField(embedded.city || cityRaw) ||
      normNeighborhoodKey(embedded.city || cityRaw);
    if (!SC_VALE_ITAJAI_NB_KEYS.has(nbKey) || result.has(nbKey)) continue;
    nbOnlyCounts.set(nbKey, (nbOnlyCounts.get(nbKey) || 0) + 1);
  }
  for (const [nbKey, n] of nbOnlyCounts) {
    if (n < 3) continue;
    const sc = NEIGHBORHOOD_GAZETTEER[nbKey]?.find((x) => x.uf === 'SC');
    if (sc) result.set(nbKey, { city: sc.city, state: sc.uf });
  }

  return result;
}

export type ContactAddressInput = {
  city?: string;
  state?: string;
  phone?: string;
  neighborhood?: string;
  street?: string;
  zipCode?: string;
  number?: string;
};

export type NormalizedContactAddress = {
  city?: string;
  state?: string;
  neighborhood?: string;
  street?: string;
  zipCode?: string;
  number?: string;
};

export function normalizeContactAddressFields(
  input: ContactAddressInput,
  ibgeIndex?: IbgeCityIndex | null
): NormalizedContactAddress {
  const out: NormalizedContactAddress = {};

  const cityInput = repairUtf8Mojibake(input.city || '');
  const hasCity = cleanWhitespace(cityInput).length > 0;
  const hasState = cleanWhitespace(input.state || '').length > 0;
  const hasPhone = String(input.phone || '').replace(/\D/g, '').length >= 10;

  if (hasCity || hasState || hasPhone) {
    const { city, state } = resolveAddressCityState(
      { city: cityInput, state: input.state },
      ibgeIndex
    );
    if (city) out.city = city;
    if (state) out.state = state;
  }

  const cityHint = out.city || cleanWhitespace(input.city || '').split('·')[0].trim();
  const nb = normalizeContactNeighborhood(input.neighborhood || '', cityHint);
  if (nb) out.neighborhood = nb;

  const street = cleanWhitespace(input.street || '');
  if (street) out.street = titleCasePlaceName(street);

  const zip = normalizeContactZipCode(input.zipCode || '');
  if (zip) out.zipCode = zip;

  const number = cleanWhitespace(input.number || '');
  if (number) out.number = number;

  return out;
}

export function applyAddressNormalizationToContact<T extends ContactAddressInput>(
  contact: T,
  ibgeIndex?: IbgeCityIndex | null
): T & NormalizedContactAddress {
  const norm = normalizeContactAddressFields(contact, ibgeIndex);
  return { ...contact, ...norm };
}

export function contactAddressChanged(before: ContactAddressInput, after: NormalizedContactAddress): boolean {
  const fields: Array<keyof NormalizedContactAddress> = [
    'city',
    'state',
    'neighborhood',
    'street',
    'zipCode',
    'number'
  ];
  for (const f of fields) {
    const b = cleanWhitespace(String(before[f] || ''));
    const a = cleanWhitespace(String(after[f] || ''));
    if (b !== a) return true;
  }
  return false;
}
