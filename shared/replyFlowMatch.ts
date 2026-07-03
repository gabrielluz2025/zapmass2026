/** Matching de gatilhos do fluxo por resposta — compartilhado entre servidor e UI. */

export type ReplyMatchMode = 'word' | 'phrase' | 'contains' | 'numeric_exact';

export type ReplyFlowMatchResult = {
  matched: boolean;
  matchedToken?: string;
  matchMode?: ReplyMatchMode;
};

export type ReplyFlowOptionMatchCandidate = {
  optionIndex: number;
  priority: number;
  token: string;
  matchMode: ReplyMatchMode;
  result: ReplyFlowMatchResult;
};

/** Palavras-chave globais de descadastro (antes do menu da campanha). */
export const DEFAULT_GLOBAL_OPT_OUT_KEYWORDS = [
  'sair',
  'parar',
  'stop',
  'cancelar',
  'remover',
  'excluir',
  'nao quero',
  'não quero',
  'nao receber',
  'não receber',
];

const NUMERIC_WORDS: Record<string, string> = {
  um: '1',
  uma: '1',
  dois: '2',
  duas: '2',
  tres: '3',
  três: '3',
  quatro: '4',
  cinco: '5',
  seis: '6',
  sete: '7',
  oito: '8',
  nove: '9',
  dez: '10',
};

/** Normaliza emojis numéricos (1️⃣) e variantes por extenso curtas. */
export function expandNumericReplyAliases(text: string): string {
  let s = String(text || '');
  s = s.replace(/([0-9])[\uFE0F\u20E3]/g, '$1');
  s = s.replace(/[\u2460-\u2473]/g, (ch) => String(ch.charCodeAt(0) - 0x2460 + 1));
  const words = s
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u00FF0-9]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return s.trim();
  const mapped = words.map((w) => NUMERIC_WORDS[w] ?? w);
  return mapped.join(' ');
}

export function normalizeReplyBodyForMatch(text: string): {
  norm: string;
  first: string;
  words: string[];
} {
  const expanded = expandNumericReplyAliases(text);
  const norm = String(expanded || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u00FF0-9]/g, '')
    .trim();
  const words = norm.split(/\s+/).filter(Boolean);
  return { norm, first: words[0] || '', words };
}

export function cleanReplyTriggerToken(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u00FF0-9]/g, '')
    .trim();
}

function isWholeWord(words: string[], token: string): boolean {
  return words.includes(token);
}

function isNumericToken(token: string): boolean {
  return /^[0-9]+$/.test(token);
}

/**
 * Compara resposta com gatilho conforme o modo configurado.
 * - word: mensagem inteira, primeira palavra ou palavra isolada (padrão)
 * - phrase: frase exata ou substring de frase multi-palavra
 * - contains: gatilho aparece em qualquer lugar (sem match dentro de palavra)
 * - numeric_exact: só dígitos na mensagem, match exato (1 ≠ 10)
 */
export function matchReplyTriggerToken(
  cleanTok: string,
  bodyText: string,
  mode: ReplyMatchMode = 'word'
): ReplyFlowMatchResult {
  if (!cleanTok) return { matched: false };
  const { norm, first, words } = normalizeReplyBodyForMatch(bodyText);
  if (!norm) return { matched: false };

  const base = { matchedToken: cleanTok, matchMode: mode };

  if (mode === 'numeric_exact') {
    if (!isNumericToken(cleanTok)) return { matched: false };
    if (words.length !== 1) return { matched: false };
    if (norm === cleanTok || first === cleanTok) return { matched: true, ...base };
    return { matched: false };
  }

  if (mode === 'contains') {
    if (cleanTok.includes(' ')) {
      if (norm.includes(cleanTok)) return { matched: true, ...base };
      return { matched: false };
    }
    if (isWholeWord(words, cleanTok)) return { matched: true, ...base };
    return { matched: false };
  }

  if (mode === 'phrase') {
    if (norm === cleanTok || first === cleanTok) return { matched: true, ...base };
    if (cleanTok.includes(' ') && norm.includes(cleanTok)) return { matched: true, ...base };
    return { matched: false };
  }

  // word (default / retrocompat)
  if (cleanTok === norm || cleanTok === first) return { matched: true, ...base };
  if (isWholeWord(words, cleanTok)) return { matched: true, ...base };
  if (cleanTok.includes(' ') && norm.includes(cleanTok)) return { matched: true, ...base };
  if (isNumericToken(cleanTok) && isWholeWord(words, cleanTok)) return { matched: true, ...base };
  return { matched: false };
}

