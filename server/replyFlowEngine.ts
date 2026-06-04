import { campaignRotationIndexFromPhone, resolveCampaignSpintax } from '../shared/campaignSpintax.js';
import { campaignClockVars } from '../src/utils/campaignClockVars.js';
import { campaignMediaStorageKey } from '../src/utils/campaignMediaKeys.js';
import { fetchCampaignDoc, usePostgresCampaigns } from './campaignStore.js';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { extractEvolutionMessageBody } from './evolutionWebhookMessages.js';

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
    sendAsMedia?: boolean;
    /** Chave em `campaignMediaById` (ex.: `campaignId:reply-step:1`). */
    mediaStorageKey?: string;
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
    /** Telemetria de resposta (funil/geo) com campaignId da sessão ativa. */
    onInboundReply?: (info: {
        campaignId: string;
        connectionId: string;
        phoneDigits: string;
        ownerUid?: string;
    }) => void;
    isCampaignPaused?: (campaignId: string) => boolean;
    /** Chamado quando todas as sessões de uma campanha são encerradas (reply flow concluído). */
    onAllSessionsClosed?: (campaignId: string) => void;
    /** Chamado quando uma sessão é criada ou seu estado muda (awaitingAfterStep) — para persistência. */
    onSessionSave?: (connectionId: string, phoneDigits: string, session: ReplyFlowSession) => void;
    /** Chamado quando uma sessão é descartada — para remoção da persistência. */
    onSessionDisposed?: (connectionId: string, phoneDigits: string) => void;
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
    vars: Record<string, string> = {},
    rotationIndex?: number
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
    const rot =
        typeof rotationIndex === 'number' && Number.isFinite(rotationIndex)
            ? Math.floor(rotationIndex)
            : campaignRotationIndexFromPhone(phone);
    return resolveCampaignSpintax(out, rot);
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
        remoteJid?: string;
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
        const aliasKeys = new Set<string>();
        if (params.convKey) aliasKeys.add(params.convKey);
        aliasKeys.add(`${params.connectionId}:${params.phoneDigits}`);
        const jid = String(params.remoteJid || '').trim();
        if (jid.includes('@')) aliasKeys.add(`${params.connectionId}:${jid}`);
        else if (params.phoneDigits.length >= 8) {
            aliasKeys.add(`${params.connectionId}:${params.phoneDigits}@s.whatsapp.net`);
        }
        for (const k of aliasKeys) {
            this.convToCanonical.set(k, sessKey);
        }
        this.adjustSessionCount(params.campaignId, 1);
        this.callbacks.onSessionSave?.(params.connectionId, params.phoneDigits, session);
    }

    /** Restaura sessão perdida (ex.: após restart do servidor). Não incrementa contador se já existir. */
    restoreSession(connectionId: string, phoneDigits: string, session: ReplyFlowSession): void {
        const sessKey = `${connectionId}:${phoneDigits}`;
        if (this.sessions.has(sessKey)) return;
        this.sessions.set(sessKey, session);
        if (session.registeredConvKey) {
            this.convToCanonical.set(session.registeredConvKey, sessKey);
        }
        if (phoneDigits.length >= 8) {
            this.convToCanonical.set(`${connectionId}:${phoneDigits}@s.whatsapp.net`, sessKey);
        }
        this.adjustSessionCount(session.campaignId, 1);
    }

    /** Retorna true se existe sessão em memória para este par connectionId:phone. */
    hasSession(connectionId: string, phoneDigits: string): boolean {
        if (this.sessions.has(`${connectionId}:${phoneDigits}`)) return true;
        const incoming = String(phoneDigits || '').replace(/\D/g, '');
        for (const key of this.sessions.keys()) {
            if (!key.startsWith(`${connectionId}:`)) continue;
            const sp = key.slice(connectionId.length + 1).replace(/\D/g, '');
            if (sp === incoming) return true;
        }
        return false;
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

    updateSessionAfterSend(connectionId: string, phoneDigits: string, newAwaitingAfterStep: number) {
        const sessKey = `${connectionId}:${phoneDigits}`;
        const sess = this.sessions.get(sessKey);
        if (sess) {
            sess.awaitingAfterStep = newAwaitingAfterStep;
            this.callbacks.onSessionSave?.(connectionId, phoneDigits, sess);
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
        // Extrai connectionId:phoneDigits do canonicalKey para notificar persistência
        const colonIdx = canonicalKey.indexOf(':');
        if (colonIdx > 0) {
            const connectionId = canonicalKey.slice(0, colonIdx);
            const phoneDigits = canonicalKey.slice(colonIdx + 1);
            this.callbacks.onSessionDisposed?.(connectionId, phoneDigits);
        }
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

    private async loadDefFromFirestore(campaignId: string, ownerUid?: string): Promise<{ steps: ReplyFlowStepDef[] } | null> {
        try {
            const admin = getFirebaseAdmin();
            if (!admin) return null;
            const db = getFirestore(admin);

            let docData: Record<string, unknown> | undefined;

            if (ownerUid) {
                if (usePostgresCampaigns()) {
                    docData = (await fetchCampaignDoc(ownerUid, campaignId)) ?? undefined;
                } else {
                    const docSnap = await db.doc(`users/${ownerUid}/campaigns/${campaignId}`).get();
                    if (docSnap.exists) docData = docSnap.data() as Record<string, unknown>;
                }
            }

            if (!docData) {
                // Fallback: busca pelo campo `id` na collectionGroup (sem __name__ que não funciona).
                const snap = await db.collectionGroup('campaigns').where('id', '==', campaignId).limit(1).get();
                if (!snap.empty) docData = snap.docs[0].data() as Record<string, unknown>;
            }

            if (docData?.replyFlow && typeof docData.replyFlow === 'object') {
                const rf = docData.replyFlow as Record<string, unknown>;
                if (rf.enabled && Array.isArray(rf.steps)) {
                    const sanitized = sanitizeReplyFlowSteps(rf.steps as any[]);
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
        if (!found) {
            const activeOnConn = [...this.sessions.keys()].some((k) => k.startsWith(`${connectionId}:`));
            if (activeOnConn) {
                this.callbacks.onLog?.('Resposta recebida mas sem sessao de etapas correspondente', {
                    connectionId,
                    phoneDigits,
                    incomingConvId,
                });
            }
            return;
        }

        const { key, session } = found;
        let def = this.defs.get(session.campaignId);
        if (!def?.steps?.length) {
            def = (await this.loadDefFromFirestore(session.campaignId, session.ownerUid)) ?? undefined;
        }
        if (!def?.steps?.length) {
            this.disposeSession(key, session);
            return;
        }

        if (this.callbacks.isCampaignPaused?.(session.campaignId)) return;

        this.callbacks.onInboundReply?.({
            campaignId: session.campaignId,
            connectionId,
            phoneDigits,
            ownerUid: session.ownerUid,
        });

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
        void this.callbacks.enqueue({
            to: session.toRaw,
            message: nextBody,
            connectionId,
            campaignId: session.campaignId,
            mediaStorageKey: stepMediaKey || undefined,
            replyFlowAfterSend: { phoneDigits: sessionPhoneKey, newAwaitingAfterStep: nextIdx },
        });
    }
}

/** Extrai texto de mensagem recebida via webhook Evolution API. */
export function extractEvolutionReplyBody(message: Record<string, unknown> | undefined): {
    bodyText: string;
    nonTextReply: boolean;
} {
    return extractEvolutionMessageBody(message);
}
