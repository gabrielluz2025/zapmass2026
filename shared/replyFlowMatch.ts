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

/** Remove acentos/diacríticos para matching tolerante em português. */
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeReplyBodyForMatch(text: string): {
  norm: string;
  first: string;
  words: string[];
} {
  const expanded = expandNumericReplyAliases(text);
  const norm = stripDiacritics(String(expanded || ''))
    .trim()
    .toLowerCase()
    .replace(/[^\w\s0-9]/g, '')
    .trim();
  const words = norm.split(/\s+/).filter(Boolean);
  return { norm, first: words[0] || '', words };
}

export function cleanReplyTriggerToken(raw: string): string {
  return stripDiacritics(String(raw || ''))
    .toLowerCase()
    .replace(/[^\w\s0-9]/g, '')
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

/** Frases compostas de saudação (ordenadas da mais longa para a mais curta) */
export const GREETING_PHRASES: string[] = [
  'tudo bem com voce',
  'tudo bem com vc',
  'tudo bom com voce',
  'tudo bom com vc',
  'como vai voce',
  'como vai vc',
  'como voce esta',
  'como vc esta',
  'como voce ta',
  'como vc ta',
  'como c ta',
  'fala comigo',
  'fala ai',
  'fala aí',
  'boa tarde',
  'boa noite',
  'bom dia',
  'tudo bem',
  'tudo bom',
  'tudo joia',
  'tudo certo',
  'tudo otimo',
  'tudo beleza',
  'td bem',
  'td bom',
  'td certo',
  'td joia',
  'como vai',
  'como esta',
  'como ta',
  'e ai',
];

/** Palavras individuais de saudação */
export const GREETING_WORDS: string[] = [
  'ola',
  'oi',
  'oii',
  'oiii',
  'oie',
  'opa',
  'salve',
  'eai',
  'buenas',
  'beleza',
  'blz',
  'fala',
];

/** Conectivos e pronomes neutros permitidos junto à saudação */
export const GREETING_FILLERS: string[] = [
  'amigo',
  'amiga',
  'irmao',
  'irma',
  'pessoal',
  'gente',
  'parceiro',
  'parceira',
  'camarada',
  'cara',
  'voce',
  'vc',
  'por ai',
  'por aqui',
  'ai',
  'aqui',
];

/** Identifica se uma mensagem recebida é primariamente uma saudação cortês. */
export function isGreetingMessage(text: string): boolean {
  const { norm } = normalizeReplyBodyForMatch(text);
  if (!norm) return false;

  let current = ` ${norm} `;
  let hasGreeting = false;

  // 1. Procura e substitui frases compostas de saudação
  for (const phrase of GREETING_PHRASES) {
    const cleanPhrase = cleanReplyTriggerToken(phrase);
    if (!cleanPhrase) continue;
    const pattern = new RegExp(`\\b${cleanPhrase.replace(/\s+/g, '\\s+')}\\b`, 'g');
    if (pattern.test(current)) {
      hasGreeting = true;
      current = current.replace(pattern, ' ');
    }
  }

  // 2. Procura e substitui palavras únicas de saudação
  for (const word of GREETING_WORDS) {
    const cleanWord = cleanReplyTriggerToken(word);
    if (!cleanWord) continue;
    const pattern = new RegExp(`\\b${cleanWord}\\b`, 'g');
    if (pattern.test(current)) {
      hasGreeting = true;
      current = current.replace(pattern, ' ');
    }
  }

  if (!hasGreeting) return false;

  // 3. Remove conectivos e pronomes neutros permitidos
  for (const filler of GREETING_FILLERS) {
    const cleanFiller = cleanReplyTriggerToken(filler);
    if (!cleanFiller) continue;
    const pattern = new RegExp(`\\b${cleanFiller.replace(/\s+/g, '\\s+')}\\b`, 'g');
    current = current.replace(pattern, ' ');
  }

  // 4. Se não sobrar nada significativo além de espaços, é puramente uma saudação
  const remainder = current.trim().replace(/\s+/g, '');
  return remainder.length === 0;
}

/** Obtém a hora civil em Brasília (fuso America/Sao_Paulo). */
export function getBrazilHour(date: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(date);
    const v = parts.find((p) => p.type === 'hour')?.value;
    let n = v != null ? parseInt(v, 10) : NaN;
    if (n === 24) n = 0;
    if (Number.isFinite(n)) return n;
  } catch {
    // fallback
  }
  const utcHours = date.getUTCHours();
  return (utcHours - 3 + 24) % 24;
}