export function detectGlobalOptOut(
  bodyText: string,
  extraKeywords: string[] = []
): { matched: boolean; keyword?: string } {
  const keywords = [
    ...DEFAULT_GLOBAL_OPT_OUT_KEYWORDS,
    ...extraKeywords.map((k) => cleanReplyTriggerToken(k)).filter(Boolean),
  ];
  const unique = [...new Set(keywords)];
  for (const kw of unique) {
    const r = matchReplyTriggerToken(kw, bodyText, kw.includes(' ') ? 'phrase' : 'word');
    if (r.matched) return { matched: true, keyword: kw };
  }
  return { matched: false };
}

export type ReplyFlowOptionLike = {
  tokens?: string[];
  priority?: number;
  matchMode?: ReplyMatchMode;
  reply?: string;
  marketingEffect?: string;
};

/** Escolhe a melhor opção: maior priority, depois gatilho mais longo, depois ordem. */
export function findBestMatchingOption(
  options: ReplyFlowOptionLike[],
  bodyText: string,
  defaultMatchMode: ReplyMatchMode = 'word'
): {
  optionIndex: number;
  matchedToken: string;
  matchMode: ReplyMatchMode;
} | null {
  const candidates: ReplyFlowOptionMatchCandidate[] = [];

  options.forEach((opt, optionIndex) => {
    const priority = Number.isFinite(Number(opt.priority)) ? Number(opt.priority) : 0;
    const mode = (opt.matchMode as ReplyMatchMode) || defaultMatchMode;
    for (const rawTok of opt.tokens || []) {
      const cleanTok = cleanReplyTriggerToken(rawTok);
      if (!cleanTok) continue;
      const result = matchReplyTriggerToken(cleanTok, bodyText, mode);
      if (result.matched) {
        candidates.push({
          optionIndex,
          priority,
          token: cleanTok,
          matchMode: mode,
          result,
        });
      }
    }
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.token.length !== a.token.length) return b.token.length - a.token.length;
    return a.optionIndex - b.optionIndex;
  });

  const best = candidates[0];
  return {
    optionIndex: best.optionIndex,
    matchedToken: best.token,
    matchMode: best.matchMode,
  };
}

export function replyMatchesGate(
  step: {
    acceptAnyReply?: boolean;
    validTokens?: string[];
    matchMode?: ReplyMatchMode;
  },
  bodyText: string,
  opts?: { nonTextReply?: boolean }
): boolean {
  if (step.acceptAnyReply) return true;
  const t = String(bodyText || '').trim();
  const nonText = Boolean(opts?.nonTextReply);
  if (!t && !nonText) return false;
  const tokens = step.validTokens || [];
  if (tokens.length === 0) return nonText || !!t;
  if (!t && nonText) return false;
  const mode = (step.matchMode as ReplyMatchMode) || 'word';
  return tokens.some((tok) => matchReplyTriggerToken(cleanReplyTriggerToken(tok), t, mode).matched);
}

/** Simula qual rota seria acionada (preview no editor). */
export function simulateReplyFlowMatch(input: {
  bodyText: string;
  acceptAnyReply?: boolean;
  validTokens?: string[];
  matchMode?: ReplyMatchMode;
  options?: ReplyFlowOptionLike[];
  invalidReplyBody?: string;
}): {
  kind: 'any' | 'option' | 'gate' | 'invalid' | 'empty';
  optionIndex?: number;
  matchedToken?: string;
  matchMode?: ReplyMatchMode;
  message?: string;
} {
  const t = String(input.bodyText || '').trim();
  if (!t) return { kind: 'empty', message: 'Digite uma resposta simulada.' };

  if (input.options && input.options.length > 0) {
    const hit = findBestMatchingOption(input.options, t, input.matchMode || 'word');
    if (hit) {
      const opt = input.options[hit.optionIndex];
      return {
        kind: 'option',
        optionIndex: hit.optionIndex,
        matchedToken: hit.matchedToken,
        matchMode: hit.matchMode,
        message: opt?.reply?.trim() || 'Resposta configurada nesta rota.',
      };
    }
    return {
      kind: 'invalid',
      message: input.invalidReplyBody?.trim() || 'Resposta não reconhecida — cairia no fallback.',
    };
  }

  if (input.acceptAnyReply) {
    return { kind: 'any', message: 'Qualquer resposta avança para o follow-up.' };
  }

  if (replyMatchesGate(input, t)) {
    return { kind: 'gate', matchedToken: input.validTokens?.[0], matchMode: input.matchMode || 'word' };
  }

  return {
    kind: 'invalid',
    message: input.invalidReplyBody?.trim() || 'Resposta não reconhecida.',
  };
}
