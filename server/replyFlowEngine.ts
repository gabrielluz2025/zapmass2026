import { campaignRotationIndexFromPhone, normalizeCampaignTemplateDelimiters, resolveCampaignSpintax } from '../shared/campaignSpintax.js';
import {
    cleanReplyTriggerToken,
    detectGlobalOptOut,
    findBestMatchingOption,
    matchReplyTriggerToken,
    normalizeReplyBodyForMatch,
    replyMatchesGate,
    type ReplyMatchMode,
    DEFAULT_GLOBAL_OPT_OUT_KEYWORDS,
    isGreetingMessage,
    buildPoliteGreeting,
    formatPoliteGreetingInvalidReply,
} from '../shared/replyFlowMatch.js';
import { campaignClockVars } from '../src/utils/campaignClockVars.js';
import { campaignMediaStorageKey } from '../src/utils/campaignMediaKeys.js';
import { isSuspiciousContactName } from '../src/utils/contactNameNormalize.js';
import { fetchCampaignDoc, usePostgresCampaigns } from './campaignStore.js';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { extractEvolutionMessageBody } from './evolutionWebhookMessages.js';

export type ReplyFlowStepOption = {
    tokens: string[];
    reply: string;
    marketingEffect?: 'none' | 'opt_in' | 'opt_out';
    /** Maior = vence em empate de gatilhos. */
    priority?: number;
    matchMode?: ReplyMatchMode;
    /** Chave em `campaignMediaById` — foto enviada com o texto da resposta. */
    mediaStorageKey?: string;
};

export type ReplyFlowStepDef = {
    body: string;
    acceptAnyReply: boolean;
    validTokens: string[];
    invalidReplyBody: string;
    marketingEffect?: 'none' | 'opt_in' | 'opt_out';
    options?: ReplyFlowStepOption[];
    matchMode?: ReplyMatchMode;
    /** Horas sem resposta antes de enviar timeoutMessage (0 = desligado). */
    timeoutHours?: number;
    timeoutMessage?: string;
};

export type ReplyFlowDefMeta = {
    globalOptOutEnabled?: boolean;
    globalOptOutKeywords?: string[];
    /** Número máximo de tentativas de resposta inválida antes de encerrar o fluxo (padrão: 3) */
    maxInvalidReplyAttempts?: number;
    /** Retribui saudações amigavelmente antes de solicitar opção (padrão: true) */
    politeGreetingEnabled?: boolean;
    autoGreetingReply?: boolean;
};

export type ReplyFlowPendingOutbound = {
    message: string;
    mediaStorageKey?: string;
    /** Encerra sessão após envio OK (resposta terminal de menu). */
    disposeAfterSend: boolean;
    enqueuedAt: number;
};

export type ReplyFlowSession = {
    campaignId: string;
    ownerUid?: string;
    awaitingAfterStep: number;
    vars: Record<string, string>;
    toRaw: string;
    registeredConvKey?: string;
    /** Contador de respostas inválidas consecutivas */
    invalidReplyCount?: number;
    /** Contador de saudações consecutivas para proteção contra loops entre robôs */
    greetingReplyCount?: number;
    /** Evita várias retribuições de saudação seguidas (webhook duplicado / sync). */
    lastPoliteGreetingAt?: number;
    /** Resposta enfileirada aguardando confirmação de envio — sobrevive queda/restart. */
    pendingOutbound?: ReplyFlowPendingOutbound;
    /** Usado para rotear inbound quando há mais de uma campanha no mesmo telefone. */
    lastActivityAt?: number;
};

const POLITE_GREETING_COOLDOWN_MS = 45_000;
const MAX_POLITE_GREETING_REPLIES = 2;

