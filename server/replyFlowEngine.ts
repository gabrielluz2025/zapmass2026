import { campaignClockVars } from '../src/utils/campaignClockVars.js';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getFirestore } from 'firebase-admin/firestore';

export type ReplyFlowStepOption = {
    tokens: string[];
    reply: string;
    marketingEffect?: 'none' | 'opt_in' | 'opt_out';
};

export type ReplyFlowStepDef = {
    body: string;
    acceptAnyReply: boolean;
    validTokens: string[];
    invalidReplyBody: string;
    marketingEffect?: 'none' | 'opt_in' | 'opt_out';
    options?: ReplyFlowStepOption[];
};

export type ReplyFlowSession = {
    campaignId: string;
    ownerUid?: string;
    awaitingAfterStep: number;
    vars: Record<string, string>;
    toRaw: string;
    registeredConvKey?: string;
};

export type ReplyFlowOutboundItem = {
    to: string;
    message: string;
    connectionId: string;
    campaignId?: string;
    replyFlowAfterSend?: { phoneDigits: string; newAwaitingAfterStep: number };
};

export type CampaignRecipient = { phone: string; vars: Record<string, string> };

export type ReplyFlowCallbacks = {
    enqueue: (item: ReplyFlowOutboundItem) => void | Promise<void>;
    onMarketingConsent?: (
        ownerUid: string | undefined,
        campaignId: string,
        effect: 'opt_in' | 'opt_out',
        phoneDigits: string,
        replyText: string
    ) => void;
    onLog?: (message: string, payload?: Record<string, unknown>) => void;
    isCampaignPaused?: (campaignId: string) => boolean;
    /** Chamado quando todas as sessões de uma campanha são encerradas (reply flow concluído). */
    onAllSessionsClosed?: (campaignId: string) => void;
};

export const normalizePhoneKey = (phone: string): string => (phone || '').replace(/\D/g, '');

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
    vars: Record<string, string> = {}
): string => {
    const clock = campaignClockVars();
    const safeVars: Record<string, string> = {
        ...clock,
        ...vars,
        telefone: vars.telefone || phone,
    };
    let out = template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
        const v = safeVars[key.toLowerCase()];
        return typeof v === 'string' ? v : '';
    });
    out = out.replace(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g, (match, key: string) => {
        const v = safeVars[key.toLowerCase()];
        return typeof v === 'string' ? v : match;
    });
    return out;
};

export const sanitizeReplyFlowSteps = (
    raw: Array<{
        body?: string;
        acceptAnyReply?: boolean;
        validTokens?: string[];
        invalidReplyBody?: string;
        marketingEffect?: string;
        options?: Array<{
            tokens?: string[];
            reply?: string;
            marketingEffect?: string;
        }>;
    }>
): ReplyFlowStepDef[] => {
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
                          return {
                              tokens: Array.isArray(opt.tokens)
                                  ? opt.tokens.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean)
                                  : [],
                              reply: String(opt.reply || '').trim(),
                              marketingEffect: optMarketingEffect,
                          };
                      })
                      .filter((opt) => opt.tokens.length > 0 && opt.reply.length > 0)
                : undefined;

            return {
                body: String(s.body || '').trim(),
                acceptAnyReply: Boolean(s.acceptAnyReply),
                validTokens: Array.isArray(s.validTokens)
                    ? s.validTokens.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean)
                    : [],
                invalidReplyBody: String(s.invalidReplyBody || '').trim(),
                marketingEffect,
                options: sanitizedOptions,
            };
        })
        .filter((s) => s.body.length > 0);
};

