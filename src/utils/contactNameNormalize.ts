/** Normalização de nomes de pessoa para CRM / variáveis de campanha (pt-BR). */

import { repairUtf8Mojibake } from './contactAddressNormalize';

export type ContactNameNormalizeOpts = {
  /** Prefixos extras (uma por linha ou separados por vírgula/ponto-e-vírgula). */
  extraPrefixes?: string[];
  stripPrefixes?: boolean;
  titleCase?: boolean;
  /** Mantém apenas o primeiro e o último token (útil para remover meios antigos). */
  firstAndLastOnly?: boolean;
  /**
   * Remove caracteres invisíveis, emoji, números e pontuação estranha.
   * Mantém letras (incl. acentos), espaço, hífen e apóstrofo (') para nomes compostos.
   */
  sanitizeCharacters?: boolean;
};

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Chave alfanumérica para comparar prefixos (acentos e pontuação ignorados). */
export function alphanumericPrefixKey(token: string): string {
  return stripDiacritics(token).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

const DEFAULT_PREFIX_SOURCE = [
  'pastor',
  'pastora',
  'padre',
  'frei',
  'freira',
  'reverendo',
  'reverenda',
  'rev',
  'bispo',
  'diacono',
  'presbitero',
  'irmao',
  'irma',
  'pe',
  'sr',
  'sra',
  'dr',
  'dra',
  'prof',
  'profa',
  'eng',
  'me',
  'senhor',
  'senhora',
  'samae'
];

const DEFAULT_PREFIX_KEYS = new Set(DEFAULT_PREFIX_SOURCE.map(alphanumericPrefixKey).filter(Boolean));

const PT_PARTICLES_LOWER = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'por',
  'a',
  'o',
  'na',
  'no',
  'nas',
  'nos'
]);

export function parseExtraPrefixes(raw: string): string[] {
  return raw
    .split(/[,;\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildPrefixKeySet(extraPrefixes: string[]): Set<string> {
  const set = new Set(DEFAULT_PREFIX_KEYS);
  for (const line of extraPrefixes) {
    const k = alphanumericPrefixKey(line);
    if (k) set.add(k);
  }
  return set;
}

function capitalizeHyphenatedPt(lowerWord: string): string {
  return lowerWord
    .split('-')
    .map((seg) => {
      if (!seg) return '';
      const lo = seg.toLocaleLowerCase('pt-BR');
      return lo.charAt(0).toLocaleUpperCase('pt-BR') + lo.slice(1);
    })
    .join('-');
}

function titleCasePortuguesePersonName(s: string): string {
  const words = s.split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLocaleLowerCase('pt-BR');
      if (i > 0 && i < words.length - 1 && PT_PARTICLES_LOWER.has(lower)) {
        return lower;
      }
      return capitalizeHyphenatedPt(lower);
    })
    .join(' ');
}

function stripLeadingPrefixTokens(name: string, prefixKeys: Set<string>): string {
  const parts = name.split(/\s+/).filter(Boolean);
  while (parts.length > 0) {
    const key = alphanumericPrefixKey(parts[0]);
    if (!key || !prefixKeys.has(key)) break;
    parts.shift();
  }
  return parts.join(' ');
}

function applyFirstAndLastOnly(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(' ');
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/**
 * Remove zero-width/BOM, emoji, dígitos e símbolos; conserva letras Unicode (acentos),
 * espaços e, para nomes compostos, hífen e apóstrofo (' ou ').
 */
export function sanitizePersonNameCharacters(raw: string): string {
  if (!raw) return '';
  let s = raw
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  s = s.replace(/[^\p{L}\p{M}\s'\u2019\-]/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Normaliza espaços; opcionalmente remove prefixos de cargo/instituição no início,
 * reduz a primeiro+último nome e aplica capitalização estilo nome próprio (pt-BR).
 */
export function normalizeContactPersonName(raw: string, opts: ContactNameNormalizeOpts = {}): string {
  const {
    extraPrefixes = [],
    stripPrefixes = false,
    titleCase = false,
    firstAndLastOnly = false,
    sanitizeCharacters = false
  } = opts;

  let s = (raw || '').trim().replace(/\s+/g, ' ');
  if (sanitizeCharacters) {
    s = sanitizePersonNameCharacters(s);
  }
  if (!s) return '';

  if (stripPrefixes) {
    const prefixKeys = buildPrefixKeySet(extraPrefixes);
    s = stripLeadingPrefixTokens(s, prefixKeys).trim().replace(/\s+/g, ' ');
  }

  if (!s) return '';

  if (firstAndLastOnly) {
    s = applyFirstAndLastOnly(s).trim().replace(/\s+/g, ' ');
  }

  if (titleCase) {
    s = titleCasePortuguesePersonName(s);
  }

  return s.trim();
}

/** Mesma regra aplicada ao montar `{nome}` / `{nome_completo}` nas campanhas. */
export function campaignRecipientNameVars(rawFullName: string): { nome: string; nome_completo: string } {
  const nomeCompleto = normalizeContactPersonName(rawFullName || '', {
    stripPrefixes: true,
    titleCase: true,
    firstAndLastOnly: false
  });
  const parts = nomeCompleto.trim().split(/\s+/).filter(Boolean);
  return {
    nome: parts[0] || nomeCompleto,
    nome_completo: nomeCompleto
  };
}

const MAX_STORED_NAME_LEN = 120;

/**
 * Normalização conservadora para PERSISTÊNCIA do nome (todo save/import/correção):
 *  - Conserta mojibake (UTF-8 lido como Latin-1) e remove caracteres invisíveis
 *  - Colapsa espaços e apara as bordas
 *  - Aplica Title Case APENAS quando está todo em MAIÚSCULAS ou todo minúsculo
 *    (preserva grafias mistas intencionais: "iPhone da Maria", "McDonald")
 *  - Mantém acentos e emojis (válidos em nomes de WhatsApp)
 * Pura e idempotente: segura para rodar em toda gravação.
 */
export function normalizeContactName(raw: string): string {
  const s = repairUtf8Mojibake(String(raw ?? '')).replace(/\s+/g, ' ').trim();
  if (!s) return '';

  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 2) {
    const upper = s.toLocaleUpperCase('pt-BR');
    const lower = s.toLocaleLowerCase('pt-BR');
    if (s === upper || s === lower) {
      return titleCasePortuguesePersonName(s).slice(0, MAX_STORED_NAME_LEN);
    }
  }

  return s.slice(0, MAX_STORED_NAME_LEN);
}

/** Sinaliza nomes claramente quebrados/placeholder para relatórios de qualidade. */
export function isSuspiciousContactName(name: string): boolean {
  const s = String(name ?? '').trim();
  if (!s) return true;
  if (/^sem nome$/i.test(s)) return true;
  if (!/\p{L}/u.test(s)) return true; // nenhuma letra
  if (/\uFFFD/.test(s)) return true; // marcador de encoding quebrado
  return false;
}
