/** Matching de gatilhos do fluxo por resposta — compartilhado entre servidor e UI. */
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
const NUMERIC_WORDS = {
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
export function expandNumericReplyAliases(text) {
    let s = String(text || '');
    s = s.replace(/([0-9])[\uFE0F\u20E3]/g, '$1');
    s = s.replace(/[\u2460-\u2473]/g, (ch) => String(ch.charCodeAt(0) - 0x2460 + 1));
    const words = s
        .trim()
        .toLowerCase()
        .replace(/[^\w\s\u00C0-\u00FF0-9]/g, '')
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0)
        return s.trim();
    const mapped = words.map((w) => NUMERIC_WORDS[w] ?? w);
    return mapped.join(' ');
}
/** Remove acentos/diacríticos para matching tolerante em português. */
function stripDiacritics(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
export function normalizeReplyBodyForMatch(text) {
    const expanded = expandNumericReplyAliases(text);
    const norm = stripDiacritics(String(expanded || ''))
        .trim()
        .toLowerCase()
        .replace(/[^\w\s0-9]/g, '')
        .trim();
    const words = norm.split(/\s+/).filter(Boolean);
    return { norm, first: words[0] || '', words };
}
export function cleanReplyTriggerToken(raw) {
    return stripDiacritics(String(raw || ''))
        .toLowerCase()
        .replace(/[^\w\s0-9]/g, '')
        .trim();
}
function isWholeWord(words, token) {
    return words.includes(token);
}
function isNumericToken(token) {
    return /^[0-9]+$/.test(token);
}
/**
 * Compara resposta com gatilho conforme o modo configurado.
 * - word: mensagem inteira, primeira palavra ou palavra isolada (padrão)
 * - phrase: frase exata ou substring de frase multi-palavra
 * - contains: gatilho aparece em qualquer lugar (sem match dentro de palavra)
 * - numeric_exact: só dígitos na mensagem, match exato (1 ≠ 10)
 */
export function matchReplyTriggerToken(cleanTok, bodyText, mode = 'word') {
    if (!cleanTok)
        return { matched: false };
    const { norm, first, words } = normalizeReplyBodyForMatch(bodyText);
    if (!norm)
        return { matched: false };
    const base = { matchedToken: cleanTok, matchMode: mode };
    if (mode === 'numeric_exact') {
        if (!isNumericToken(cleanTok))
            return { matched: false };
        if (words.length !== 1)
            return { matched: false };
        if (norm === cleanTok || first === cleanTok)
            return { matched: true, ...base };
        return { matched: false };
    }
    if (mode === 'contains') {
        if (cleanTok.includes(' ')) {
            if (norm.includes(cleanTok))
                return { matched: true, ...base };
            return { matched: false };
        }
        if (isWholeWord(words, cleanTok))
            return { matched: true, ...base };
        return { matched: false };
    }
    if (mode === 'phrase') {
        if (norm === cleanTok || first === cleanTok)
            return { matched: true, ...base };
        if (cleanTok.includes(' ') && norm.includes(cleanTok))
            return { matched: true, ...base };
        return { matched: false };
    }
    // word (default / retrocompat)
    if (cleanTok === norm || cleanTok === first)
        return { matched: true, ...base };
    if (isWholeWord(words, cleanTok))
        return { matched: true, ...base };
    if (cleanTok.includes(' ') && norm.includes(cleanTok))
        return { matched: true, ...base };
    if (isNumericToken(cleanTok) && isWholeWord(words, cleanTok))
        return { matched: true, ...base };
    return { matched: false };
}
export function detectGlobalOptOut(bodyText, extraKeywords = []) {
    const keywords = [
        ...DEFAULT_GLOBAL_OPT_OUT_KEYWORDS,
        ...extraKeywords.map((k) => cleanReplyTriggerToken(k)).filter(Boolean),
    ];
    const unique = [...new Set(keywords)];
    for (const kw of unique) {
        const r = matchReplyTriggerToken(kw, bodyText, kw.includes(' ') ? 'phrase' : 'word');
        if (r.matched)
            return { matched: true, keyword: kw };
    }
    return { matched: false };
}
/** Escolhe a melhor opção: maior priority, depois gatilho mais longo, depois ordem. */
export function findBestMatchingOption(options, bodyText, defaultMatchMode = 'word') {
    const candidates = [];
    options.forEach((opt, optionIndex) => {
        const priority = Number.isFinite(Number(opt.priority)) ? Number(opt.priority) : 0;
        const mode = opt.matchMode || defaultMatchMode;
        for (const rawTok of opt.tokens || []) {
            const cleanTok = cleanReplyTriggerToken(rawTok);
            if (!cleanTok)
                continue;
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
    if (candidates.length === 0)
        return null;
    candidates.sort((a, b) => {
        if (b.priority !== a.priority)
            return b.priority - a.priority;
        if (b.token.length !== a.token.length)
            return b.token.length - a.token.length;
        return a.optionIndex - b.optionIndex;
    });
    const best = candidates[0];
    return {
        optionIndex: best.optionIndex,
        matchedToken: best.token,
        matchMode: best.matchMode,
    };
}
export function replyMatchesGate(step, bodyText, opts) {
    if (step.acceptAnyReply)
        return true;
    const t = String(bodyText || '').trim();
    const nonText = Boolean(opts?.nonTextReply);
    if (!t && !nonText)
        return false;
    const tokens = step.validTokens || [];
    if (tokens.length === 0)
        return nonText || !!t;
    if (!t && nonText)
        return false;
    const mode = step.matchMode || 'word';
    return tokens.some((tok) => matchReplyTriggerToken(cleanReplyTriggerToken(tok), t, mode).matched);
}

export const GREETING_PHRASES = [
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

export const GREETING_WORDS = [
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

export const GREETING_FILLERS = [
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

export function isGreetingMessage(text) {
    const { norm } = normalizeReplyBodyForMatch(text);
    if (!norm) return false;

    let current = ` ${norm} `;
    let hasGreeting = false;

    for (const phrase of GREETING_PHRASES) {
        const cleanPhrase = cleanReplyTriggerToken(phrase);
        if (!cleanPhrase) continue;
        const pattern = new RegExp(`\\b${cleanPhrase.replace(/\\s+/g, '\\s+')}\\b`, 'g');
        if (pattern.test(current)) {
            hasGreeting = true;
            current = current.replace(pattern, ' ');
        }
    }

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

    for (const filler of GREETING_FILLERS) {
        const cleanFiller = cleanReplyTriggerToken(filler);
        if (!cleanFiller) continue;
        const pattern = new RegExp(`\\b${cleanFiller.replace(/\\s+/g, '\\s+')}\\b`, 'g');
        current = current.replace(pattern, ' ');
    }

    const remainder = current.trim().replace(/\s+/g, '');
    return remainder.length === 0;
}

export function getBrazilHour(date = new Date()) {
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

export function buildPoliteGreeting(incomingText, date = new Date()) {
    const hour = getBrazilHour(date);
    let periodoSaudacao;
    let periodo;

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

export function formatPoliteGreetingInvalidReply(baseInvalidBody, greeting, date = new Date()) {
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
export function simulateReplyFlowMatch(input) {
    const t = String(input.bodyText || '').trim();
    if (!t)
        return { kind: 'empty', message: 'Digite uma resposta simulada.' };
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