function normalizeFlowTextForCompare(text: string): string {
    return String(text || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

/**
 * Define o texto/mídia após match de opção de menu.
 * Se a resposta da opção repete a abertura (comum no wizard) e há etapa 2+, envia a próxima etapa com anexo.
 */
export function resolveReplyFlowOptionOutbound(params: {
    matchedOption: ReplyFlowStepOption;
    gateStep: ReplyFlowStepDef;
    steps: ReplyFlowStepDef[];
    awaitingStepIndex: number;
    phoneDigits: string;
    vars: Record<string, string>;
    campaignId: string;
}): {
    message: string;
    mediaStorageKey?: string;
    disposeAfterSend: boolean;
    afterSend?: { phoneDigits: string; newAwaitingAfterStep: number };
} {
    const { matchedOption, gateStep, steps, awaitingStepIndex, phoneDigits, vars, campaignId } =
        params;
    const openingComparable = normalizeFlowTextForCompare(
        applyMessageVars(gateStep.body, phoneDigits, vars)
    );
    let replyBody = applyMessageVars(matchedOption.reply, phoneDigits, vars).trim();
    let mediaKey = String(matchedOption.mediaStorageKey || '').trim();
    const nextIdx = awaitingStepIndex + 1;
    const nextStep = nextIdx < steps.length ? steps[nextIdx] : undefined;
    const nextBody = nextStep ? applyMessageVars(nextStep.body, phoneDigits, vars).trim() : '';

    const replyLooksLikeOpening =
        !replyBody || normalizeFlowTextForCompare(replyBody) === openingComparable;

    if (nextBody && replyLooksLikeOpening) {
        replyBody = nextBody;
        if (!mediaKey) {
            mediaKey = campaignMediaStorageKey(campaignId, nextIdx);
        }
        const isLastStep = nextIdx >= steps.length - 1;
        return {
            message: replyBody,
            mediaStorageKey: mediaKey || undefined,
            disposeAfterSend: isLastStep,
            afterSend: isLastStep ? undefined : { phoneDigits, newAwaitingAfterStep: nextIdx },
        };
    }

    return {
        message: replyBody,
        mediaStorageKey: mediaKey || undefined,
        disposeAfterSend: true,
        afterSend: undefined,
    };
}

export type ReplyFlowOutboundItem = {
    to: string;
    message: string;
    connectionId: string;
    campaignId?: string;
    /** Dono da campanha — obrigatório após o disparo sair de RAM (WAITING_REPLY / restart). */
    ownerUid?: string;
    sendAsMedia?: boolean;
    /** Chave em `campaignMediaById` (ex.: `campaignId:reply-step:1`). */
    mediaStorageKey?: string;
    replyFlowAfterSend?: { phoneDigits: string; newAwaitingAfterStep: number };
    /** Encerra sessão após envio OK (menu terminal / opt-out de fluxo). */
    replyFlowDisposeAfterSend?: boolean;
};

export type CampaignRecipient = { phone: string; vars: Record<string, string> };

export type ReplyFlowCallbacks = {
    enqueue: (item: ReplyFlowOutboundItem) => void | Promise<void>;
    onMarketingConsent?: (
        ownerUid: string | undefined,
        campaignId: string,
        effect: 'opt_in' | 'opt_out',
        phoneDigits: string,
        replyText: string,
        connectionId?: string
    ) => void;
    onLog?: (message: string, payload?: Record<string, unknown>) => void;
    /** Telemetria de resposta com match reconhecido (não dispara em cortesia/neutro). */
    onInboundReply?: (info: {
        campaignId: string;
        connectionId: string;
        phoneDigits: string;
        ownerUid?: string;
        replyText: string;
        matchedToken?: string;
        marketingEffect?: 'none' | 'opt_in' | 'opt_out';
        matchKind: 'option' | 'gate' | 'any';
    }) => void;
    isCampaignPaused?: (campaignId: string) => boolean;
    /** Chamado quando todas as sessões de uma campanha são encerradas (reply flow concluído). */
    onAllSessionsClosed?: (campaignId: string) => void;
    /** Chamado quando uma sessão é criada ou seu estado muda (awaitingAfterStep) — para persistência. */
    onSessionSave?: (connectionId: string, phoneDigits: string, session: ReplyFlowSession) => void;
    /** Chamado quando uma sessão é descartada — para remoção da persistência. */
    onSessionDisposed?: (connectionId: string, phoneDigits: string, campaignId: string) => void;
};

import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';

/** Chave canônica BR (DDI 55 + 9º dígito) — alinhada ao relatório da UI. */
export const normalizePhoneKey = (phone: string): string =>
    normPhoneKey(phone) || (phone || '').replace(/\D/g, '');

/** Sessão isolada por campanha — evita misturar fluxos no mesmo contato/chip. */
export function buildReplyFlowSessionKey(
    connectionId: string,
    campaignId: string,
    phoneDigits: string
): string {
    const cid = String(campaignId || '').trim() || '_';
    const phone = normalizePhoneKey(phoneDigits) || String(phoneDigits || '').replace(/\D/g, '');
    return `${connectionId}:${cid}:${phone}`;
}

/** Formato atual `conn:campaignId:phone`; legado `conn:phone` (campaignId vazio). */
export function parseReplyFlowSessionKey(
    key: string
): { connectionId: string; campaignId: string; phoneDigits: string } | null {
    const trimmed = String(key || '').trim();
    if (!trimmed) return null;
    const first = trimmed.indexOf(':');
    if (first <= 0) return null;
    const second = trimmed.indexOf(':', first + 1);
    if (second <= 0) {
        return {
            connectionId: trimmed.slice(0, first),
            campaignId: '',
            phoneDigits: trimmed.slice(first + 1),
        };
    }
    return {
        connectionId: trimmed.slice(0, first),
        campaignId: trimmed.slice(first + 1, second),
        phoneDigits: trimmed.slice(second + 1),
    };
}

export const buildRecipientVarsMap = (
    recipients?: CampaignRecipient[]
): Map<string, Record<string, string>> => {
    const map = new Map<string, Record<string, string>>();
    if (!recipients || !Array.isArray(recipients)) return map;
    for (const r of recipients) {
        const key = normalizePhoneKey(r.phone);
        if (!key) continue;
        map.set(key, r.vars || {});
    }
    return map;
};

export const applyMessageVars = (
    template: string,
    phone: string,
    vars: Record<string, string> = {},
    rotationIndex?: number,
    options?: { deferClock?: boolean }
): string => {
    const CLOCK_KEYS = new Set(['horario', 'saudacao', 'hora', 'data']);
    const clock = campaignClockVars();
    // Contato/importação nunca sobrescreve relógio da campanha (ex.: coluna "horario" na planilha).
    const filteredVars: Record<string, string> = { ...vars };
    for (const k of CLOCK_KEYS) {
        delete filteredVars[k];
        delete filteredVars[k.toUpperCase()];
    }
    const safeVars: Record<string, string> = {
        ...filteredVars,
        telefone: vars.telefone || phone,
    };
    // Evita saudar com placeholders de agenda bagunçada ("- Casas", "Sem Nome").
    for (const key of ['nome', 'nome_completo'] as const) {
        const v = safeVars[key];
        if (typeof v === 'string' && isSuspiciousContactName(v)) {
            safeVars[key] = '';
        }
    }
    // Na fila: deixa {horario}/{saudacao}/{hora}/{data} para o instante do envio.
    if (!options?.deferClock) {
        Object.assign(safeVars, clock);
    }
    template = normalizeCampaignTemplateDelimiters(template);
    let out = template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
        const v = safeVars[key.toLowerCase()];
        return typeof v === 'string' ? v : '';
    });
    out = out.replace(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g, (match, key: string) => {
        const k = key.toLowerCase();
        if (options?.deferClock && CLOCK_KEYS.has(k)) return match;
        const v = safeVars[k];
        return typeof v === 'string' ? v : match;
    });
    const rot =
        typeof rotationIndex === 'number' && Number.isFinite(rotationIndex)
            ? Math.floor(rotationIndex)
            : campaignRotationIndexFromPhone(phone);
    return resolveCampaignSpintax(out, rot);
};

/** Corrige saudação já “assada” na fila (jobs antigos sem deferClock). Só no início da mensagem. */
export function refreshCampaignGreetingInText(text: string, at: Date = new Date()): string {
    const periodo = campaignClockVars(at).horario;
    if (!periodo || !text) return text;
    const headLen = Math.min(120, text.length);
    const head = text.slice(0, headLen);
    const rest = text.slice(headLen);
    const refreshed = head.replace(/\b(Bom dia|Boa tarde|Boa noite)\b/i, periodo);
    return refreshed + rest;
}

export const sanitizeReplyFlowSteps = (
    raw: Array<{
        body?: string;
        acceptAnyReply?: boolean;
        validTokens?: string[];
        invalidReplyBody?: string;
        marketingEffect?: string;
        matchMode?: string;
        timeoutHours?: number;
        timeoutMessage?: string;
        options?: Array<{
            tokens?: string[];
            reply?: string;
            marketingEffect?: string;
            priority?: number;
            matchMode?: string;
            mediaStorageKey?: string;
        }>;
    }>
): ReplyFlowStepDef[] => {
    const parseMode = (v: unknown): ReplyMatchMode | undefined => {
        const m = String(v || '').toLowerCase();
        if (m === 'word' || m === 'phrase' || m === 'contains' || m === 'numeric_exact') return m;
        return undefined;
    };
    return raw
        .map((s) => {
            const me = String(s.marketingEffect || 'none').toLowerCase();
            const marketingEffect: 'none' | 'opt_in' | 'opt_out' =
                me === 'opt_in' || me === 'opt_out' ? me : 'none';

            const sanitizedOptions = Array.isArray(s.options)
                ? s.options
                      .map((opt) => {
                          const optMe = String(opt.marketingEffect || 'none').toLowerCase();
                          const optMarketingEffect: 'none' | 'opt_in' | 'opt_out' =
                              optMe === 'opt_in' || optMe === 'opt_out' ? optMe : 'none';
                          const mediaStorageKey = String(opt.mediaStorageKey || '').trim();
                          return {
                              tokens: Array.isArray(opt.tokens)
                                  ? opt.tokens.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean)
                                  : [],
                              reply: String(opt.reply || '').trim(),
                              marketingEffect: optMarketingEffect,
                              priority: Number.isFinite(Number(opt.priority)) ? Number(opt.priority) : 0,
                              matchMode: parseMode(opt.matchMode),
                              ...(mediaStorageKey &&
                              mediaStorageKey.length <= 180 &&
                              !mediaStorageKey.includes('..') &&
                              mediaStorageKey.includes(':reply-opt:')
                                  ? { mediaStorageKey }
                                  : {}),
                          };
                      })
                      .filter((opt) => opt.tokens.length > 0 && opt.reply.length > 0)
                : undefined;

            const timeoutHours = Number(s.timeoutHours);
            return {
                body: String(s.body || '').trim(),
                acceptAnyReply:
                    Array.isArray(sanitizedOptions) && sanitizedOptions.length > 0
                        ? false
                        : s.acceptAnyReply !== false,
                validTokens: Array.isArray(s.validTokens)
                    ? s.validTokens.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean)
                    : [],
                invalidReplyBody: String(s.invalidReplyBody || '').trim(),
                marketingEffect,
                matchMode: parseMode(s.matchMode),
                timeoutHours: Number.isFinite(timeoutHours) && timeoutHours > 0 ? timeoutHours : undefined,
                timeoutMessage: String(s.timeoutMessage || '').trim() || undefined,
                options: sanitizedOptions,
            };
        })
        .filter((s) => s.body.length > 0);
};

