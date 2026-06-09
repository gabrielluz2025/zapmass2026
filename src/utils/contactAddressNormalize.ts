import { phoneDigitsToUf } from './brazilPhoneGeo';

const BRAZIL_UFS = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
]);

const PT_PARTICLES_LOWER = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o']);

/**
 * Cidades com UF única e inequívoca no Brasil.
 * Sempre prevalece sobre UF errada no cadastro ("Blumenau - BA", state=PR, etc.).
 */
export const KNOWN_CITY_UF: Record<string, string> = {
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
  florianopolis: 'SC',
  saojose: 'SC',
  palhoca: 'SC',
  tubarao: 'SC',
  criciuma: 'SC',
  laguna: 'SC',
  saopaulo: 'SP',
  riodejaneiro: 'RJ',
  curitiba: 'PR',
  portoalegre: 'RS'
};

export function knownUfForCity(city: string): string {
  return KNOWN_CITY_UF[normKeyPart(city)] || '';
}

function normKeyPart(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

function cleanWhitespace(raw: string): string {
  return String(raw || '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

/** Title case para cidades, bairros e logradouros (pt-BR). */
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

export function normalizeContactZipCode(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length >= 8) return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
  if (d.length >= 5) return d.slice(0, 5);
  return d;
}

/** Extrai cidade e UF quando vierem juntos no campo cidade ("BLUMENAU - SC"). */
export function parseEmbeddedCityState(cityRaw: string): { city: string; state: string } {
  let city = cleanWhitespace(cityRaw);
  let state = '';
  const m = city.match(/^(.+?)\s*[-–/,]\s*([A-Za-z]{2})\s*$/);
  if (m) {
    city = cleanWhitespace(m[1]);
    state = normalizeContactState(m[2]);
  }
  return { city, state };
}

export function resolveContactCityState(input: {
  city?: string;
  state?: string;
  phone?: string;
}): { city: string; state: string } {
  const parsed = parseEmbeddedCityState(input.city || '');
  const city = parsed.city;
  const phoneUf = phoneDigitsToUf(input.phone || '') || '';
  const knownUf = knownUfForCity(city);

  // Cidade conhecida: UF fixa (Blumenau é só SC, nunca BA/SP/PR).
  if (knownUf) {
    return { city: titleCasePlaceName(city), state: knownUf };
  }

  let state = normalizeContactState(input.state || '') || parsed.state;

  if (parsed.state && phoneUf && parsed.state !== phoneUf) {
    state = phoneUf;
  } else if (!state && phoneUf) {
    state = phoneUf;
  }

  if (!state && parsed.state) state = parsed.state;

  return {
    city: titleCasePlaceName(city),
    state
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

/** Padroniza campos de endereço para gravação no CRM e mapa. */
export function normalizeContactAddressFields(input: ContactAddressInput): NormalizedContactAddress {
  const out: NormalizedContactAddress = {};

  const hasCity = cleanWhitespace(input.city || '').length > 0;
  const hasState = cleanWhitespace(input.state || '').length > 0;
  const hasPhone = String(input.phone || '').replace(/\D/g, '').length >= 10;

  if (hasCity || hasState || hasPhone) {
    const { city, state } = resolveContactCityState({
      city: input.city,
      state: input.state,
      phone: input.phone
    });
    if (city) out.city = city;
    if (state) out.state = state;
  }

  const nb = cleanWhitespace(input.neighborhood || '');
  if (nb) out.neighborhood = titleCasePlaceName(nb);

  const street = cleanWhitespace(input.street || '');
  if (street) out.street = titleCasePlaceName(street);

  const zip = normalizeContactZipCode(input.zipCode || '');
  if (zip) out.zipCode = zip;

  const number = cleanWhitespace(input.number || '');
  if (number) out.number = number;

  return out;
}

export function applyAddressNormalizationToContact<T extends ContactAddressInput>(contact: T): T & NormalizedContactAddress {
  const norm = normalizeContactAddressFields(contact);
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