export const replyMatchesGate = (
    step: ReplyFlowStepDef,
    bodyText: string,
    opts?: { nonTextReply?: boolean }
): boolean => {
    if (step.acceptAnyReply) return true;
    const t = String(bodyText || '').trim();
    const nonText = Boolean(opts?.nonTextReply);
    if (!t && !nonText) return false;
    const tokens = step.validTokens || [];
    if (tokens.length === 0) {
        return nonText || !!t;
    }
    if (!t && nonText) {
        return false;
    }

    const norm = t.toLowerCase().replace(/[^\w\s\u00C0-\u00FF0-9]/g, '').trim();
    const first = norm.split(/\s+/)[0] || '';

    return tokens.some((tok) => {
        const cleanTok = tok.replace(/[^\w\s\u00C0-\u00FF0-9]/g, '').trim();
        return cleanTok === norm || cleanTok === first;
    });
};

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
    private defs = new Map<string, { steps: ReplyFlowStepDef[] }>();
    private sessions = new Map<string, ReplyFlowSession>();
    private convToCanonical = new Map<string, string>();
    private sessionCountByCampaign = new Map<string, number>();

    constructor(private callbacks: ReplyFlowCallbacks) {}

    registerDef(campaignId: string, steps: ReplyFlowStepDef[]) {
        if (!campaignId || steps.length === 0) return;
        this.defs.set(campaignId, { steps });
    }

    openSession(params: {
        connectionId: string;
        phoneDigits: string;
        campaignId: string;
        ownerUid?: string;
        vars: Record<string, string>;
        toRaw: string;
        convKey?: string;
    }) {
        const sessKey = `${params.connectionId}:${params.phoneDigits}`;
        const session: ReplyFlowSession = {
            campaignId: params.campaignId,
            ownerUid: params.ownerUid,
            awaitingAfterStep: 0,
            vars: params.vars,
            toRaw: params.toRaw,
            registeredConvKey: params.convKey,
        };
        this.sessions.set(sessKey, session);
        if (params.convKey) {
            this.convToCanonical.set(params.convKey, sessKey);
        }
        this.adjustSessionCount(params.campaignId, 1);
    }

    updateSessionAfterSend(connectionId: string, phoneDigits: string, newAwaitingAfterStep: number) {
        const sessKey = `${connectionId}:${phoneDigits}`;
        const sess = this.sessions.get(sessKey);
        if (sess) {
            sess.awaitingAfterStep = newAwaitingAfterStep;
        }
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

    private disposeSession(canonicalKey: string, session: ReplyFlowSession) {
        const reg = session.registeredConvKey;
        if (reg) {
            this.convToCanonical.delete(reg);
            session.registeredConvKey = undefined;
        }
        this.sessions.delete(canonicalKey);
        this.adjustSessionCount(session.campaignId, -1);
        this.maybeClearDef(session.campaignId);
    }

    private findSession(
        connectionId: string,
        phoneDigits: string
    ): { key: string; session: ReplyFlowSession } | null {
        const exactKey = `${connectionId}:${phoneDigits}`;
        const exact = this.sessions.get(exactKey);
        if (exact) return { key: exactKey, session: exact };

        const incoming = String(phoneDigits || '').replace(/\D/g, '');
        if (incoming.length < 8) return null;
        const incomingTail = incoming.slice(-8);
        const incomingNoNine = stripBrNine(incoming);

        let bestKey: string | null = null;
        let bestSession: ReplyFlowSession | null = null;

        for (const [key, session] of this.sessions) {
            if (!key.startsWith(`${connectionId}:`)) continue;
            const sessionPhone = key.slice(connectionId.length + 1).replace(/\D/g, '');
            if (!sessionPhone) continue;
            if (sessionPhone === incoming) return { key, session };
            if (stripBrNine(sessionPhone) === incomingNoNine) {
                bestKey = key;
                bestSession = session;
                break;
            }
            if (sessionPhone.length >= 8 && sessionPhone.slice(-8) === incomingTail) {
                bestKey = key;
                bestSession = session;
            }
        }

        if (bestKey && bestSession) return { key: bestKey, session: bestSession };
        return null;
    }

    private async loadDefFromFirestore(campaignId: string): Promise<{ steps: ReplyFlowStepDef[] } | null> {
        try {
            const admin = getFirebaseAdmin();
            if (!admin) return null;
            const db = getFirestore(admin);
            const snap = await db.collectionGroup('campaigns').where('__name__', '==', `campaigns/${campaignId}`).get();
            if (!snap.empty) {
                const data = snap.docs[0].data();
                if (data?.replyFlow?.enabled && Array.isArray(data.replyFlow.steps)) {
                    const sanitized = sanitizeReplyFlowSteps(data.replyFlow.steps);
                    if (sanitized.length > 0) {
                        this.defs.set(campaignId, { steps: sanitized });
                        return { steps: sanitized };
                    }
                }
            }
        } catch (e) {
            console.warn('[ReplyFlow] Erro ao buscar campanha no Firestore:', e);
        }
        return null;
    }

    async handleIncoming(params: {
        connectionId: string;
        phoneDigits: string;
        bodyText: string;
        nonTextReply?: boolean;
        incomingConvId?: string;
    }) {
        const { connectionId, phoneDigits, bodyText, nonTextReply, incomingConvId } = params;

        let found: { key: string; session: ReplyFlowSession } | null = null;
        if (incomingConvId) {
            const canonKey = this.convToCanonical.get(incomingConvId);
            if (canonKey) {
                const session = this.sessions.get(canonKey);
                if (session) found = { key: canonKey, session };
            }
        }
        if (!found) found = this.findSession(connectionId, phoneDigits);
        if (!found) return;

        const { key, session } = found;
        let def = this.defs.get(session.campaignId);
        if (!def?.steps?.length) {
            def = (await this.loadDefFromFirestore(session.campaignId)) ?? undefined;
        }
        if (!def?.steps?.length) {
            this.disposeSession(key, session);
            return;
        }

        if (this.callbacks.isCampaignPaused?.(session.campaignId)) return;

        const steps = def.steps;
        const awaiting = session.awaitingAfterStep;
        const preview =
            String(bodyText || '').slice(0, 80) ||
            (nonTextReply ? '[resposta sem texto legível — mídia/botão/etc.]' : '');

        this.callbacks.onLog?.('Resposta recebida no fluxo por etapas', {
            campaignId: session.campaignId,
            connectionId,
            phoneDigits,
            currentStep: awaiting + 1,
            totalSteps: steps.length,
            replyPreview: preview,
            nonTextReply: Boolean(nonTextReply),
        });

        const gateStep = steps[awaiting];

        if (gateStep.options && gateStep.options.length > 0) {
            const t = String(bodyText || '').trim();
            const nonText = Boolean(nonTextReply);
            let matchedOption: ReplyFlowStepOption | null = null;

            if (t || nonText) {
                const norm = t.toLowerCase().replace(/[^\w\s\u00C0-\u00FF0-9]/g, '').trim();
                const first = norm.split(/\s+/)[0] || '';
                matchedOption =
                    gateStep.options.find((opt) =>
                        (opt.tokens || []).some((tok) => {
                            const cleanTok = tok.replace(/[^\w\s\u00C0-\u00FF0-9]/g, '').trim();
                            return cleanTok === norm || cleanTok === first;
                        })
                    ) || null;
            }

            if (matchedOption) {
                const replyBody = applyMessageVars(matchedOption.reply, phoneDigits, session.vars);
                void this.callbacks.enqueue({
                    to: session.toRaw,
                    message: replyBody,
                    connectionId,
                    campaignId: session.campaignId,
                });

                const optMe = matchedOption.marketingEffect || 'none';
                if (optMe === 'opt_in' || optMe === 'opt_out') {
                    this.callbacks.onMarketingConsent?.(
                        session.ownerUid,
                        session.campaignId,
                        optMe,
                        phoneDigits,
                        bodyText
                    );
                }
                this.disposeSession(key, session);
                return;
            }

            if (gateStep.invalidReplyBody) {
                const inv = applyMessageVars(gateStep.invalidReplyBody, phoneDigits, session.vars);
                void this.callbacks.enqueue({
                    to: session.toRaw,
                    message: inv,
                    connectionId,
                    campaignId: session.campaignId,
                });
            }
            return;
        }

        if (awaiting >= steps.length - 1) {
            const gate = steps[steps.length - 1];
            const gateOk = replyMatchesGate(gate, bodyText, { nonTextReply });
            if (!gateOk && gate.invalidReplyBody) {
                const inv = applyMessageVars(gate.invalidReplyBody, phoneDigits, session.vars);
                void this.callbacks.enqueue({
                    to: session.toRaw,
                    message: inv,
                    connectionId,
                    campaignId: session.campaignId,
                });
                return;
            }
            if (gateOk && gate.marketingEffect === 'opt_in') {
                this.callbacks.onMarketingConsent?.(
                    session.ownerUid,
                    session.campaignId,
                    'opt_in',
                    phoneDigits,
                    bodyText
                );
            } else if (gateOk && gate.marketingEffect === 'opt_out') {
                this.callbacks.onMarketingConsent?.(
                    session.ownerUid,
                    session.campaignId,
                    'opt_out',
                    phoneDigits,
                    bodyText
                );
            }
            this.disposeSession(key, session);
            return;
        }

        if (!replyMatchesGate(gateStep, bodyText, { nonTextReply })) {
            if (gateStep.invalidReplyBody) {
                const inv = applyMessageVars(gateStep.invalidReplyBody, phoneDigits, session.vars);
                void this.callbacks.enqueue({
                    to: session.toRaw,
                    message: inv,
                    connectionId,
                    campaignId: session.campaignId,
                });
            }
            return;
        }

        if (gateStep.marketingEffect === 'opt_in') {
            this.callbacks.onMarketingConsent?.(
                session.ownerUid,
                session.campaignId,
                'opt_in',
                phoneDigits,
                bodyText
            );
        } else if (gateStep.marketingEffect === 'opt_out') {
            this.callbacks.onMarketingConsent?.(
                session.ownerUid,
                session.campaignId,
                'opt_out',
                phoneDigits,
                bodyText
            );
        }

        const nextIdx = awaiting + 1;
        if (nextIdx >= steps.length) {
            this.disposeSession(key, session);
            return;
        }

        const nextBody = applyMessageVars(steps[nextIdx].body, phoneDigits, session.vars);
        const sessionPhoneKey = key.startsWith(`${connectionId}:`)
            ? key.slice(connectionId.length + 1)
            : phoneDigits;

        void this.callbacks.enqueue({
            to: session.toRaw,
            message: nextBody,
            connectionId,
            campaignId: session.campaignId,
            replyFlowAfterSend: { phoneDigits: sessionPhoneKey, newAwaitingAfterStep: nextIdx },
        });
    }
}

/** Extrai texto de mensagem recebida via webhook Evolution API. */
export function extractEvolutionReplyBody(message: Record<string, unknown> | undefined): {
    bodyText: string;
    nonTextReply: boolean;
} {
    if (!message) return { bodyText: '', nonTextReply: false };

    const msg = message as {
        conversation?: string;
        extendedTextMessage?: { text?: string };
        imageMessage?: { caption?: string };
        videoMessage?: { caption?: string };
        documentMessage?: { caption?: string };
        audioMessage?: unknown;
        stickerMessage?: unknown;
    };

    const text =
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        '';

    const bodyTrim = String(text || '').trim();
    if (bodyTrim.length > 0) {
        return { bodyText: bodyTrim, nonTextReply: false };
    }

    const hasMedia = Boolean(
        msg.imageMessage || msg.videoMessage || msg.documentMessage || msg.audioMessage || msg.stickerMessage
    );
    return { bodyText: '', nonTextReply: hasMedia };
}