/** Texto de confirmação do gatilho SAIR/opt_out configurado no fluxo da campanha. */
export function findConfiguredOptOutReply(
    steps: ReplyFlowStepDef[] | undefined,
    bodyText: string
): string | null {
    const t = String(bodyText || '').trim();
    if (!t || !Array.isArray(steps) || steps.length === 0) return null;
    for (const step of steps) {
        const opts = step.options || [];
        const optOutOpts = opts.filter((o) => o.marketingEffect === 'opt_out' && o.reply.trim());
        if (optOutOpts.length === 0) continue;
        const best = findBestMatchingOption(optOutOpts, t, step.matchMode || 'word');
        if (best) {
            const reply = String(optOutOpts[best.optionIndex]?.reply || '').trim();
            if (reply) return reply;
        }
    }
    return null;
}

export function sanitizeReplyFlowMeta(raw: unknown): ReplyFlowDefMeta {
    if (!raw || typeof raw !== 'object') return {};
    const rf = raw as Record<string, unknown>;
    const enabled = rf.globalOptOutEnabled !== false;
    const kw = Array.isArray(rf.globalOptOutKeywords)
        ? rf.globalOptOutKeywords.map((k) => String(k || '').trim()).filter(Boolean)
        : [];
    const maxAttempts = Number.isFinite(Number(rf.maxInvalidReplyAttempts))
        ? Number(rf.maxInvalidReplyAttempts)
        : undefined;
    const politeGreeting =
        rf.politeGreetingEnabled !== undefined
            ? rf.politeGreetingEnabled !== false
            : rf.autoGreetingReply !== undefined
            ? rf.autoGreetingReply !== false
            : true;
    return {
        globalOptOutEnabled: enabled,
        globalOptOutKeywords: kw.length > 0 ? kw : undefined,
        maxInvalidReplyAttempts: maxAttempts,
        politeGreetingEnabled: politeGreeting,
    };
}

function replyFlowEnabledFlag(raw: unknown): boolean {
    if (raw === false || raw === 0 || raw === '0' || raw === 'false' || raw === 'f') return false;
    // Ausente / true / "true" / objeto com steps → trata como ativo (docs antigos às vezes omitem enabled).
    return true;
}

/** Lê o fluxo por respostas do documento da campanha (inclui snapshot, se o doc principal estiver vazio). */
export function parseReplyFlowDefFromCampaignDoc(
    docData: Record<string, unknown> | null | undefined
): { steps: ReplyFlowStepDef[]; meta: ReplyFlowDefMeta } | null {
    if (!docData) return null;
    const snap = docData.scheduleStartSnapshot;
    const snapRf =
        snap && typeof snap === 'object' ? (snap as Record<string, unknown>).replyFlow : undefined;
    const candidates = [docData.replyFlow, snapRf];
    for (const raw of candidates) {
        if (!raw || typeof raw !== 'object') continue;
        const rf = raw as Record<string, unknown>;
        if (!Array.isArray(rf.steps)) continue;
        if (!replyFlowEnabledFlag(rf.enabled)) continue;
        const sanitized = sanitizeReplyFlowSteps(rf.steps as Parameters<typeof sanitizeReplyFlowSteps>[0]);
        if (sanitized.length === 0) continue;
        return { steps: sanitized, meta: sanitizeReplyFlowMeta(rf) };
    }
    return null;
}

export {
    cleanReplyTriggerToken,
    matchReplyTriggerToken,
    normalizeReplyBodyForMatch,
    replyMatchesGate,
    detectGlobalOptOut,
    findBestMatchingOption,
    DEFAULT_GLOBAL_OPT_OUT_KEYWORDS,
};
export type { ReplyMatchMode };

export function pickWeightedChannel(
    activeIds: string[],
    weightsInput: Record<string, number> | undefined,
    index: number
): string {
    if (activeIds.length === 0) return '';
    if (activeIds.length === 1) return activeIds[0];
    const ws = activeIds.map((id) =>
        Math.max(1, Math.min(999, Math.round(Number(weightsInput?.[id] ?? 1) || 1)))
    );
    const sum = ws.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(sum) || sum <= 0) return activeIds[index % activeIds.length];
    let r = Math.max(0, index) % sum;
    for (let i = 0; i < activeIds.length; i++) {
        if (r < ws[i]) return activeIds[i];
        r -= ws[i];
    }
    return activeIds[activeIds.length - 1];
}

const stripBrNine = (n: string): string => {
    if (n.length === 13 && n.startsWith('55') && n.charAt(4) === '9') {
        return n.slice(0, 4) + n.slice(5);
    }
    if (n.length === 11 && n.charAt(2) === '9') {
        return n.slice(0, 2) + n.slice(3);
    }
    return n;
};

export class ReplyFlowEngine {
    private defs = new Map<string, { steps: ReplyFlowStepDef[]; meta: ReplyFlowDefMeta }>();
    private sessions = new Map<string, ReplyFlowSession>();
    private convToCanonical = new Map<string, string>();
    private sessionCountByCampaign = new Map<string, number>();
    private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private processedInboundMessageIds = new Map<string, number>();

    constructor(private callbacks: ReplyFlowCallbacks) {}

    registerDef(campaignId: string, steps: ReplyFlowStepDef[], meta?: ReplyFlowDefMeta) {
        if (!campaignId || steps.length === 0) return;
        this.defs.set(campaignId, { steps, meta: meta || {} });
    }

    hasDef(campaignId: string): boolean {
        return Boolean(this.defs.get(campaignId)?.steps?.length);
    }

    async ensureDefLoaded(campaignId: string, ownerUid?: string): Promise<boolean> {
        if (this.hasDef(campaignId)) return true;
        const def = await this.loadDefFromFirestore(campaignId, ownerUid);
        return Boolean(def?.steps?.length);
    }

    /** Após hidratar defs no boot, religa timeouts das sessões restauradas. */
    rescheduleTimeouts(): void {
        for (const [key, session] of this.sessions) {
            const parsed = parseReplyFlowSessionKey(key);
            if (!parsed) continue;
            this.scheduleStepTimeout(key, parsed.connectionId, parsed.phoneDigits, session);
        }
    }

    openSession(params: {
        connectionId: string;
        phoneDigits: string;
        campaignId: string;
        ownerUid?: string;
        vars: Record<string, string>;
        toRaw: string;
        convKey?: string;
        remoteJid?: string;
    }) {
        const phoneKey =
            normalizePhoneKey(params.phoneDigits) ||
            String(params.phoneDigits || '').replace(/\D/g, '');
        const sessKey = buildReplyFlowSessionKey(
            params.connectionId,
            params.campaignId,
            phoneKey
        );
        const existing = this.sessions.get(sessKey);
        if (existing) {
            if (params.ownerUid && !existing.ownerUid) existing.ownerUid = params.ownerUid;
            if (params.vars && Object.keys(params.vars).length > 0) {
                existing.vars = { ...existing.vars, ...params.vars };
            }
            if (params.toRaw) existing.toRaw = params.toRaw;
            existing.lastActivityAt = Date.now();
            this.registerSessionAliases(sessKey, params, phoneKey);
            this.callbacks.onSessionSave?.(params.connectionId, phoneKey, existing);
            return;
        }

        const session: ReplyFlowSession = {
            campaignId: params.campaignId,
            ownerUid: params.ownerUid,
            awaitingAfterStep: 0,
            vars: params.vars,
            toRaw: params.toRaw,
            registeredConvKey: params.convKey,
            invalidReplyCount: 0,
            lastActivityAt: Date.now(),
        };
        this.sessions.set(sessKey, session);
        this.registerSessionAliases(sessKey, params, phoneKey);
        this.adjustSessionCount(params.campaignId, 1);
        this.callbacks.onSessionSave?.(params.connectionId, phoneKey, session);
        this.scheduleStepTimeout(sessKey, params.connectionId, phoneKey, session);
    }