/** Retorna a saudação cordial de retribuição compatível com o horário de Brasília. */
export function buildPoliteGreeting(incomingText?: string, date: Date = new Date()): string {
  const hour = getBrazilHour(date);
  let periodoSaudacao: string;
  let periodo: 'manha' | 'tarde' | 'noite';

  if (hour >= 5 && hour < 12) {
    periodoSaudacao = 'Bom dia';
    periodo = 'manha';
  } else if (hour >= 12 && hour < 18) {
    periodoSaudacao = 'Boa tarde';
    periodo = 'tarde';
  } else {
    periodoSaudacao = 'Boa noite';
    periodo = 'noite';
  }

  const cleanIncoming = cleanReplyTriggerToken(incomingText || '');
  const mentionsBomDia = cleanIncoming.includes('bom dia');
  const mentionsBoaTarde = cleanIncoming.includes('boa tarde');
  const mentionsBoaNoite = cleanIncoming.includes('boa noite');

  const discordant =
    (mentionsBomDia && periodo !== 'manha') ||
    (mentionsBoaTarde && periodo !== 'tarde') ||
    (mentionsBoaNoite && periodo !== 'noite');

  if (discordant) {
    return `Olá, ${periodoSaudacao.toLowerCase()}! Tudo bem?`;
  }

  return `${periodoSaudacao}! Tudo bem?`;
}

/** Formata uma resposta acolhedora de erro/instrução prefixada pela saudação cordial. */
export function formatPoliteGreetingInvalidReply(
  baseInvalidBody?: string,
  greeting?: string,
  date: Date = new Date()
): string {
  const g = greeting || buildPoliteGreeting(undefined, date);
  const raw = String(baseInvalidBody || '').trim();

  if (!raw) {
    return `${g} Para eu te ajudar da melhor forma, por favor escolha uma das opções acima.`;
  }

  const stripped = raw
    .replace(
      /^(não entendi|nao entendi|opção inválida|opcao invalida|resposta inválida|resposta invalida)[\.\!\,\:\;\s]*/i,
      ''
    )
    .trim();

  if (!stripped) {
    return `${g} Para eu te ajudar da melhor forma, por favor escolha uma das opções acima.`;
  }

  if (/^por favor\b/i.test(stripped)) {
    const afterPorFavor = stripped.replace(/^por favor[\,\:\s]*/i, '').trim();
    const instruction = afterPorFavor.charAt(0).toLowerCase() + afterPorFavor.slice(1);
    return `${g} Para eu te ajudar da melhor forma, por favor ${instruction}`;
  }

  if (
    stripped.toLowerCase().startsWith('para eu te ajudar') ||
    stripped.toLowerCase().startsWith(g.toLowerCase())
  ) {
    return stripped;
  }

  const instruction = stripped.charAt(0).toLowerCase() + stripped.slice(1);
  return `${g} Para eu te ajudar da melhor forma, por favor ${instruction}`;
}

