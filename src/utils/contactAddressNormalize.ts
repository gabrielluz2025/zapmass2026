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