    /**
     * Outra campanha no mesmo telefone permanece em RAM/Redis até timeout ou dispose.
     * Inbound usa a sessão com atividade mais recente (último disparo/abertura ou resposta).
     */
    private registerSessionAliases(
        sessKey: string,
        params: {
            connectionId: string;
            phoneDigits: string;
            convKey?: string;
            remoteJid?: string;
        },
        phoneKey: string
    ): void {
        const aliasKeys = new Set<string>();
        if (params.convKey) aliasKeys.add(params.convKey);
        aliasKeys.add(`${params.connectionId}:${phoneKey}`);
        const jid = String(params.remoteJid || '').trim();
        if (jid.includes('@')) aliasKeys.add(`${params.connectionId}:${jid}`);
        else if (phoneKey.length >= 8) {
            aliasKeys.add(`${params.connectionId}:${phoneKey}@s.whatsapp.net`);
        }
        for (const k of aliasKeys) {
            this.convToCanonical.set(k, sessKey);
        }
    }

    /** Restaura sessão perdida (ex.: após restart do servidor). Não incrementa contador se já existir. */
    restoreSession(connectionId: string, phoneDigits: string, session: ReplyFlowSession): void {
        const phoneKey =
            normalizePhoneKey(phoneDigits) || String(phoneDigits || '').replace(/\D/g, '');
        const sessKey = buildReplyFlowSessionKey(
            connectionId,
            session.campaignId,
            phoneKey
        );
        if (this.sessions.has(sessKey)) return;
        if (!session.lastActivityAt) session.lastActivityAt = Date.now();
        this.sessions.set(sessKey, session);
        if (session.registeredConvKey) {
            this.convToCanonical.set(session.registeredConvKey, sessKey);
        }
        if (phoneKey.length >= 8) {
            this.convToCanonical.set(`${connectionId}:${phoneKey}@s.whatsapp.net`, sessKey);
        }
        this.adjustSessionCount(session.campaignId, 1);
    }

    /** Encerra fluxo por resposta deste contato (atendimento humano / pausa manual). */
    disposeSessionForContact(connectionId: string, phoneDigits: string): boolean {
        const found = this.findSession(connectionId, phoneDigits);
        if (!found) return false;
        this.disposeSession(found.key, found.session);
        return true;
    }

    hasSession(connectionId: string, phoneDigits: string, campaignId?: string): boolean {
        const incoming =
            normalizePhoneKey(phoneDigits) || String(phoneDigits || '').replace(/\D/g, '');
        if (campaignId) {
            return this.sessions.has(buildReplyFlowSessionKey(connectionId, campaignId, incoming));
        }
        return this.listSessionsForContact(connectionId, incoming).length > 0;
    }

    /** Campanha ativa aguardando resposta deste contato (relatório / logs). */
    resolveCampaignIdForIncoming(
        connectionId: string,
        phoneDigits: string,
        incomingConvId?: string
    ): string | undefined {
        if (incomingConvId) {
            const canonKey = this.convToCanonical.get(incomingConvId);
            if (canonKey) {
                const session = this.sessions.get(canonKey);
                if (session?.campaignId) return session.campaignId;
            }
        }
        const found = this.findSession(connectionId, phoneDigits);
        return found?.session.campaignId;
    }

    private listSessionsForContact(
        connectionId: string,
        phoneDigits: string
    ): Array<{ key: string; session: ReplyFlowSession }> {
        const incoming =
            normalizePhoneKey(phoneDigits) || String(phoneDigits || '').replace(/\D/g, '');
        const hits: Array<{ key: string; session: ReplyFlowSession }> = [];
        for (const [key, session] of this.sessions) {
            const parsed = parseReplyFlowSessionKey(key);
            if (!parsed) continue;
            if (parsed.connectionId !== connectionId) continue;
            if (!this.phoneMatchesSession(parsed.phoneDigits, incoming)) continue;
            hits.push({ key, session });
        }
        return hits;
    }