/** Simula qual rota seria acionada (preview no editor). */
export function simulateReplyFlowMatch(input: {
  bodyText: string;
  acceptAnyReply?: boolean;
  validTokens?: string[];
  matchMode?: ReplyMatchMode;
  options?: ReplyFlowOptionLike[];
  invalidReplyBody?: string;
  politeGreetingEnabled?: boolean;
}): {
  kind: 'any' | 'option' | 'gate' | 'invalid' | 'greeting' | 'empty';
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

    if (input.politeGreetingEnabled !== false && isGreetingMessage(t)) {
      const g = buildPoliteGreeting(t);
      return {
        kind: 'greeting',
        message: formatPoliteGreetingInvalidReply(input.invalidReplyBody, g),
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

  if (input.politeGreetingEnabled !== false && isGreetingMessage(t)) {
    const g = buildPoliteGreeting(t);
    return {
      kind: 'greeting',
      message: formatPoliteGreetingInvalidReply(input.invalidReplyBody, g),
    };
  }

  return {
    kind: 'invalid',
    message: input.invalidReplyBody?.trim() || 'Resposta não reconhecida.',
  };
}

/** Respostas de cortesia/encerramento — não são interesse comercial ("quero"). */
export const POLITE_ACK_PHRASES = [
  'amem',
  'amen',
  'tamo junto',
  'tamos juntos',
  'deus abencoe',
  'deus abençoe',
  'fica com deus',
  'gloria a deus',
  'glória a deus',
  'aleluia',
  'obrigado',
  'obrigada',
  'valeu',
  'abraço',
  'abraco',
  'abraços',
  'abencoes',
  'abençoes',
  'paz do senhor',
  'gratidao',
  'gratidão',
  'tmj',
];

/** Tokens de interesse explícito (fora cortesia). */
export const POSITIVE_INTENT_TOKENS = [
  'quero',
  'sim',
  'aceito',
  'topo',
  'pode ser',
  'fechado',
  'bora',
  'vamos',
  'interesse',
  'interessado',
  'interessada',
];

export type ReplyIntentKind =
  | 'empty'
  | 'opt_out'
  | 'opt_in'
  | 'polite_ack'
  | 'flow_match'
  | 'flow_invalid'
  | 'neutral';

export type ClassifyReplyIntentResult = {
  kind: ReplyIntentKind;
  label: string;
  matchedToken?: string;
  flowMatch?: ReturnType<typeof simulateReplyFlowMatch>;
  suggestedLeadClass?: 'hot' | 'warm' | 'cold' | 'blacklist';
  /** Disse quero/sim antes e a última resposta foi sair. */
  queroThenSair?: boolean;
};

function normIntentText(text: string): string {
  return normalizeReplyBodyForMatch(text).norm;
}

/** Detecta "amém", "tamo junto" etc. — engajamento social, não opt-in. */
export function isPoliteAcknowledgment(bodyText: string): boolean {
  const norm = normIntentText(bodyText);
  if (!norm) return false;
  for (const phrase of POLITE_ACK_PHRASES) {
    const clean = cleanReplyTriggerToken(phrase);
    if (!clean) continue;
    if (norm === clean || norm.includes(clean)) return true;
  }
  return false;
}

/** Interesse explícito (quero/sim) excluindo cortesia e opt-out. */
export function isPositiveCampaignIntent(bodyText: string): boolean {
  const t = String(bodyText || '').trim();
  if (!t || isPoliteAcknowledgment(t)) return false;
  if (detectGlobalOptOut(t).matched) return false;
  const { norm, words } = normalizeReplyBodyForMatch(t);
  if (!norm) return false;
  for (const tok of POSITIVE_INTENT_TOKENS) {
    const r = matchReplyTriggerToken(tok, t, 'word');
    if (r.matched) return true;
  }
  if (/^[1-9]$/.test(norm) || (words.length === 1 && /^[0-9]+$/.test(words[0]))) return true;
  return false;
}

/** Classifica intenção da resposta para automação e revisão manual no chat. */
export function classifyReplyIntent(
  bodyText: string,
  ctx?: {
    globalOptOutKeywords?: string[];
    acceptAnyReply?: boolean;
    validTokens?: string[];
    matchMode?: ReplyMatchMode;
    options?: ReplyFlowOptionLike[];
    invalidReplyBody?: string;
  }
): ClassifyReplyIntentResult {
  const t = String(bodyText || '').trim();
  if (!t) {
    return { kind: 'empty', label: 'Sem texto na mensagem.' };
  }

  const optOut = detectGlobalOptOut(t, ctx?.globalOptOutKeywords);
  if (optOut.matched) {
    return {
      kind: 'opt_out',
      label: `Pediu sair (${optOut.keyword})`,
      matchedToken: optOut.keyword,
      suggestedLeadClass: 'blacklist',
    };
  }

  if (isPoliteAcknowledgment(t)) {
    return {
      kind: 'polite_ack',
      label: 'Cortesia/encerramento (não é "quero")',
      suggestedLeadClass: 'warm',
    };
  }

  const flowMatch = ctx
    ? simulateReplyFlowMatch({
        bodyText: t,
        acceptAnyReply: ctx.acceptAnyReply,
        validTokens: ctx.validTokens,
        matchMode: ctx.matchMode,
        options: ctx.options,
        invalidReplyBody: ctx.invalidReplyBody,
      })
    : undefined;

  if (flowMatch) {
    if (flowMatch.kind === 'option' || flowMatch.kind === 'gate') {
      return {
        kind: 'flow_match',
        label: `Fluxo: gatilho "${flowMatch.matchedToken || '?'}"`,
        matchedToken: flowMatch.matchedToken,
        flowMatch,
        suggestedLeadClass: 'hot',
      };
    }
    if (flowMatch.kind === 'any') {
      return {
        kind: 'flow_match',
        label: 'Fluxo aceita qualquer resposta',
        flowMatch,
        suggestedLeadClass: 'warm',
      };
    }
    if (flowMatch.kind === 'invalid') {
      if (isPositiveCampaignIntent(t)) {
        return {
          kind: 'opt_in',
          label: 'Interesse explícito (quero/sim)',
          flowMatch,
          suggestedLeadClass: 'hot',
        };
      }
      return {
        kind: 'flow_invalid',
        label: flowMatch.message || 'Resposta não reconhecida no fluxo',
        flowMatch,
        suggestedLeadClass: 'cold',
      };
    }
  }

  if (isPositiveCampaignIntent(t)) {
    return {
      kind: 'opt_in',
      label: 'Interesse explícito (quero/sim)',
      suggestedLeadClass: 'hot',
    };
  }

  return {
    kind: 'neutral',
    label: 'Resposta neutra — revisar manualmente',
    suggestedLeadClass: 'warm',
  };
}

export type ReplyIntentContext = {
  globalOptOutKeywords?: string[];
  acceptAnyReply?: boolean;
  validTokens?: string[];
  matchMode?: ReplyMatchMode;
  options?: ReplyFlowOptionLike[];
  invalidReplyBody?: string;
};

function hadPriorQueroIntent(texts: string[], ctx?: ReplyIntentContext): boolean {
  if (texts.length <= 1) return false;
  for (const text of texts.slice(0, -1)) {
    const r = classifyReplyIntent(text, ctx);
    if (r.kind === 'opt_in' || r.kind === 'flow_match') return true;
    if (isPositiveCampaignIntent(text)) return true;
  }
  return false;
}

/**
 * Classifica usando histórico inbound (ordem cronológica).
 * Regra: disse «quero» antes e depois «sair» → lista negra.
 */
export function classifyReplyIntentFromHistory(
  inboundTextsOldestFirst: string[],
  ctx?: ReplyIntentContext
): ClassifyReplyIntentResult {
  const texts = inboundTextsOldestFirst.map((t) => String(t || '').trim()).filter(Boolean);
  if (texts.length === 0) {
    return { kind: 'empty', label: 'Sem texto na mensagem.' };
  }

  const latest = texts[texts.length - 1];
  const latestResult = classifyReplyIntent(latest, ctx);

  if (texts.length >= 2 && latestResult.kind === 'opt_out' && hadPriorQueroIntent(texts, ctx)) {
    return {
      kind: 'opt_out',
      label: 'Disse «quero» antes e agora pediu sair — lista negra',
      matchedToken: latestResult.matchedToken,
      suggestedLeadClass: 'blacklist',
      queroThenSair: true,
    };
  }

  return latestResult;
}

/** Classificação aplicável automaticamente (quero → quente; sair → lista negra). */
export function autoApplyLeadClassFromIntent(
  intent: ClassifyReplyIntentResult
): 'hot' | 'blacklist' | null {
  if (intent.kind === 'opt_in' || intent.kind === 'flow_match') return 'hot';
  if (intent.kind === 'opt_out') return 'blacklist';
  return null;
}

export type ActionableReplyMatch = {
  classification: 'hot' | 'blacklist';
  replyText: string;
  intentKind: ReplyIntentKind;
  intentLabel: string;
  queroThenSair: boolean;
};

/**
 * Procura «quero» ou «sair» em todo o histórico inbound (não só na última mensagem).
 * Prioridade: última resposta com regra quero→sair; senão opt_out; senão opt_in mais recente.
 */
export function findActionableReplyInHistory(
  inboundTextsOldestFirst: string[],
  ctx?: ReplyIntentContext
): ActionableReplyMatch | null {
  const texts = inboundTextsOldestFirst.map((t) => String(t || '').trim()).filter(Boolean);
  if (texts.length === 0) return null;

  const historyIntent = classifyReplyIntentFromHistory(texts, ctx);
  if (historyIntent.kind === 'opt_out') {
    return {
      classification: 'blacklist',
      replyText: texts[texts.length - 1],
      intentKind: 'opt_out',
      intentLabel: historyIntent.label,
      queroThenSair: Boolean(historyIntent.queroThenSair),
    };
  }
  if (historyIntent.kind === 'opt_in' || historyIntent.kind === 'flow_match') {
    return {
      classification: 'hot',
      replyText: texts[texts.length - 1],
      intentKind: historyIntent.kind,
      intentLabel: historyIntent.label,
      queroThenSair: false,
    };
  }

  for (let i = texts.length - 1; i >= 0; i--) {
    const slice = texts.slice(0, i + 1);
    const r = classifyReplyIntent(texts[i], ctx);
    if (r.kind === 'opt_out') {
      const hi = classifyReplyIntentFromHistory(slice, ctx);
      return {
        classification: 'blacklist',
        replyText: texts[i],
        intentKind: 'opt_out',
        intentLabel: hi.label,
        queroThenSair: Boolean(hi.queroThenSair),
      };
    }
    if (r.kind === 'opt_in' || r.kind === 'flow_match') {
      return {
        classification: 'hot',
        replyText: texts[i],
        intentKind: r.kind,
        intentLabel: r.label,
        queroThenSair: false,
      };
    }
  }

  return null;
}