    /** Prioriza sessão com outbound pendente recente; senão a de maior lastActivityAt. */
    private pickPrimarySession(
        candidates: Array<{ key: string; session: ReplyFlowSession }>
    ): { key: string; session: ReplyFlowSession } | null {
        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];
        const now = Date.now();
        let best = candidates[0];
        let bestScore = -1;
        for (const c of candidates) {
            let score = c.session.lastActivityAt || 0;
            const pending = c.session.pendingOutbound;
            if (pending?.enqueuedAt && now - pending.enqueuedAt < 120_000) {
                score += 1_000_000_000_000;
            }
            if (score > bestScore) {
                bestScore = score;
                best = c;
            }
        }
        return best;
    }

    async resolveConfiguredOptOutReply(
        campaignId: string,
        ownerUid: string | undefined,
        bodyText: string
    ): Promise<string | null> {
        const cid = String(campaignId || '').trim();
        if (!cid) return null;
        let def = this.defs.get(cid);
        if (!def?.steps?.length) {
            def = (await this.loadDefFromFirestore(cid, ownerUid)) ?? undefined;
        }
        return findConfiguredOptOutReply(def?.steps, bodyText);
    }

    updateSessionAfterSend(
        connectionId: string,
        phoneDigits: string,
        newAwaitingAfterStep: number,
        campaignId?: string
    ) {
        const found = this.findSession(connectionId, phoneDigits, campaignId);
        if (!found) return;
        const { key, session } = found;
        session.awaitingAfterStep = newAwaitingAfterStep;
        session.lastActivityAt = Date.now();
        delete session.pendingOutbound;
        const parsed = parseReplyFlowSessionKey(key);
        const connId = parsed?.connectionId || connectionId;
        const phoneKey = parsed?.phoneDigits || phoneDigits;
        this.callbacks.onSessionSave?.(connId, phoneKey, session);
        this.scheduleStepTimeout(key, connId, phoneKey, session);
    }

    /** Confirma entrega de resposta pendente; descarta sessão se for resposta terminal. */
    confirmReplyFlowOutboundDelivered(
        connectionId: string,
        phoneDigits: string,
        disposeAfterSend: boolean,
        campaignId?: string
    ): void {
        const found = this.findSession(connectionId, phoneDigits, campaignId);
        if (!found) return;
        const { key, session } = found;
        delete session.pendingOutbound;
        const parsed = parseReplyFlowSessionKey(key);
        const connId = parsed?.connectionId || connectionId;
        const phoneKey = parsed?.phoneDigits || phoneDigits;
        if (disposeAfterSend) {
            this.disposeSession(key, session);
            return;
        }
        session.lastActivityAt = Date.now();
        this.callbacks.onSessionSave?.(connId, phoneKey, session);
    }

    /** Falha no envio — libera sessão para nova tentativa (contato pode responder de novo). */
    rollbackPendingOutbound(connectionId: string, phoneDigits: string, campaignId?: string): void {
        const found = this.findSession(connectionId, phoneDigits, campaignId);
        if (!found?.session.pendingOutbound) return;
        const { key, session } = found;
        delete session.pendingOutbound;
        const parsed = parseReplyFlowSessionKey(key);
        const connId = parsed?.connectionId || connectionId;
        const phoneKey = parsed?.phoneDigits || phoneDigits;
        this.callbacks.onSessionSave?.(connId, phoneKey, session);
        this.callbacks.onLog?.('Envio pendente do fluxo por resposta revertido — sessão mantida', {
            campaignId: session.campaignId,
            connectionId: connId,
            phoneDigits: phoneKey,
        });
    }

    /** Retorna o número de sessões de reply flow abertas para a campanha. */
    countOpenSessionsForCampaign(campaignId: string): number {
        return this.sessionCountByCampaign.get(campaignId) || 0;
    }

    private adjustSessionCount(campaignId: string, delta: number) {
        if (!campaignId) return;
        const next = (this.sessionCountByCampaign.get(campaignId) || 0) + delta;
        if (next <= 0) {
            this.sessionCountByCampaign.delete(campaignId);
            // Notifica que todas as sessões desta campanha foram encerradas.
            if (delta < 0) {
                this.callbacks.onAllSessionsClosed?.(campaignId);
            }
        } else {
            this.sessionCountByCampaign.set(campaignId, next);
        }
    }

    private maybeClearDef(campaignId: string) {
        if ((this.sessionCountByCampaign.get(campaignId) || 0) === 0) {
            this.defs.delete(campaignId);
        }
    }

    private clearStepTimeout(canonicalKey: string) {
        const tid = this.timeoutTimers.get(canonicalKey);
        if (tid) {
            clearTimeout(tid);
            this.timeoutTimers.delete(canonicalKey);
        }
    }

    private scheduleStepTimeout(
        canonicalKey: string,
        connectionId: string,
        phoneDigits: string,
        session: ReplyFlowSession
    ) {
        this.clearStepTimeout(canonicalKey);
        const def = this.defs.get(session.campaignId);
        const step = def?.steps[session.awaitingAfterStep];
        const hours = step?.timeoutHours;
        if (!hours || hours <= 0 || !step?.timeoutMessage?.trim()) return;

        const ms = Math.min(hours * 3600_000, 7 * 24 * 3600_000);
        const tid = setTimeout(() => {
            void this.fireStepTimeout(canonicalKey, connectionId, phoneDigits);
        }, ms);
        this.timeoutTimers.set(canonicalKey, tid);
    }

    private async fireStepTimeout(canonicalKey: string, connectionId: string, phoneDigits: string) {
        this.timeoutTimers.delete(canonicalKey);
        const session = this.sessions.get(canonicalKey);
        if (!session) return;
        let def = this.defs.get(session.campaignId);
        if (!def?.steps?.length) {
            def = (await this.loadDefFromFirestore(session.campaignId, session.ownerUid)) ?? undefined;
        }
        const step = def?.steps[session.awaitingAfterStep];
        if (!step?.timeoutMessage?.trim()) return;

        const msg = applyMessageVars(step.timeoutMessage, phoneDigits, session.vars);
        this.callbacks.onLog?.('Timeout do fluxo por resposta — fallback enviado', {
            campaignId: session.campaignId,
            connectionId,
            phoneDigits,
            currentStep: session.awaitingAfterStep + 1,
        });
        void this.safeEnqueue({
            to: session.toRaw,
            message: msg,
            connectionId,
            campaignId: session.campaignId,
            ownerUid: session.ownerUid,
        });
        this.disposeSession(canonicalKey, session);
    }

    private disposeSession(canonicalKey: string, session: ReplyFlowSession) {
        this.clearStepTimeout(canonicalKey);
        const reg = session.registeredConvKey;
        if (reg) {
            this.convToCanonical.delete(reg);
            session.registeredConvKey = undefined;
        }
        this.sessions.delete(canonicalKey);
        this.adjustSessionCount(session.campaignId, -1);
        this.maybeClearDef(session.campaignId);
        const parsed = parseReplyFlowSessionKey(canonicalKey);
        if (parsed) {
            this.callbacks.onSessionDisposed?.(
                parsed.connectionId,
                parsed.phoneDigits,
                parsed.campaignId || session.campaignId
            );
        }
    }

    private phoneMatchesSession(sessionPhoneRaw: string, incoming: string): boolean {
        const sessionPhone = String(sessionPhoneRaw || '').replace(/\D/g, '');
        if (!sessionPhone || incoming.length < 8) return false;
        if (sessionPhone === incoming) return true;
        if (stripBrNine(sessionPhone) === stripBrNine(incoming)) return true;
        if (sessionPhone.length >= 8 && sessionPhone.slice(-8) === incoming.slice(-8)) return true;
        return false;
    }

    private persistSession(canonicalKey: string, session: ReplyFlowSession): void {
        const parsed = parseReplyFlowSessionKey(canonicalKey);
        if (!parsed) return;
        session.lastActivityAt = Date.now();
        this.callbacks.onSessionSave?.(parsed.connectionId, parsed.phoneDigits, session);
    }

    private connectionIdFromKey(canonicalKey: string, fallback: string): string {
        return parseReplyFlowSessionKey(canonicalKey)?.connectionId || fallback;
    }

    /**
     * Retribui saudação educada (invalidReplyBody) com limite e cooldown — evita spam.
     * @returns true se enviou ou ignorou (handled); false se não era saudação.
     */
    private tryPoliteGreetingInvalidReply(params: {
        key: string;
        session: ReplyFlowSession;
        connectionId: string;
        phoneDigits: string;
        bodyText: string;
        invalidReplyBody?: string;
    }): boolean {
        const tBody = String(params.bodyText || '').trim();
        if (!isGreetingMessage(tBody)) return false;

        const now = Date.now();
        if (
            params.session.lastPoliteGreetingAt &&
            now - params.session.lastPoliteGreetingAt < POLITE_GREETING_COOLDOWN_MS
        ) {
            this.callbacks.onLog?.('Saudação ignorada — cooldown ativo', {
                campaignId: params.session.campaignId,
                connectionId: params.connectionId,
                phoneDigits: params.phoneDigits,
                cooldownSec: Math.round(POLITE_GREETING_COOLDOWN_MS / 1000),
            });
            return true;
        }

        params.session.greetingReplyCount = (params.session.greetingReplyCount || 0) + 1;
        if (params.session.greetingReplyCount > MAX_POLITE_GREETING_REPLIES) {
            this.callbacks.onLog?.('Limite de saudações consecutivas atingido, encerrando fluxo', {
                campaignId: params.session.campaignId,
                connectionId: params.connectionId,
                phoneDigits: params.phoneDigits,
                greetingCount: params.session.greetingReplyCount,
            });
            this.disposeSession(params.key, params.session);
            return true;
        }

        const greeting = buildPoliteGreeting(tBody);
        const politeBody = formatPoliteGreetingInvalidReply(params.invalidReplyBody, greeting);
        const replyText = applyMessageVars(politeBody, params.phoneDigits, params.session.vars);

        this.callbacks.onLog?.('Saudação detectada no fluxo por resposta — retribuindo educadamente', {
            campaignId: params.session.campaignId,
            connectionId: params.connectionId,
            phoneDigits: params.phoneDigits,
            greetingRetribuida: greeting,
            replyPreview: replyText.slice(0, 80),
        });

        params.session.lastPoliteGreetingAt = now;

        void this.safeEnqueue({
            to: params.session.toRaw,
            message: replyText,
            connectionId: this.connectionIdFromKey(params.key, params.connectionId),
            campaignId: params.session.campaignId,
            ownerUid: params.session.ownerUid,
        });
        this.persistSession(params.key, params.session);
        return true;
    }

    private findSession(
        connectionId: string,
        phoneDigits: string,
        campaignId?: string
    ): { key: string; session: ReplyFlowSession } | null {
        const incoming =
            normalizePhoneKey(phoneDigits) || String(phoneDigits || '').replace(/\D/g, '');
        if (campaignId) {
            const exactKey = buildReplyFlowSessionKey(connectionId, campaignId, incoming);
            const exact = this.sessions.get(exactKey);
            if (exact) return { key: exactKey, session: exact };
        }
        if (incoming.length < 8) return null;

        const onConn = this.listSessionsForContact(connectionId, incoming);
        const primary = this.pickPrimarySession(onConn);
        if (primary) return primary;

        // Fallback: mesmo telefone em outro chip (webhook mal mapeado / re-pareamento).
        for (const [key, session] of this.sessions) {
            const parsed = parseReplyFlowSessionKey(key);
            if (!parsed || parsed.connectionId === connectionId) continue;
            if (!this.phoneMatchesSession(parsed.phoneDigits, incoming)) continue;
            return { key, session };
        }

        // Chave legada conn:phone (sem campaignId no path)
        const legacyKey = `${connectionId}:${incoming}`;
        const legacy = this.sessions.get(legacyKey);
        if (legacy) return { key: legacyKey, session: legacy };

        return null;
    }

    private safeEnqueue(item: ReplyFlowOutboundItem): void {
        try {
            const result = this.callbacks.enqueue(item);
            if (result && typeof (result as Promise<void>).then === 'function') {
                void (result as Promise<void>).catch((err: unknown) => {
                    this.callbacks.onLog?.('Falha ao enfileirar resposta do fluxo', {
                        campaignId: item.campaignId,
                        connectionId: item.connectionId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            }
        } catch (err: unknown) {
            this.callbacks.onLog?.('Falha ao enfileirar resposta do fluxo', {
                campaignId: item.campaignId,
                connectionId: item.connectionId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private async loadDefFromFirestore(
        campaignId: string,
        ownerUid?: string
    ): Promise<{ steps: ReplyFlowStepDef[]; meta: ReplyFlowDefMeta } | null> {
        try {
            let docData: Record<string, unknown> | undefined;
            let uid = String(ownerUid || '').trim();

            if (usePostgresCampaigns()) {
                if (!uid) {
                    const { resolveCampaignTenantId } = await import('./repositories/campaignsRepository.js');
                    uid = (await resolveCampaignTenantId(campaignId)) || '';
                }
                if (uid) {
                    docData = (await fetchCampaignDoc(uid, campaignId)) ?? undefined;
                }
                const fromPg = parseReplyFlowDefFromCampaignDoc(docData);
                if (fromPg) {
                    this.defs.set(campaignId, fromPg);
                    return fromPg;
                }
            }

            const admin = getFirebaseAdmin();
            if (!admin) return null;
            const db = getFirestore(admin);

            if (uid && !docData) {
                const docSnap = await db.doc(`users/${uid}/campaigns/${campaignId}`).get();
                if (docSnap.exists) docData = docSnap.data() as Record<string, unknown>;
            }

            if (!docData) {
                const snap = await db.collectionGroup('campaigns').where('id', '==', campaignId).limit(1).get();
                if (!snap.empty) docData = snap.docs[0].data() as Record<string, unknown>;
            }

            const parsed = parseReplyFlowDefFromCampaignDoc(docData);
            if (parsed) {
                this.defs.set(campaignId, parsed);
                return parsed;
            }
        } catch (e) {
            console.warn('[ReplyFlow] Erro ao buscar definição da campanha:', e);
        }
        return null;
    }

    async handleIncoming(params: {
        connectionId: string;
        phoneDigits: string;
        bodyText: string;
        nonTextReply?: boolean;
        incomingConvId?: string;
        messageId?: string;
    }): Promise<{ handled: boolean; marketingEffect?: 'none' | 'opt_in' | 'opt_out' }> {
        const { connectionId, phoneDigits, bodyText, nonTextReply, incomingConvId, messageId } = params;

        // Idempotência por messageId: não reprocessar o mesmo inbound
        if (messageId) {
            const cleanMsgId = String(messageId).trim();
            const now = Date.now();
            if (this.processedInboundMessageIds.has(cleanMsgId)) {
                this.callbacks.onLog?.('Inbound já processado anteriormente no ReplyFlowEngine (idempotência ignorada)', {
                    messageId: cleanMsgId,
                    connectionId,
                    phoneDigits,
                });
                return { handled: true };
            }
            // Limpa mensagens com mais de 10 minutos
            if (this.processedInboundMessageIds.size > 2000) {
                for (const [mid, ts] of this.processedInboundMessageIds) {
                    if (now - ts > 600_000) this.processedInboundMessageIds.delete(mid);
                }
            }
            this.processedInboundMessageIds.set(cleanMsgId, now);
        }

        let found: { key: string; session: ReplyFlowSession } | null = null;
        if (incomingConvId) {
            const canonKey = this.convToCanonical.get(incomingConvId);
            if (canonKey) {
                const session = this.sessions.get(canonKey);
                if (session) found = { key: canonKey, session };
            }
        }
        if (!found) found = this.findSession(connectionId, phoneDigits);
        if (!found) {
            const activeOnConn = [...this.sessions.keys()].some((k) => k.startsWith(`${connectionId}:`));
            if (activeOnConn) {
                this.callbacks.onLog?.('Resposta recebida mas sem sessao de etapas correspondente', {
                    connectionId,
                    phoneDigits,
                    incomingConvId,
                });
            }
            return { handled: false };
        }

        const { key, session } = found;
        session.lastActivityAt = Date.now();

        let def = this.defs.get(session.campaignId);
        if (!def?.steps?.length) {
            def = (await this.loadDefFromFirestore(session.campaignId, session.ownerUid)) ?? undefined;
        }
        if (!def?.steps?.length) {
            this.callbacks.onLog?.('Fluxo por resposta sem definição da campanha — sessão mantida', {
                campaignId: session.campaignId,
                connectionId,
                phoneDigits,
            });
            return { handled: false };
        }

        // Pausar o disparo em massa NÃO pode silenciar gatilhos de quem já recebeu.

        const tBody = String(bodyText || '').trim();
        const meta = def.meta || {};
        const gateStepForPending = def.steps[session.awaitingAfterStep];
        const wouldMatchOption =
            gateStepForPending?.options?.length && tBody
                ? findBestMatchingOption(
                      gateStepForPending.options,
                      tBody,
                      gateStepForPending.matchMode || 'word'
                  ) !== null
                : false;

        if (session.pendingOutbound) {
            const ageMs = Date.now() - (session.pendingOutbound.enqueuedAt || 0);
            if (ageMs > 120_000) {
                delete session.pendingOutbound;
            } else if (ageMs < 90_000 && !wouldMatchOption) {
                this.callbacks.onLog?.('Resposta recebida mas envio anterior ainda pendente', {
                    campaignId: session.campaignId,
                    connectionId,
                    phoneDigits,
                    pendingAgeSec: Math.round(ageMs / 1000),
                });
                return { handled: true };
            }
            delete session.pendingOutbound;
            const keyPartsPending = parseReplyFlowSessionKey(key);
            const connId = keyPartsPending?.connectionId || connectionId;
            const phoneKey = keyPartsPending?.phoneDigits || phoneDigits;
            this.callbacks.onSessionSave?.(connId, phoneKey, session);
        }

        // Verificar opt-out global SOMENTE se a resposta não casar com nenhuma opção
        // configurada pelo usuário. Isso permite que palavras como "sair" sejam usadas
        // como opção de menu sem acionar o opt-out automático.
        const gateStepForOptOut = def.steps[session.awaitingAfterStep];
        const hasConfiguredOptions = (gateStepForOptOut?.options?.length ?? 0) > 0;
        const matchesConfiguredOption = hasConfiguredOptions && tBody
            ? findBestMatchingOption(gateStepForOptOut!.options!, tBody, gateStepForOptOut?.matchMode || 'word') !== null
            : false;

        if (meta.globalOptOutEnabled !== false && tBody && !matchesConfiguredOption) {
            const optOut = detectGlobalOptOut(tBody, meta.globalOptOutKeywords);
            if (optOut.matched) {
                this.callbacks.onLog?.('Opt-out global reconhecido no fluxo por resposta', {
                    campaignId: session.campaignId,
                    connectionId,
                    phoneDigits,
                    matchedKeyword: optOut.keyword,
                    replyPreview: tBody.slice(0, 80),
                });
                this.callbacks.onMarketingConsent?.(
                    session.ownerUid,
                    session.campaignId,
                    'opt_out',
                    phoneDigits,
                    bodyText,
                    connectionId
                );
                const customOptOut = findConfiguredOptOutReply(def.steps, tBody);
                if (customOptOut) {
                    const replyBody = applyMessageVars(customOptOut, phoneDigits, session.vars);
                    void this.safeEnqueue({
                        to: session.toRaw,
                        message: replyBody,
                        connectionId,
                        campaignId: session.campaignId,
                        ownerUid: session.ownerUid,
                        replyFlowDisposeAfterSend: true,
                    });
                }
                this.disposeSession(key, session);
                return { handled: true, marketingEffect: 'opt_out' };
            }
        }

        const steps = def.steps;
        const awaiting = session.awaitingAfterStep;
        const preview =
            String(bodyText || '').slice(0, 80) ||
            (nonTextReply ? '[resposta sem texto legível — mídia/botão/etc.]' : '');

        this.callbacks.onLog?.('Resposta recebida no fluxo por etapas', {
            campaignId: session.campaignId,
            connectionId,
            phoneDigits,
            to: phoneDigits,
            ownerUid: session.ownerUid,
            currentStep: awaiting + 1,
            totalSteps: steps.length,
            replyPreview: preview,
            nonTextReply: Boolean(nonTextReply),
        });

        const gateStep = steps[awaiting];

        if (gateStep.options && gateStep.options.length > 0) {
            const t = tBody;
            const nonText = Boolean(nonTextReply);
            let matchedOption: ReplyFlowStepOption | null = null;
            let matchMeta: { matchedToken?: string; matchMode?: ReplyMatchMode; optionIndex?: number } = {};

            if (t || nonText) {
                const best = findBestMatchingOption(gateStep.options, t, gateStep.matchMode || 'word');
                if (best) {
                    matchedOption = gateStep.options[best.optionIndex] || null;
                    matchMeta = {
                        matchedToken: best.matchedToken,
                        matchMode: best.matchMode,
                        optionIndex: best.optionIndex,
                    };
                }
            }

            if (matchedOption) {
                this.callbacks.onLog?.('Gatilho reconhecido no fluxo por resposta', {
                    campaignId: session.campaignId,
                    connectionId,
                    phoneDigits,
                    currentStep: awaiting + 1,
                    matchedToken: matchMeta.matchedToken,
                    matchMode: matchMeta.matchMode,
                    matchedOptionIndex: matchMeta.optionIndex,
                    replyPreview: preview,
                });
                const outbound = resolveReplyFlowOptionOutbound({
                    matchedOption,
                    gateStep,
                    steps,
                    awaitingStepIndex: awaiting,
                    phoneDigits,
                    vars: session.vars,
                    campaignId: session.campaignId,
                });
                const replyBody = outbound.message;
                const optionMediaKey = outbound.mediaStorageKey || '';
                session.invalidReplyCount = 0;
                delete session.greetingReplyCount;
                session.pendingOutbound = {
                    message: replyBody,
                    mediaStorageKey: optionMediaKey || undefined,
                    disposeAfterSend: outbound.disposeAfterSend,
                    enqueuedAt: Date.now(),
                };
                const keyParts = parseReplyFlowSessionKey(key);
                const sessionPhoneKey = keyParts?.phoneDigits || phoneDigits;
                const sendConnectionId = keyParts?.connectionId || connectionId;
                this.callbacks.onSessionSave?.(sendConnectionId, sessionPhoneKey, session);

                void this.safeEnqueue({
                    to: session.toRaw,
                    message: replyBody,
                    connectionId: sendConnectionId,
                    campaignId: session.campaignId,
                    ownerUid: session.ownerUid,
                    mediaStorageKey: optionMediaKey || undefined,
                    replyFlowAfterSend: outbound.afterSend,
                    replyFlowDisposeAfterSend: outbound.disposeAfterSend,
                });

                const optMe = matchedOption.marketingEffect || 'none';
                if (optMe === 'opt_in' || optMe === 'opt_out') {
                    this.callbacks.onMarketingConsent?.(
                        session.ownerUid,
                        session.campaignId,
                        optMe,
                        phoneDigits,
                        bodyText,
                        sendConnectionId
                    );
                }
                this.callbacks.onInboundReply?.({
                    campaignId: session.campaignId,
                    connectionId: sendConnectionId,
                    phoneDigits,
                    ownerUid: session.ownerUid,
                    replyText: bodyText,
                    matchedToken: matchMeta.matchedToken,
                    marketingEffect: optMe,
                    matchKind: 'option',
                });
                return { handled: true, marketingEffect: optMe };
            }

            const politeActive = def.meta?.politeGreetingEnabled !== false;
            const isGreeting = politeActive && isGreetingMessage(tBody);

            if (isGreeting && politeActive) {
                if (
                    this.tryPoliteGreetingInvalidReply({
                        key,
                        session,
                        connectionId,
                        phoneDigits,
                        bodyText: tBody,
                        invalidReplyBody: gateStep.invalidReplyBody,
                    })
                ) {
                    return { handled: true };
                }
            }

            if (gateStep.invalidReplyBody) {
                // Verifica limite de tentativas de resposta inválida
                const maxAttempts = def.meta?.maxInvalidReplyAttempts ?? 3;
                session.invalidReplyCount = (session.invalidReplyCount || 0) + 1;

                if (session.invalidReplyCount >= maxAttempts) {
                    this.callbacks.onLog?.('Limite de respostas inválidas atingido, encerrando fluxo', {
                        campaignId: session.campaignId,
                        connectionId,
                        phoneDigits,
                        invalidCount: session.invalidReplyCount,
                        maxAttempts,
                    });
                    this.disposeSession(key, session);
                    return { handled: true };
                }

                const inv = applyMessageVars(gateStep.invalidReplyBody, phoneDigits, session.vars);
                void this.safeEnqueue({
                    to: session.toRaw,
                    message: inv,
                    connectionId: this.connectionIdFromKey(key, connectionId),
                    campaignId: session.campaignId,
                    ownerUid: session.ownerUid,
                });
                this.persistSession(key, session);
            } else {
                this.callbacks.onLog?.('Resposta sem match de gatilho e sem mensagem de inválida', {
                    campaignId: session.campaignId,
                    connectionId,
                    phoneDigits,
                    replyPreview: preview,
                    optionCount: gateStep.options.length,
                    tokensSample: gateStep.options
                        .slice(0, 5)
                        .map((o) => (o.tokens || []).join('|'))
                        .join(' ; '),
                });
            }
            return { handled: true };
        }

        if (awaiting >= steps.length - 1) {
            const gate = steps[steps.length - 1];
            const gateOk = replyMatchesGate(gate, bodyText, { nonTextReply });
            if (!gateOk) {
                const politeActive = def.meta?.politeGreetingEnabled !== false;
                const isGreeting = politeActive && isGreetingMessage(tBody);

                if (isGreeting && politeActive) {
                    if (
                        this.tryPoliteGreetingInvalidReply({
                            key,
                            session,
                            connectionId,
                            phoneDigits,
                            bodyText: tBody,
                            invalidReplyBody: gate.invalidReplyBody,
                        })
                    ) {
                        return { handled: true };
                    }
                }

                if (gate.invalidReplyBody) {
                    // Verifica limite de tentativas de resposta inválida
                    const maxAttempts = def.meta?.maxInvalidReplyAttempts ?? 3;
                    session.invalidReplyCount = (session.invalidReplyCount || 0) + 1;

                    if (session.invalidReplyCount >= maxAttempts) {
                        this.callbacks.onLog?.('Limite de respostas inválidas atingido, encerrando fluxo', {
                            campaignId: session.campaignId,
                            connectionId,
                            phoneDigits,
                            invalidCount: session.invalidReplyCount,
                            maxAttempts,
                        });
                        this.disposeSession(key, session);
                        return { handled: true };
                    }

                    const inv = applyMessageVars(gate.invalidReplyBody, phoneDigits, session.vars);
                    void this.safeEnqueue({
                        to: session.toRaw,
                        message: inv,
                        connectionId: this.connectionIdFromKey(key, connectionId),
                        campaignId: session.campaignId,
                        ownerUid: session.ownerUid,
                    });
                    this.persistSession(key, session);
                    return { handled: true };
                }
            }
            if (gateOk && gate.marketingEffect === 'opt_in') {
                this.callbacks.onMarketingConsent?.(
                    session.ownerUid,
                    session.campaignId,
                    'opt_in',
                    phoneDigits,
                    bodyText,
                    connectionId
                );
            } else if (gateOk && gate.marketingEffect === 'opt_out') {
                this.callbacks.onMarketingConsent?.(
                    session.ownerUid,
                    session.campaignId,
                    'opt_out',
                    phoneDigits,
                    bodyText,
                    connectionId
                );
            }
            if (gateOk) {
                this.callbacks.onInboundReply?.({
                    campaignId: session.campaignId,
                    connectionId,
                    phoneDigits,
                    ownerUid: session.ownerUid,
                    replyText: bodyText,
                    marketingEffect: gate.marketingEffect || 'none',
                    matchKind: gate.acceptAnyReply ? 'any' : 'gate',
                });
            }
            this.disposeSession(key, session);
            return { handled: true, marketingEffect: gateOk ? gate.marketingEffect || 'none' : undefined };
        }

        if (!replyMatchesGate(gateStep, bodyText, { nonTextReply })) {
            const politeActive = def.meta?.politeGreetingEnabled !== false;
            const isGreeting = politeActive && isGreetingMessage(tBody);

            if (isGreeting && politeActive) {
                if (
                    this.tryPoliteGreetingInvalidReply({
                        key,
                        session,
                        connectionId,
                        phoneDigits,
                        bodyText: tBody,
                        invalidReplyBody: gateStep.invalidReplyBody,
                    })
                ) {
                    return { handled: true };
                }
            }

            if (gateStep.invalidReplyBody) {
                const inv = applyMessageVars(gateStep.invalidReplyBody, phoneDigits, session.vars);
                void this.safeEnqueue({
                    to: session.toRaw,
                    message: inv,
                    connectionId: this.connectionIdFromKey(key, connectionId),
                    campaignId: session.campaignId,
                    ownerUid: session.ownerUid,
                });
            } else {
                this.callbacks.onLog?.('Resposta não bateu no gatilho da etapa (sem mensagem de inválida)', {
                    campaignId: session.campaignId,
                    connectionId,
                    phoneDigits,
                    replyPreview: String(bodyText || '').slice(0, 80),
                    validTokens: gateStep.validTokens?.slice(0, 8),
                    acceptAnyReply: gateStep.acceptAnyReply,
                });
            }
            return { handled: true };
        }

        session.invalidReplyCount = 0;
        delete session.greetingReplyCount;

        if (gateStep.marketingEffect === 'opt_in') {
            this.callbacks.onMarketingConsent?.(
                session.ownerUid,
                session.campaignId,
                'opt_in',
                phoneDigits,
                bodyText,
                connectionId
            );
        } else if (gateStep.marketingEffect === 'opt_out') {
            this.callbacks.onMarketingConsent?.(
                session.ownerUid,
                session.campaignId,
                'opt_out',
                phoneDigits,
                bodyText,
                connectionId
            );
        }

        this.callbacks.onInboundReply?.({
            campaignId: session.campaignId,
            connectionId,
            phoneDigits,
            ownerUid: session.ownerUid,
            replyText: bodyText,
            marketingEffect: gateStep.marketingEffect || 'none',
            matchKind: gateStep.acceptAnyReply ? 'any' : 'gate',
        });

        const nextIdx = awaiting + 1;
        if (nextIdx >= steps.length) {
            this.disposeSession(key, session);
            return { handled: true, marketingEffect: gateStep.marketingEffect || 'none' };
        }

        const nextBody = applyMessageVars(steps[nextIdx].body, phoneDigits, session.vars);
        const sessionPhoneKey =
            parseReplyFlowSessionKey(key)?.phoneDigits || phoneDigits;

        this.callbacks.onLog?.('Proxima etapa enfileirada apos resposta', {
            campaignId: session.campaignId,
            connectionId,
            phoneDigits,
            fromStep: awaiting + 1,
            toStep: nextIdx + 1,
        });

        const stepMediaKey = session.campaignId
            ? campaignMediaStorageKey(session.campaignId, nextIdx)
            : '';
        session.pendingOutbound = {
            message: nextBody,
            mediaStorageKey: stepMediaKey || undefined,
            disposeAfterSend: false,
            enqueuedAt: Date.now(),
        };
        this.callbacks.onSessionSave?.(connectionId, sessionPhoneKey, session);

        void this.safeEnqueue({
            to: session.toRaw,
            message: nextBody,
            connectionId: key.includes(':') ? key.slice(0, key.indexOf(':')) : connectionId,
            campaignId: session.campaignId,
            ownerUid: session.ownerUid,
            mediaStorageKey: stepMediaKey || undefined,
            replyFlowAfterSend: { phoneDigits: sessionPhoneKey, newAwaitingAfterStep: nextIdx },
        });
        return { handled: true, marketingEffect: gateStep.marketingEffect || 'none' };
    }
}

/** Extrai texto de mensagem recebida via webhook Evolution API. */
export function extractEvolutionReplyBody(message: Record<string, unknown> | undefined): {
    bodyText: string;
    nonTextReply: boolean;
} {
    return extractEvolutionMessageBody(message);
}
