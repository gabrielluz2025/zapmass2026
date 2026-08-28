/**
 * Evolution API Service
 * Substitui whatsapp-web.js por Evolution API (99% estável)
 * 
 * @version 2.3.0
 * @date 2026-01-24
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { Queue, Worker, Job, DelayedError, UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evolutionConfig, isEvolutionGoEngine, isGoWebhookInboxMode } from './evolutionConfig.js';
import { createEvolutionHttpClient } from './evolutionProvider/createEvolutionHttpClient.js';
import {
    looksLikeBase64Image,
    looksLikeWhatsAppPairingCode,
} from './evolutionProvider/goRouteAdapter.js';
import { normalizeEvolutionGoWebhookIfNeeded } from './evolutionProvider/evolutionGoWebhookAdapter.js';
import {
    assertEvolutionGoLicensed,
    evolutionGoLicenseUserMessage,
    isEvolutionGoLicenseError,
} from './evolutionGoLicense.js';
import { attachEvolutionAxiosRetry } from './evolutionAxiosRetry.js';
import { notifyTenant } from './tenantNotifyService.js';
import { getEffectiveRedisUrl } from './redisConfig.js';
import { getSharedRedis } from './redisShared.js';
import {
    attachRedisStressGuard,
    attachWorkerStressGuard,
    isBullmqRecoveryPending,
    type BullmqRecoveryHandler,
} from './redisBullmqResilience.js';
import { bullmqRemoveOnComplete, bullmqRemoveOnFail, trimBullmqQueue } from './bullmqRetention.js';
import { saveMediaFromBase64 } from './mediaStorage.js';
import {
    buildOutboundPhoneVariants,
    normalizeOutboundNumber,
    parseWhatsAppNumberCheckRows,
    pickWhatsAppCheckResult,
    type WhatsAppNumberCheckRow,
} from './evolutionOutboundPhone.js';
import {
    createPhonebookNameIndex,
    evolutionContactDisplayName,
    filterEvolutionContactLabel,
    indexPhonebookRow,
    resolvePhonebookName,
    type PhonebookNameIndex,
} from './evolutionContactName.js';
import { buildPhoneDigitLookupKeys, normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { LID_SEND_BLOCKED_MSG } from './evolutionLidResolve.js';
import {
    ReplyFlowEngine,
    applyMessageVars,
    buildRecipientVarsMap,
    extractEvolutionReplyBody,
    normalizePhoneKey,
    sanitizeReplyFlowSteps,
    sanitizeReplyFlowMeta,
    type CampaignRecipient,
    type ReplyFlowSession,
} from './replyFlowEngine.js';
import { campaignMediaStorageKey } from '../src/utils/campaignMediaKeys.js';
import { persistCampaignLogToFirestore, persistCampaignProgressToFirestore } from './campaignPersistence.js';
import {
    collectCampaignChannelIds,
    evaluateCampaignDispatchGuard,
    type CampaignDispatchGuardResult
} from './campaignChipGuard.js';
import { spreadCampaignJobsOnResume } from './campaignGradualResume.js';
import { pickDispatchChannel, pickInitialDispatchChannel } from './campaignPoolDispatch.js';
import {
    resolvePoolStrategy,
    saveCampaignPoolConfig,
    type PoolStrategy,
} from './campaignPoolRedis.js';
import { getChipCircuitBreaker } from './chipCircuitBreaker.js';
import { getReconnectStormProgress } from './chipProtectionService.js';
import {
    CAMPAIGN_RESUME_GRACE_MS,
    isInDeployGraceWindow,
    processUptimeMs,
} from '../shared/deployGrace.js';
import { runEvolutionReconnectExclusive } from './evolutionReconnectQueue.js';
import {
    computeTierExtraDelayMs,
    isTierDailyCapReached,
    resolveChipTier,
} from './chipTrustScore.js';
import { checkInboundAutomationAllowed } from './inboundAutomationGuard.js';
import {
  buildInboundAutomationDedupeKey,
  isInboundAutomationProcessed,
  markInboundAutomationProcessed,
} from './inboundAutomationDedupe.js';
import type { InboundProcessParams } from './inboundMissedReplay.js';
import { validateCampaignContentHash } from './campaignContentHashLock.js';
import {
    cancelCampaignJobsForPhone,
    handleInboundOptOut,
    isContactOptedOut,
} from './contactOptOutService.js';
import {
    emitAntiBanAlert,
    registerAntiBanPublishFn,
} from './antiBanProactiveNotifications.js';
import { computeDailyScheduleDelayMs } from './campaignDailyScheduleDelay.js';
import { buildCampaignReportSnapshot, persistCampaignReportSnapshot } from './campaignReportSnapshot.js';
import { refreshRedispatchTargetPhones } from './campaignRedispatchPhoneRefresh.js';
import {
    registerCampaignJob,
    markJobSending,
    finalizeCampaignJob,
    isBackpressureActive,
} from './campaignJobsResilience.js';
import { fullSyncIntervalMs } from '../shared/dailyFullSync.js';
import { isEvolutionFullHistorySyncEnabled } from '../shared/chatSyncConfig.js';
import {
    campaignRotationIndexFromPhone,
    hasUnresolvedCampaignTemplateTokens,
    sanitizeCampaignTemplateForOutbound,
} from '../shared/campaignSpintax.js';
import {
    getOwnerLastFullSyncMs,
    markOwnerFullSyncDone,
    ownerFullSyncIsDue,
} from './ownerFullSyncStore.js';
import {
    EVO_FIND_MAX_PAGES,
    EVO_FIND_PAGE_SIZE,
    evolutionFindPageQuery,
    extractEvolutionList,
} from './evolutionFindQuery.js';
import {
    getTenantDispatchSettings,
    resolveCampaignDispatchSettings,
    saveTenantSettings,
    type TenantSettingsClientPayload,
} from './tenantSettings.js';
import {
    grantSleepModeOverride,
    hasSleepModeOverride,
    isBrazilNightHour,
    markSleepModeNotified,
    msUntilBrazil8am,
    pruneSleepModeNotified,
} from './sleepModeService.js';
import {
    evolutionRegisterCampaign,
    evolutionTrackIncomingReply,
    evolutionTrackMessageAck,
    evolutionTrackMessageSent,
    evolutionTrackManualMessageSent,
    logCampaignContactReply,
    resolveLatestCampaignForReply,
    getCampaignGeoOwner,
    publishOwnerEvent,
    recordConnectionDispatch,
} from './whatsappService.js';

registerAntiBanPublishFn((tenantId, event, payload) => {
    publishOwnerEvent(tenantId, event, payload);
});
import { createEvolutionChat, type EvolutionChatStore } from './evolutionChat.js';
import {
    buildEvolutionIncomingConvId,
    extractEvolutionMessageBody,
    normalizeEvolutionWebhookMessages,
    resolvePhoneDigitsFromEvolutionMessage,
} from './evolutionWebhookMessages.js';
import { handleSupportBotIncoming } from './supportBot/supportBotEngine.js';
import {
  completeNurtureStepAfterSend,
  handleNurtureIncoming,
  registerNurtureEnqueue,
  tryAutoEnrollOnOptIn
} from './nurture/nurtureEngine.js';
import { tryAutoEnrollHotLead } from './nurture/nurtureHotLeads.js';
import { loadJourneyByIdPg } from './nurture/nurtureRepository.js';
import { dispatchEvolutionWebhook, initEvolutionWebhookQueue } from './evolutionWebhookQueue.js';
import {
    extractEvolutionMessageUpdates,
    parseEvolutionMessageStatus
} from './evolutionMessageStatus.js';
import { isLegacyConnectionId } from '../src/utils/connectionScope.js';
import { tenantScopeUidsMatch } from './auth/tenantUidScopeServer.js';
import {
    filterByConnectionScope,
    ownsConnectionForTenant as ownsConnectionForUid,
} from './connectionScopeServer.js';
import {
    canReconcileLegacyCampaignOwner,
    resolveCampaignTenantOwner,
    lookupCampaignOwnerUidInDatastore,
    buildCampaignOwnerLookupUids,
} from './campaignTenantScope.js';
import type { Server as SocketIOServer } from 'socket.io';
import { isEvolutionOpenState } from './evolutionOpenState.js';
import { formatEvolutionHttpError } from './evolutionChatSend.js';
import type { CampaignStageConfig } from '../src/types.js';
import {
    initMultiStepContactStates,
    onContactReply,
    onStepCompleted,
    updateContactStateOnFailure,
} from './campaignMultiStepEngine.js';
import { isCampaignFlowContinuation } from './campaignFlowContinuation.js';
import { usePostgresCampaigns } from './campaignStore.js';
import { countWaitingReplyForCampaign, getContactStateSummary } from './repositories/campaignContactStateRepository.js';

// ================== INTERFACES ==================

import { WhatsAppConnection, ConnectionStatus, DashboardMetrics, Conversation, ChatMessage } from './types.js';

export interface ConnectionProxyConfig {
    host: string;
    port: string | number;
    protocol?: 'http' | 'https' | 'socks4' | 'socks5';
    username?: string;
    password?: string;
}

interface EvolutionInstance {
    instanceName: string;
    friendlyName: string;
    status: 'created' | 'connecting' | 'open' | 'close';
    /** Firebase uid quando o id e legado (`conn_*` sem `uid__`). */
    ownerUid?: string;
    profilePicUrl?: string;
    profileName?: string;
    phoneNumber?: string;
    qrCode?: string;
    proxy?: ConnectionProxyConfig;
    dailyLimit?: number;
    growthRate?: number;
    growthType?: 'percent' | 'fixed';
    limitAction?: 'ask' | 'redirect';
    messagesSentToday?: number;
    limitExceededApproved?: boolean;
    lastLimitResetDate?: string;
    lastActivity?: string;
    /** Timestamp em que este chip ficou 'open' pela última vez — usado para detectar ban rápido. */
    lastOpenAt?: number;
}

type ExtractedEvolutionQr = { displayValue: string; kind: 'code' | 'image' };

function mapEvolutionState(raw: unknown): EvolutionInstance['status'] {
    const state = String(raw || '').toLowerCase();
    if (isEvolutionOpenState(state)) return 'open';
    if (state === 'connecting') return 'connecting';
    if (state === 'created' || state === 'qrcode') return 'created';
    return 'close';
}

function phoneDigitsFromJidLike(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    let base = value.includes('@') ? value.split('@')[0]! : value.trim();
    // JID multi-device: 5547999999999:19@s.whatsapp.net → só o número
    if (base.includes(':')) {
        base = base.split(':')[0]!;
    }
    const digits = base.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) return undefined;
    return digits;
}

function phoneFromEvolutionRow(row: Record<string, unknown>): string | undefined {
    const nested =
        row.instance && typeof row.instance === 'object'
            ? (row.instance as Record<string, unknown>)
            : null;
    for (const candidate of [
        row.ownerJid,
        row.owner,
        row.number,
        row.phone,
        row.wuid,
        row.jid,
        nested?.ownerJid,
        nested?.owner,
        nested?.wuid,
        nested?.number,
        nested?.phone,
    ]) {
        const digits = phoneDigitsFromJidLike(candidate);
        if (digits) return digits;
    }
    return undefined;
}

function phoneFromWebhookData(data?: Record<string, unknown>): string | undefined {
    if (!data) return undefined;
    const nested =
        data.instance && typeof data.instance === 'object'
            ? (data.instance as Record<string, unknown>)
            : undefined;
    for (const candidate of [
        data.wuid,
        data.ownerJid,
        data.owner,
        data.number,
        data.phone,
        data.jid,
        data.ID,
        nested?.wuid,
        nested?.ownerJid,
        nested?.owner,
        nested?.number,
    ]) {
        const digits = phoneDigitsFromJidLike(candidate);
        if (digits) return digits;
    }
    return undefined;
}

/** Evolution v2 nem sempre manda wuid no webhook — busca ownerJid em fetchInstances. */
function parseProfilePictureFromApiData(raw: unknown): string | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    for (const key of ['profilePictureUrl', 'url', 'picture', 'imgUrl', 'avatar', 'base64'] as const) {
        const v = row[key];
        if (typeof v !== 'string' || v.length < 8) continue;
        if (v.startsWith('http') || v.startsWith('data:')) return v;
        const compact = v.replace(/\s/g, '');
        if (/^[A-Za-z0-9+/=]{32,}$/.test(compact)) {
            return `data:image/jpeg;base64,${compact}`;
        }
    }
    const nested = row.response ?? row.data ?? row.result;
    if (nested && nested !== raw) return parseProfilePictureFromApiData(nested);
    return null;
}

async function enrichConnectionMeta(instanceName: string): Promise<void> {
    const conn = connections.get(instanceName);
    if (!conn) return;

    let changed = false;
    try {
        const response = await api.get('/instance/fetchInstances');
        const raw = response.data;
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.instances) ? raw.instances : [];
        const row = list.find((item: unknown) => {
            if (!item || typeof item !== 'object') return false;
            const r = item as Record<string, unknown>;
            const name = String(
                r.name || r.instanceName || (r.instance as Record<string, unknown> | undefined)?.instanceName || ''
            ).trim();
            return name === instanceName;
        }) as Record<string, unknown> | undefined;

        if (row) {
            const phone = phoneFromEvolutionRow(row);
            if (phone && conn.phoneNumber !== phone) {
                conn.phoneNumber = phone;
                changed = true;
            }
            if (typeof row.profilePicUrl === 'string' && row.profilePicUrl && conn.profilePicUrl !== row.profilePicUrl) {
                conn.profilePicUrl = row.profilePicUrl;
                changed = true;
            }
            if (typeof row.profileName === 'string' && row.profileName.trim()) {
                conn.profileName = row.profileName.trim();
                if (isGenericConnectionLabel(conn.friendlyName, instanceName)) {
                    conn.friendlyName = conn.profileName;
                    mergeConnectionSettingsCache(instanceName, {
                        friendlyName: conn.friendlyName,
                        ownerUid: conn.ownerUid,
                        createdByUid: connectionsSettingsCache[instanceName]?.createdByUid,
                    });
                    saveConnectionsSettings();
                }
                changed = true;
            }
        }
    } catch (error: any) {
        log('warn', `enrichConnectionMeta(${instanceName}) falhou`, { error: error?.message });
    }

    if (!conn.profilePicUrl?.trim() && conn.phoneNumber?.replace(/\D/g, '').length >= 10) {
        const phone = conn.phoneNumber!.replace(/\D/g, '');
        const numberCandidates = [
            phone,
            `${phone}@s.whatsapp.net`,
            conn.phoneNumber!.trim(),
        ].filter((n, i, arr) => n && arr.indexOf(n) === i);
        for (const number of numberCandidates) {
            try {
                const picResp = await api.post(`/chat/fetchProfilePictureUrl/${evoInst(instanceName)}`, {
                    number,
                    preview: true,
                });
                const pic = parseProfilePictureFromApiData(picResp.data);
                if (pic && conn.profilePicUrl !== pic) {
                    conn.profilePicUrl = pic;
                    changed = true;
                    log('info', `Avatar carregado para ${instanceName}`, {
                        bytes: pic.length,
                    });
                    break;
                }
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                log('warn', `enrichConnectionMeta: avatar ${instanceName} (${number}) falhou`, { error: msg });
            }
        }
    }

    if (changed) {
        connections.set(instanceName, conn);
        const ownerUid = resolveOwnerUid(instanceName);
        if (ownerUid) {
            publishOwnerEvent(ownerUid, 'connections-update', filterByConnectionScope(ownerUid, getConnections()));
        } else {
            warnUnscopedConnectionEvent(instanceName, 'connections-update');
        }
    }
}

function isRetryableOutbound400(errorDetail?: string): boolean {
    return isUnrecoverableOutboundError(errorDetail);
}

function isUnrecoverableOutboundError(errorDetail?: string): boolean {
    if (!errorDetail) return false;
    return /HTTP 400|status code 400|exists:\s*false|não encontrado no WhatsApp|não encontrado|recusou o envio \(400\)|Número inválido|não foi possível obter o número|Contato não encontrado|mensagem vazia/i.test(
        errorDetail
    );
}

/**
 * Consulta Evolution `/chat/whatsappNumbers` — corrige 9º dígito quando possível.
 * Falso negativo não bloqueia o envio (tentativa real decide).
 */
async function checkWhatsAppNumberExists(
    connectionId: string,
    digits: string
): Promise<{ exists: boolean; canonicalNumber?: string; checkFailed?: boolean; lidOnly?: boolean; emptyResponse?: boolean }> {
    try {
        const response = await api.post(`/chat/whatsappNumbers/${evoInst(connectionId)}`, {
            numbers: [digits],
        });
        const rows = parseWhatsAppNumberCheckRows(response.data);
        const picked = pickWhatsAppCheckResult(rows as WhatsAppNumberCheckRow[], digits);
        if (picked.exists && picked.canonicalNumber) {
            return { exists: true, canonicalNumber: picked.canonicalNumber };
        }
        return {
            exists: false,
            lidOnly: picked.lidOnly,
            emptyResponse: picked.emptyResponse,
        };
    } catch (error: unknown) {
        const ax = error as { message?: string };
        log('warn', 'whatsappNumbers indisponível — seguindo com envio direto', {
            connectionId,
            digits,
            error: ax?.message,
        });
        return { exists: true, canonicalNumber: digits, checkFailed: true };
    }
}

/** Escolhe o E.164 válido no WhatsApp (tenta variantes BR com/sem 9º dígito). */
async function resolveOutboundNumberForSend(
    connectionId: string,
    to: string
): Promise<{ number: string } | { error: string }> {
    const normalized = normalizeOutboundNumber(to);
    if (!normalized) {
        return { error: `Número inválido: ${to}` };
    }

    const variants = buildOutboundPhoneVariants(normalized);
    let sawDefiniteMissing = false;
    let sawLidOnly = false;
    let sawEmptyResponse = false;

    for (const variant of variants) {
        const check = await checkWhatsAppNumberExists(connectionId, variant);
        if (check.checkFailed) {
            return { number: normalized };
        }
        if (check.exists && check.canonicalNumber) {
            if (check.canonicalNumber !== normalized) {
                log('info', 'Número corrigido via whatsappNumbers', {
                    connectionId,
                    from: normalized,
                    to: check.canonicalNumber,
                    variantTried: variant,
                });
            }
            return { number: check.canonicalNumber };
        }
        if (check.lidOnly) sawLidOnly = true;
        if (check.emptyResponse) sawEmptyResponse = true;
        sawDefiniteMissing = true;
    }

    if (sawLidOnly && !sawEmptyResponse) {
        return { error: LID_SEND_BLOCKED_MSG };
    }

    if (sawDefiniteMissing) {
        log('warn', 'whatsappNumbers não confirmou contato — tentando envio direto', {
            connectionId,
            normalized,
            variantsTried: variants.slice(0, 6),
        });
    }

    return { number: normalized };
}

function extractEvolutionQr(source: unknown): ExtractedEvolutionQr | null {
    if (!source || typeof source !== 'object') return null;
    const root = source as Record<string, unknown>;
    const qrcode =
        root.qrcode && typeof root.qrcode === 'object'
            ? (root.qrcode as Record<string, unknown>)
            : root;

    const base64 = qrcode.base64;
    if (typeof base64 === 'string' && base64.trim()) {
        const trimmed = base64.trim();
        if (looksLikeWhatsAppPairingCode(trimmed)) {
            return { displayValue: trimmed, kind: 'code' };
        }
        if (trimmed.startsWith('data:image/') || looksLikeBase64Image(trimmed)) {
            if (trimmed.startsWith('data:image/')) {
                return { displayValue: trimmed, kind: 'image' };
            }
            return { displayValue: `data:image/png;base64,${trimmed}`, kind: 'image' };
        }
    }

    const code = qrcode.code ?? qrcode.pairingCode;
    if (typeof code === 'string' && code.trim()) {
        return { displayValue: code.trim(), kind: 'code' };
    }

    const rootBase64 = root.base64;
    if (typeof rootBase64 === 'string' && rootBase64.trim()) {
        const trimmed = rootBase64.trim();
        if (looksLikeWhatsAppPairingCode(trimmed)) {
            return { displayValue: trimmed, kind: 'code' };
        }
        if (trimmed.startsWith('data:image/') || looksLikeBase64Image(trimmed)) {
            return {
                displayValue: trimmed.startsWith('data:image/') ? trimmed : `data:image/png;base64,${trimmed}`,
                kind: 'image',
            };
        }
    }
    return null;
}

function extractQrFromApiResponse(data: unknown): ExtractedEvolutionQr | null {
    if (!data || typeof data !== 'object') return null;
    const payload = data as Record<string, unknown>;
    return (
        extractEvolutionQr(payload) ||
        extractEvolutionQr(payload.instance) ||
        extractEvolutionQr({ qrcode: payload.qrcode })
    );
}

function emitConnectionProgress(
    connectionId: string,
    phase:
        | 'preparing'
        | 'launching-browser'
        | 'loading-whatsapp-web'
        | 'awaiting-scan'
        | 'authenticated'
        | 'ready'
        | 'failed'
) {
    const payload = { connectionId, phase };
    const ownerUid = resolveOwnerUid(connectionId);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'connection-progress', payload);
    } else {
        warnUnscopedConnectionEvent(connectionId, 'connection-progress');
    }
}

function warnUnscopedConnectionEvent(connectionId: string, event: string) {
    log('warn', `Evento ${event} ignorado (canal sem ownerUid): ${connectionId}`);
}

function emitConnectionsUpdateForConnection(connectionId: string) {
    const ownerUid = resolveOwnerUid(connectionId);
    if (!ownerUid) {
        warnUnscopedConnectionEvent(connectionId, 'connections-update');
        return;
    }
    publishOwnerEvent(ownerUid, 'connections-update', filterByConnectionScope(ownerUid, getConnections()));
    if (io) {
        io.to(`user:${ownerUid}`).emit(
            'connections-update',
            filterByConnectionScope(ownerUid, getConnections())
        );
    }
}

function emitToConnectionFrontend(
    connectionId: string,
    event: string,
    payload: Record<string, unknown>
) {
    const ownerUid = resolveOwnerUid(connectionId);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, event, payload);
        return;
    }
    warnUnscopedConnectionEvent(connectionId, event);
}

function emitConnectionOpenToFrontend(connectionId: string) {
    emitConnectionProgress(connectionId, 'authenticated');
    emitToConnectionFrontend(connectionId, 'connection-authenticated', { connectionId });
    emitConnectionProgress(connectionId, 'ready');
    emitToConnectionFrontend(connectionId, 'connection-ready', { connectionId });
}

function ownerUidFromConnectionId(connectionId: string): string | undefined {
    const idx = connectionId.indexOf('__');
    return idx > 0 ? connectionId.slice(0, idx) : undefined;
}

function resolveOwnerUid(connectionId: string): string | undefined {
    return (
        ownerUidFromConnectionId(connectionId) ||
        connections.get(connectionId)?.ownerUid ||
        connectionsSettingsCache[connectionId]?.ownerUid
    );
}

/** Exportado para escopo de conversas (ids legados `conn_*` + ownerUid em settings). */
export function resolveConnectionOwnerUid(connectionId: string): string | undefined {
    return resolveOwnerUid(connectionId);
}

/** UIDs distintos com pelo menos um canal na RAM (proteção automática por tenant). */
export function listConnectionOwnerUids(): string[] {
    const set = new Set<string>();
    for (const [id] of connections.entries()) {
        const ou = resolveOwnerUid(id);
        if (ou) set.add(ou);
    }
    return [...set];
}

function tenantOwnsConnection(tenantUid: string, connectionId: string): boolean {
    return ownsConnectionForUid(tenantUid, connectionId, resolveOwnerUid(connectionId));
}

/** Canais legados na RAM sem dono (qualquer estado) — reparo pós-scan/sync. */
export function listOrphanOpenConnectionIds(): string[] {
    const out: string[] = [];
    for (const [id] of connections.entries()) {
        if (ownerUidFromConnectionId(id)) continue;
        if (resolveOwnerUid(id)) continue;
        out.push(id);
    }
    return out;
}

/**
 * Vincula canal legado `conn_*` sem dono ao tenant — somente na criação explícita do canal.
 * Nunca usar em sync/login (evita roubar chip de outro usuário na Evolution compartilhada).
 */
export function tryClaimUnownedLegacyConnection(connectionId: string, ownerUid: string): boolean {
    const uid = String(ownerUid || '').trim();
    const id = String(connectionId || '').trim();
    if (!uid || uid === 'anonymous' || !id || !isLegacyConnectionId(id)) return false;
    if (resolveOwnerUid(id)) return false;

    const conn = connections.get(id);
    if (conn) {
        return assignConnectionOwner(id, uid);
    }

    // Evolution ainda não hidratou a RAM — persiste dono em settings para desbloquear socket/REST.
    const cached = connectionsSettingsCache[id];
    if (cached?.ownerUid) return false;
    if (!connectionsSettingsCache[id]) {
        connectionsSettingsCache[id] = {};
    }
    connectionsSettingsCache[id].ownerUid = uid;
    connectionsSettingsCache[id].createdByUid =
        connectionsSettingsCache[id].createdByUid?.trim() || uid;
    saveConnectionsSettings();
    return true;
}

/** Resolve dono, tenta claim legado sem dono e valida escopo do tenant (socket + REST). */
export function ensureTenantOwnsConnection(
    tenantUid: string,
    connectionId: string,
    workspaceMemberUids?: ReadonlySet<string>
): boolean {
    const uid = String(tenantUid || '').trim();
    const id = String(connectionId || '').trim();
    if (!id) return false;

    let meta = resolveOwnerUid(id);
    if (ownsConnectionForUid(uid || 'anonymous', id, meta)) {
        return true;
    }

    if (!meta && isLegacyConnectionId(id)) {
        tryClaimUnownedLegacyConnection(id, uid);
        meta = resolveOwnerUid(id);
    }

    return ownsConnectionForUid(uid || 'anonymous', id, meta);
}

export function assignConnectionOwner(
    connectionId: string,
    ownerUid: string,
    opts?: { replacePriorOwner?: string }
): boolean {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') return false;
    const conn = connections.get(connectionId);
    if (!conn) return false;
    if (conn.ownerUid && !tenantScopeUidsMatch(conn.ownerUid, uid)) {
        const prior = opts?.replacePriorOwner?.trim();
        if (!prior || !tenantScopeUidsMatch(conn.ownerUid, prior)) return false;
    }
    const fromId = ownerUidFromConnectionId(connectionId);
    if (fromId && fromId !== uid) return false;
    conn.ownerUid = uid;
    connections.set(connectionId, conn);

    // Salva o dono de forma persistente no disco
    if (!connectionsSettingsCache[connectionId]) {
        connectionsSettingsCache[connectionId] = {};
    }
    connectionsSettingsCache[connectionId].ownerUid = uid;
    connectionsSettingsCache[connectionId].createdByUid =
        connectionsSettingsCache[connectionId].createdByUid?.trim() || uid;
    saveConnectionsSettings();

    publishOwnerEvent(uid, 'connections-update', filterByConnectionScope(uid, getConnections()));
    return true;
}

/** Instância já pareada (número ou config persistida) — não apagar em dedupe/prune automático. */
function isIntentionalPairedConnection(id: string, conn?: EvolutionInstance): boolean {
    const mem = conn ?? connections.get(id);
    if (mem?.phoneNumber?.trim()) return true;
    const cached = connectionsSettingsCache[id];
    if (!cached) return false;
    if (cached.friendlyName?.trim()) return true;
    if (cached.ownerUid?.trim()) return true;
    return false;
}

/**
 * Só `created`/`connecting` sem telefone e sem settings de pareamento.
 * Nunca `open`/`close` — sessão offline recuperável.
 */
export function isConnectionEligibleForAutoPruneDelete(id: string, evolutionState?: string): boolean {
    const mem = connections.get(id);
    const status = evolutionState ? mapEvolutionState(evolutionState) : mem?.status;
    if (status === 'open' || status === 'close') return false;
    if (isIntentionalPairedConnection(id, mem)) return false;
    if (mem?.phoneNumber?.trim()) return false;
    return status === 'created' || status === 'connecting';
}

/** Remove instâncias Evolution zumbis (`created` órfãs) — nunca `connecting`/`close`/`open`. */
export async function pruneConnectingZombiesForOwner(ownerUid: string): Promise<{ deleted: string[]; keptOpen: string[] }> {
    const uid = String(ownerUid || '').trim();
    const deleted: string[] = [];
    const keptOpen: string[] = [];
    if (!uid || uid === 'anonymous') return { deleted, keptOpen };

    try {
        const response = await api.get('/instance/fetchInstances');
        const raw = response.data;
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.instances) ? raw.instances : [];

        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Record<string, unknown>;
            const instanceName = String(
                row.name || row.instanceName || (row.instance as Record<string, unknown> | undefined)?.instanceName || ''
            ).trim();
            if (!instanceName) continue;

            const state = mapEvolutionState(row.connectionStatus ?? row.state ?? row.status);
            if (state === 'open') {
                if (resolveOwnerUid(instanceName) === uid) keptOpen.push(instanceName);
                continue;
            }
            if (resolveOwnerUid(instanceName) !== uid) continue;
            // Conservador: só `created` sem pareamento — connecting/close podem ser sessão ativa ou offline.
            if (state !== 'created') continue;
            if (connectionWatchTimers.has(instanceName) || qrWatchTimers.has(instanceName)) continue;
            if (!isConnectionEligibleForAutoPruneDelete(instanceName, state)) continue;

            try {
                log('warn', `Auto-prune: removendo zumbi Evolution`, {
                    connectionId: instanceName,
                    ownerUid: uid,
                    evolutionState: state,
                    caller: 'pruneConnectingZombiesForOwner',
                });
                try {
                    await api.delete(`/instance/logout/${evoInst(instanceName)}`);
                } catch {
                    /* ok */
                }
                await api.delete(`/instance/delete/${evoInst(instanceName)}`);
                stopWatchingConnection(instanceName);
                connections.delete(instanceName);
                chatStore.purgeConversationsForConnection(instanceName);
                deleted.push(instanceName);
                log('info', `Zumbi Evolution removido: ${instanceName} (${state})`);
            } catch (error: any) {
                log('warn', `Falha ao remover zumbi ${instanceName}`, { error: error?.message });
            }
        }
    } catch (error: any) {
        log('warn', 'pruneConnectingZombiesForOwner falhou', { error: error?.message });
    }

    if (deleted.length > 0) {
        const scoped = filterByConnectionScope(uid, getConnections());
        publishOwnerEvent(uid, 'connections-update', scoped);
    }
    return { deleted, keptOpen };
}

/** Remove chips duplicados do mesmo tenant (mesmo telefone): apaga só zumbis quando há sessão keeper. */
export async function pruneDuplicatePhoneConnectionsForOwner(ownerUid: string): Promise<string[]> {
    const uid = String(ownerUid || '').trim();
    const deleted: string[] = [];
    if (!uid || uid === 'anonymous') return deleted;

    const byPhone = new Map<string, string[]>();

    for (const [id, conn] of connections.entries()) {
        if (resolveOwnerUid(id) !== uid) continue;
        const phone = normalizePhoneKey(String(conn.phoneNumber || ''));
        if (phone) {
            const list = byPhone.get(phone) ?? [];
            list.push(id);
            byPhone.set(phone, list);
        }
    }

    const toDelete = new Set<string>();

    const markPhoneDuplicates = (ids: string[]) => {
        if (ids.length < 2) return;
        const hasKeeper = ids.some((id) => !isConnectionEligibleForAutoPruneDelete(id));
        if (!hasKeeper) return;
        for (const id of ids) {
            if (!isConnectionEligibleForAutoPruneDelete(id)) continue;
            toDelete.add(id);
        }
    };

    for (const ids of byPhone.values()) markPhoneDuplicates(ids);

    for (const id of toDelete) {
        if (connectionWatchTimers.has(id) || qrWatchTimers.has(id)) continue;
        try {
            const label =
                connections.get(id)?.friendlyName ||
                connectionsSettingsCache[id]?.friendlyName ||
                id;
            const phone = normalizePhoneKey(String(connections.get(id)?.phoneNumber || ''));
            await deleteConnection(id, {
                reason: 'duplicate_phone_zombie',
                caller: 'pruneDuplicatePhoneConnectionsForOwner',
                phone,
            });
            deleted.push(id);
            log('info', `Chip duplicado (zumbi) removido (${uid}): ${id} (${label})`);
        } catch (error: any) {
            log('warn', `Falha ao remover duplicado ${id}`, { error: error?.message });
        }
    }

    return deleted;
}

/** Prune explícito (admin/reparo) — não roda no fluxo de criar/parear canal. */
export async function adminPruneConnectionZombiesForOwner(ownerUid: string): Promise<{
    zombies: string[];
    duplicates: string[];
}> {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') return { zombies: [], duplicates: [] };
    await hydrateInstancesFromEvolution();
    const pruned = await pruneConnectingZombiesForOwner(uid);
    const dupes = await pruneDuplicatePhoneConnectionsForOwner(uid);
    return { zombies: pruned.deleted, duplicates: dupes };
}

/** Reidrata RAM a partir de connections_settings.json (canais offline sumidos após restart/prune). */
function ensureCachedConnectionsInRamForOwner(ownerUid: string): string[] {
    const uid = String(ownerUid || '').trim();
    const restored: string[] = [];
    if (!uid || uid === 'anonymous') return restored;

    for (const [connId, row] of Object.entries(connectionsSettingsCache)) {
        if (!row?.ownerUid || !tenantOwnsConnection(uid, connId)) continue;
        if (connections.has(connId)) continue;
        // Tombstone: não restaurar conexões explicitamente deletadas
        if (deletedConnectionIds.has(connId)) continue;
        const friendlyName = resolveDisplayFriendlyName(connId, undefined, row);
        const instance: EvolutionInstance = {
            instanceName: connId,
            friendlyName,
            status: 'close',
            ownerUid: row.ownerUid,
        };
        applySettingsToInstance(instance);
        connections.set(connId, instance);
        restored.push(connId);
        log('info', `Canal restaurado do cache (offline): ${connId}`, {
            ownerUid: uid,
            friendlyName,
        });
    }
    return restored;
}

/** Evolution + cache em disco → RAM antes de emitir connections-update (socket boot / cooldown). */
export async function ensureConnectionsHydratedForOwner(ownerUid: string): Promise<WhatsAppConnection[]> {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') return [];
    await hydrateInstancesFromEvolution();
    ensureCachedConnectionsInRamForOwner(uid);
    return filterByConnectionScope(uid, getConnections());
}

/** Evolution → memória → dono → chats (painel + pipeline). */
export async function syncConnectionsForOwner(
    ownerUid: string,
    opts?: { force?: boolean }
): Promise<{
    connections: WhatsAppConnection[];
    claimed: string[];
    syncedChats: string[];
    skippedCooldown?: boolean;
}> {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') {
        return { connections: [], claimed: [], syncedChats: [] };
    }

    const withinCooldown = !(await ownerFullSyncIsDue(uid, opts?.force));

    if (withinCooldown) {
        const lastSync = await getOwnerLastFullSyncMs(uid);
        log('info', 'syncConnectionsForOwner: cooldown ativo — hidrata RAM e reemite', {
            ownerUid: uid,
            cooldownSec: Math.ceil((fullSyncIntervalMs() - (Date.now() - lastSync)) / 1000),
        });
        const scoped = await ensureConnectionsHydratedForOwner(uid);
        await reemitConversationsForOwner(uid);
        publishOwnerEvent(uid, 'connections-update', scoped);
        return { connections: scoped, claimed: [], syncedChats: [], skippedCooldown: true };
    }

    const inflight = syncInFlightByOwner.get(uid);
    if (inflight && !opts?.force) {
        return inflight;
    }

    const runSync = async (): Promise<{
        connections: WhatsAppConnection[];
        claimed: string[];
        syncedChats: string[];
        skippedCooldown?: boolean;
    }> => {
    await hydrateInstancesFromEvolution();
    const restored = ensureCachedConnectionsInRamForOwner(uid);
    if (restored.length > 0) {
        log('info', `syncConnectionsForOwner: canais restaurados do cache=${restored.join(',')}`);
    }

    const claimed: string[] = [];

    const syncedChats: string[] = [];
    let mappedChats = 0;
    const syncTasks: Array<() => Promise<void>> = [];
    const { getSyncProfileForTenant } = await import('./chipProtectionService.js');
    const ownerSyncProfile = await getSyncProfileForTenant(uid);
    const staggerSync = !ownerSyncProfile.fullInboxSync;

    for (const [id] of connections.entries()) {
        if (!tenantOwnsConnection(uid, id)) continue;
        syncTasks.push(async () => {
                const open = await isConnectionOpen(id);
                if (!open) {
                    log('info', 'syncConnectionsForOwner: canal não aberto, sync ignorado', {
                        connectionId: id,
                        ownerUid: uid,
                        memStatus: connections.get(id)?.status,
                    });
                    return;
                }
                setupWebhook(id).catch((err) => {
                    log('warn', 'setupWebhook falhou em syncConnectionsForOwner', {
                        connectionId: id,
                        error: err?.message,
                    });
                });
                if (isGoWebhookInboxMode()) {
                    syncedChats.push(id);
                    return;
                }
                if (ownerSyncProfile.fullHistory) {
                    await ensureEvolutionFullHistorySync(id);
                }
                const n = await chatStore.syncChatsForConnection(id, {
                    deferEmit: true,
                    sparseLimit: ownerSyncProfile.sparseConvLimit,
                    msgPrefetch: ownerSyncProfile.msgPrefetch,
                    prefetchBatchSize: ownerSyncProfile.prefetchBatchSize,
                    fullInboxSync: ownerSyncProfile.fullInboxSync,
                });
                syncedChats.push(id);
                mappedChats += n;
                if (n === 0) {
                    log('warn', `syncConnectionsForOwner: findChats retornou 0 conversas 1:1`, {
                        connectionId: id,
                        ownerUid: uid,
                    });
                }
        });
    }

    if (syncTasks.length > 0) {
        if (staggerSync) {
            for (let i = 0; i < syncTasks.length; i++) {
                if (i > 0) await sleep(2_500);
                await syncTasks[i]();
            }
        } else {
            await Promise.all(syncTasks.map((fn) => fn()));
        }
    }

    if (isGoWebhookInboxMode()) {
        if (syncedChats.length > 0) {
            await markOwnerFullSyncDone(uid);
        }
    } else if (syncedChats.length === 0 || mappedChats > 0) {
        await markOwnerFullSyncDone(uid);
    } else {
        log('warn', 'syncConnectionsForOwner: findChats vazio com chip aberto — cooldown não marcado', {
            ownerUid: uid,
            syncedChats,
        });
    }

    const { socketConversationsPayload } = await import('./conversationsEmit.js');
    const scoped = filterByConnectionScope(uid, getConnections());
    publishOwnerEvent(uid, 'connections-update', scoped);
    publishOwnerEvent(
        uid,
        'conversations-update',
        await socketConversationsPayload(uid, uid, chatStore.getConversations(), resolveConnectionOwnerUid)
    );

    log('info', `syncConnectionsForOwner: ${scoped.length} canal(is), claimed=${claimed.join(',') || '-'}`);

    return { connections: scoped, claimed, syncedChats };
    };

    const task = runSync();
    syncInFlightByOwner.set(uid, task);
    try {
        return await task;
    } finally {
        if (syncInFlightByOwner.get(uid) === task) {
            syncInFlightByOwner.delete(uid);
        }
    }
}

/** Página da inbox (cursor = lastMessageTimestamp da última linha). */
export async function getInboxPageForOwner(
    ownerUid: string,
    authUid: string,
    opts?: { cursor?: number | null; limit?: number; reset?: boolean }
) {
    const { socketInboxPagePayload } = await import('./conversationsEmit.js');
    return socketInboxPagePayload(
        ownerUid,
        authUid,
        chatStore.getConversations(),
        resolveConnectionOwnerUid,
        opts
    );
}

/** Reemite inbox do RAM para o socket — sem findChats (sync leve ao focar aba / reconectar). */
export async function reemitConversationsForOwner(ownerUid: string): Promise<void> {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') return;
    const { isInboxPaginationEnabled } = await import('./inboxPagination.js');
    const scopedForReemit = filterByConnectionScope(uid, getConnections());
    const hasOpenChip = scopedForReemit.some((c) => String(c.status || '').toUpperCase() === 'CONNECTED');
    if (isInboxPaginationEnabled()) {
        const page = await getInboxPageForOwner(uid, uid, { reset: true });
        if (page.total === 0 && hasOpenChip && !isGoWebhookInboxMode()) {
            log('info', 'reemitConversationsForOwner: RAM vazia com chips abertos — sync completo', {
                ownerUid: uid,
            });
            await syncConnectionsForOwner(uid, { force: true }).catch(() => undefined);
            return;
        }
        /** Pós-deploy: RAM só com webhooks recentes, cooldown Redis ainda ativo no processo antigo. */
        if (hasOpenChip && (await ownerFullSyncIsDue(uid)) && !isGoWebhookInboxMode()) {
            log('info', 'reemitConversationsForOwner: sync completo devido (restart)', {
                ownerUid: uid,
                ramTotal: page.total,
            });
            await syncConnectionsForOwner(uid).catch(() => undefined);
            return;
        }
        publishOwnerEvent(uid, 'inbox-page', page as unknown as Record<string, unknown>);
        return;
    }
    const { socketConversationsPayload } = await import('./conversationsEmit.js');
    publishOwnerEvent(
        uid,
        'conversations-update',
        await socketConversationsPayload(uid, uid, chatStore.getConversations(), resolveConnectionOwnerUid)
    );
}

function resolveInstanceName(raw: unknown): string {
    if (typeof raw === 'string') return raw.trim();
    if (raw && typeof raw === 'object') {
        const row = raw as Record<string, unknown>;
        return String(row.instanceName || row.name || '').trim();
    }
    return '';
}

function parseConnectionStatePayload(data: unknown): string {
    if (!data || typeof data !== 'object') return 'close';
    const row = data as Record<string, unknown>;
    if (row.connected === true) return 'open';
    for (const key of ['state', 'connectionStatus', 'status'] as const) {
        const v = row[key];
        if (typeof v === 'string' && v.trim()) return v;
    }
    const nested = row.instance;
    if (nested && typeof nested === 'object') {
        const inst = nested as Record<string, unknown>;
        if (inst.connected === true) return 'open';
        for (const key of ['state', 'connectionStatus', 'status'] as const) {
            const v = inst[key];
            if (typeof v === 'string' && v.trim()) return v;
        }
    }
    const wrapped = row.data;
    if (wrapped && typeof wrapped === 'object') {
        const inner = wrapped as Record<string, unknown>;
        if (inner.connected === true) return 'open';
        for (const key of ['state', 'status'] as const) {
            const v = inner[key];
            if (typeof v === 'string' && v.trim()) return v;
        }
    }
    return 'close';
}

const connectionStateCache = new Map<string, { state: string; at: number }>();
const CONNECTION_STATE_CACHE_TTL_MS = 15_000;
/** Probe curto em health checks — evita bloquear o event loop por 30s × N canais. */
const CONNECTION_STATE_PROBE_TIMEOUT_MS = 8_000;

function readCachedConnectionState(instanceName: string, maxAgeMs = CONNECTION_STATE_CACHE_TTL_MS): string | null {
    const hit = connectionStateCache.get(instanceName);
    if (!hit) return null;
    if (Date.now() - hit.at > maxAgeMs) return null;
    return hit.state;
}

function writeConnectionStateCache(instanceName: string, state: string) {
    connectionStateCache.set(instanceName, { state: String(state || 'close').toLowerCase(), at: Date.now() });
}

function invalidateConnectionStateCache(instanceName: string) {
    connectionStateCache.delete(instanceName);
}

/** Re-hidrata RAM a partir da Evolution quando o canal aparece online na UI mas sumiu do servidor (ex.: restart). */
export async function refreshConnectionsForCampaign(connectionIds: string[]): Promise<void> {
    const needsHydrate = connectionIds.some((id) => {
        const mem = connections.get(id);
        return !mem || mem.status !== 'open';
    });
    if (!needsHydrate) return;
    await hydrateInstancesFromEvolution();
}

/** Verificação instantânea (RAM) — usada antes de probes lentos na Evolution. */
export function anySelectedConnectionsOpenInMemory(connectionIds: string[]): boolean {
    for (const id of connectionIds) {
        if (connections.get(id)?.status === 'open') return true;
    }
    return false;
}

/** Estado aberto: memória da API + Evolution (evita disparo/pipeline bloqueados por polling atrasado). */
export async function anySelectedConnectionsOpen(connectionIds: string[]): Promise<boolean> {
    if (anySelectedConnectionsOpenInMemory(connectionIds)) return true;
    for (const id of connectionIds) {
        if (await isConnectionOpen(id)) return true;
    }
    return false;
}

const lastConnectionStateCheck = new Map<string, { state: boolean; at: number }>();

async function isConnectionOpen(instanceName: string): Promise<boolean> {
    const now = Date.now();
    const lastCheck = lastConnectionStateCheck.get(instanceName);
    if (lastCheck && now - lastCheck.at < 15000) {
        return lastCheck.state;
    }

    const mem = connections.get(instanceName);
    const apiState = (await getConnectionState(instanceName, { skipCache: true, timeoutMs: CONNECTION_STATE_PROBE_TIMEOUT_MS }))
        .toLowerCase();
    
    const isOpen = isEvolutionOpenState(apiState);
    lastConnectionStateCheck.set(instanceName, { state: isOpen, at: now });

    if (isOpen) {
        if (mem && mem.status !== 'open') {
            applyConnectionStateUpdate(instanceName, 'open', {});
        }
        return true;
    } else {
        if (mem && mem.status === 'open') {
            applyConnectionStateUpdate(instanceName, 'close', {});
        }
        return false;
    }
}

function parseConnectionStateFromData(data: unknown): string {
    return parseConnectionStatePayload(data);
}

/**
 * Extrai o statusReason do webhook CONNECTION_UPDATE.
 * Evolution API v2 envia 401 (unauthorized) ou "loggedOut" quando o número é banido ou removido pelo WhatsApp.
 */
function parseStatusReason(data: unknown): string | number | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const row = data as Record<string, unknown>;
    const direct = row.statusReason;
    if (direct !== undefined) return direct as string | number;
    const nested = row.instance;
    if (nested && typeof nested === 'object') {
        const inst = nested as Record<string, unknown>;
        if (inst.statusReason !== undefined) return inst.statusReason as string | number;
    }
    return undefined;
}

/** Retorna true se o statusReason indica um ban ou logout forçado pelo WhatsApp. */
function isBanStatusReason(reason: string | number | undefined): boolean {
    if (reason === undefined) return false;
    const s = String(reason).toLowerCase().trim();
    // 401 = loggedOut (ban ou desconexão manual pelo WhatsApp)
    // "loggedout" = mesmo, versão string da Evolution API
    // "conflict" NÃO é ban — é múltiplas sessões abertas
    return s === '401' || s === 'loggedout' || s === 'logged_out';
}

/** Registra um evento de ban para o chip. Persiste em settings e emite evento ao tenant. */
function recordChipBan(connectionId: string, reason: string | number | undefined): void {
    const now = Date.now();
    const reasonStr = reason !== undefined ? String(reason) : 'unknown';
    const current = connectionsSettingsCache[connectionId] ?? {};
    const banCount = (current.banCount ?? 0) + 1;
    mergeConnectionSettingsCache(connectionId, {
        banCount,
        lastBannedAt: now,
        lastBanReason: reasonStr,
        // Quarentena de 24h após reconectar
        quarantineUntil: now + 24 * 60 * 60 * 1000,
    });
    saveConnectionsSettings();
    const ownerUid = resolveOwnerUid(connectionId);
    const label = connections.get(connectionId)?.friendlyName || connectionId;
    log('warn', `[BanDetect] Chip BANIDO: ${connectionId} (ban #${banCount}, reason: ${reasonStr})`);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'chip-banned', {
            connectionId,
            connectionLabel: label,
            banCount,
            reason: reasonStr,
        });
    }
}

/**
 * Remove quarentenas incorretas causadas por heurística "rapid_close" (removida).
 * Deve ser chamado na inicialização do servidor para não bloquear chips legítimos.
 */
export function clearFalsePositiveQuarantines(): number {
    let cleared = 0;
    for (const [connId, row] of Object.entries(connectionsSettingsCache)) {
        if (!row?.quarantineUntil || row.quarantineUntil <= Date.now()) continue;
        const reason = (row.lastBanReason || '').toLowerCase();
        const isConfirmedBan = reason === '401' || reason === 'loggedout' || reason === 'logged_out';
        if (!isConfirmedBan) {
            mergeConnectionSettingsCache(connId, { quarantineUntil: undefined });
            cleared++;
        }
    }
    if (cleared > 0) {
        saveConnectionsSettings();
        log('info', `[BanDetect] ${cleared} quarentena(s) de falso-positivo removida(s) na inicialização`);
    }
    return cleared;
}

/** Remove a quarentena de um chip (permite campanhas imediatamente). */
export function releaseConnectionQuarantine(connectionId: string): void {
    mergeConnectionSettingsCache(connectionId, { quarantineUntil: undefined });
    saveConnectionsSettings();
    log('info', `[BanDetect] Quarentena liberada manualmente: ${connectionId}`);
}

/** Zera o histórico de ban de um chip (reseta contador e timestamps). */
export function clearConnectionBanHistory(connectionId: string): void {
    mergeConnectionSettingsCache(connectionId, {
        banCount: 0,
        lastBannedAt: undefined,
        lastBanReason: undefined,
        quarantineUntil: undefined,
    });
    saveConnectionsSettings();
    log('info', `[BanDetect] Histórico de ban zerado: ${connectionId}`);
}

/** Usuário autorizou continuar campanha durante modo silêncio noturno. */
export function approveCampaignSleepModeContinue(campaignId: string, ownerUid: string): boolean {
    const cid = String(campaignId || '').trim();
    if (!cid || !ownerUid) return false;
    const state = campaignsById.get(cid);
    if (state?.ownerUid && state.ownerUid !== ownerUid) return false;
    grantSleepModeOverride(cid);
    log('info', `[SleepMode] Campanha ${cid} autorizada a continuar durante a noite`);
    return true;
}

/** Retorna info de ban/quarentena de um chip (de settings persistidos). */
export function getConnectionBanInfo(connectionId: string): {
    banCount: number;
    lastBannedAt?: number;
    lastBanReason?: string;
    quarantineUntil?: number;
    inQuarantine: boolean;
} {
    const row = connectionsSettingsCache[connectionId] ?? {};
    const banCount = row.banCount ?? 0;
    const quarantineUntil = row.quarantineUntil;
    return {
        banCount,
        lastBannedAt: row.lastBannedAt,
        lastBanReason: row.lastBanReason,
        quarantineUntil,
        inQuarantine: Boolean(quarantineUntil && quarantineUntil > Date.now()),
    };
}

function emitScopedConversationsUpdate() {
    void (async () => {
        const { socketConversationsPayload } = await import('./conversationsEmit.js');
        const all = chatStore.getConversations();
        const owners = new Set<string>();
        for (const c of all) {
            const ou = resolveOwnerUid(c.connectionId);
            if (ou) owners.add(ou);
        }
        for (const [id, conn] of connections.entries()) {
            if (conn.status !== 'open' && conn.status !== 'connecting') continue;
            const ou = resolveOwnerUid(id);
            if (ou) owners.add(ou);
        }
        for (const uid of owners) {
            publishOwnerEvent(
                uid,
                'conversations-update',
                await socketConversationsPayload(uid, uid, all, resolveConnectionOwnerUid)
            );
        }
        // Antes: io.emit broadcast de TODA a inbox quando nenhum owner
        // resolvia, vazando conversas entre tenants. Agora apenas loga e
        // deixa o cliente esperar por canais com ownerUid resolvido.
        if (owners.size === 0) {
            log('warn', 'conversations-update sem ownerUid resolvido - evento descartado', {
                total: all.length,
            });
        }
    })();
}

/** Cache de circuit breaker por chip (atualizado no health reconcile). */
const circuitStateByConnection = new Map<
    string,
    import('./chipCircuitBreaker.js').CircuitState
>();
const qrWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const connectionWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Evita tratar close transitório do Baileys durante pairing como desconexão real. */
const pairingStartedAt = new Map<string, number>();
const autoReconnectState = new Map<
    string,
    {
        attempts: number;
        timer?: ReturnType<typeof setTimeout>;
        inFlight?: boolean;
        /** Após esgotar tentativas rápidas, continua reconectando a cada ~30 min. */
        longTail?: boolean;
        exhaustedNotified?: boolean;
    }
>();
/** Intervalo de reconexão lenta após esgotar tentativas rápidas (evita chip offline por horas). */
const LONG_TAIL_RECONNECT_MS = 30 * 60 * 1000;
let connectionHealthTimer: ReturnType<typeof setInterval> | null = null;
/** Dedupe de sync pesado concorrente por tenant. */
const syncInFlightByOwner = new Map<
    string,
    Promise<{
        connections: WhatsAppConnection[];
        claimed: string[];
        syncedChats: string[];
        skippedCooldown?: boolean;
    }>
>();

function clearAutoReconnect(connectionId: string) {
    const st = autoReconnectState.get(connectionId);
    if (st?.timer) clearTimeout(st.timer);
    autoReconnectState.delete(connectionId);
}

function scheduleEvolutionAutoReconnect(connectionId: string, options?: { immediate?: boolean }) {
    if (!connectionId || !connections.has(connectionId)) return;
    const conn = connections.get(connectionId);
    if (!conn || conn.status === 'open') return;
    if (connectionWatchTimers.has(connectionId) || qrWatchTimers.has(connectionId)) return;

    const ownerUid = resolveOwnerUid(connectionId);
    const prev = autoReconnectState.get(connectionId) ?? { attempts: 0 };
    if (prev.inFlight) return;

    void (async () => {
        const { getReconnectLimitsForOwner } = await import('./chipProtectionService.js');
        const limits = ownerUid
            ? await getReconnectLimitsForOwner(ownerUid)
            : { maxAttempts: 6, baseDelayMs: 5_000, maxDelayMs: 120_000 };

        const st0 = autoReconnectState.get(connectionId) ?? { attempts: 0 };
        const inLongTail = Boolean(st0.longTail);

        if (st0.attempts >= limits.maxAttempts && !inLongTail) {
            log('warn', `Auto-reconnect esgotado para ${connectionId} — entrando em modo lento (~30 min)`);
            if (!st0.exhaustedNotified && ownerUid) {
                st0.exhaustedNotified = true;
                const label = connections.get(connectionId)?.friendlyName || connectionId;
                void emitAntiBanAlert(ownerUid, 'chip-reconnect-exhausted', {
                    connectionId,
                    connectionLabel: label,
                });
            }
            st0.longTail = true;
            st0.attempts = 0;
            if (st0.timer) clearTimeout(st0.timer);
            const longTimer = setTimeout(() => {
                scheduleEvolutionAutoReconnect(connectionId, { immediate: true });
            }, LONG_TAIL_RECONNECT_MS);
            autoReconnectState.set(connectionId, { ...st0, timer: longTimer, inFlight: false });
            emitConnectionInitFailure(
                connectionId,
                'Canal desconectou várias vezes. Reconexão automática continua a cada ~30 min — ou use "Conectar" manualmente.'
            );
            return;
        }

        const attempt = st0.attempts + 1;
        let delayMs = inLongTail
            ? options?.immediate
                ? 0
                : LONG_TAIL_RECONNECT_MS
            : options?.immediate
              ? 0
              : Math.min(limits.maxDelayMs, limits.baseDelayMs * Math.pow(2, st0.attempts));
        if (isInDeployGraceWindow() && !options?.immediate) {
            delayMs = Math.max(delayMs, 60_000);
        }
        if (st0.timer) clearTimeout(st0.timer);

        const timer = setTimeout(() => {
        runEvolutionReconnectExclusive(async () => {
            const st = autoReconnectState.get(connectionId);
            if (!st || st.inFlight) return;
            st.inFlight = true;
            autoReconnectState.set(connectionId, st);
            log('info', `Auto-reconnect Evolution: ${connectionId} (tentativa ${attempt}${st.longTail ? ', lento' : ''})`);
            try {
                try {
                    await api.post(`/instance/restart/${evoInst(connectionId)}`, {});
                    await sleep(3000);
                } catch {
                    await api.post(`/instance/connect/${evoInst(connectionId)}`, {});
                    await sleep(2000);
                }
                const state = (await getConnectionState(connectionId)).toLowerCase();
                if (isEvolutionOpenState(state)) {
                    clearAutoReconnect(connectionId);
                    applyConnectionStateUpdate(connectionId, 'open', {});
                    return;
                }
                if (state === 'connecting' || state === 'created') {
                    applyConnectionStateUpdate(connectionId, state, {});
                    watchConnectionUntilOpen(connectionId);
                    const paired = Boolean(connections.get(connectionId)?.phoneNumber?.trim());
                    if (!paired) {
                        const extracted = await fetchConnectQr(connectionId);
                        if (extracted) emitQrToFrontend(connectionId, extracted);
                    }
                    clearAutoReconnect(connectionId);
                    return;
                }
                st.attempts = attempt;
                st.inFlight = false;
                autoReconnectState.set(connectionId, st);
                scheduleEvolutionAutoReconnect(connectionId);
            } catch (error: any) {
                log('warn', `Auto-reconnect falhou: ${connectionId}`, { error: error?.message });
                const st2 = autoReconnectState.get(connectionId);
                if (st2) {
                    st2.attempts = attempt;
                    st2.inFlight = false;
                    autoReconnectState.set(connectionId, st2);
                    scheduleEvolutionAutoReconnect(connectionId);
                }
            }
        });
        }, delayMs);

        autoReconnectState.set(connectionId, { ...st0, attempts: st0.attempts, timer, inFlight: false });
    })();
}

function stopQrWatch(connectionId: string) {
    const timer = qrWatchTimers.get(connectionId);
    if (timer) {
        clearTimeout(timer);
        qrWatchTimers.delete(connectionId);
    }
}

function emitConnectionInitFailure(connectionId: string, message: string) {
    const ownerUid = resolveOwnerUid(connectionId);
    const payload = { connectionId, message };
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'connection-init-failure', payload);
    } else {
        warnUnscopedConnectionEvent(connectionId, 'connection-init-failure');
    }
}

/** Polling até o QR chegar (create/connect/webhook) ou timeout — evita modal preso em "Aguardar QR". */
function ensureQrDelivered(connectionId: string, maxAttempts = 45, delayMs = 2000) {
    stopQrWatch(connectionId);
    let attempts = 0;

    const tick = async () => {
        if (!connections.has(connectionId)) {
            stopQrWatch(connectionId);
            return;
        }
        const conn = connections.get(connectionId);
        if (conn?.status === 'open') {
            stopQrWatch(connectionId);
            return;
        }
        if (conn?.qrCode?.trim()) {
            const kind: 'code' | 'image' = conn.qrCode.startsWith('data:image/') ? 'image' : 'code';
            emitQrToFrontend(connectionId, { displayValue: conn.qrCode.trim(), kind });
            stopQrWatch(connectionId);
            return;
        }

        attempts++;
        let extracted = await fetchConnectQr(connectionId);
        if (extracted) {
            emitQrToFrontend(connectionId, extracted);
            stopQrWatch(connectionId);
            return;
        }

        if (attempts >= maxAttempts) {
            stopQrWatch(connectionId);
            emitConnectionProgress(connectionId, 'failed');
            emitConnectionInitFailure(
                connectionId,
                'QR não foi gerado a tempo. Confirme Evolution API ativa, webhook e CONFIG_SESSION_PHONE_VERSION (sem sufixo -alpha). Tente "Gerar QR" de novo.'
            );
            log('error', `Timeout aguardando QR: ${connectionId}`);
            void deleteConnection(connectionId, {
                reason: 'qr_delivery_timeout',
                caller: 'ensureQrDelivered',
            }).catch(() => undefined);
            return;
        }

        qrWatchTimers.set(connectionId, setTimeout(() => void tick(), delayMs));
    };

    void tick();
}

function stopWatchingConnection(connectionId: string) {
    const timer = connectionWatchTimers.get(connectionId);
    if (timer) {
        clearTimeout(timer);
        connectionWatchTimers.delete(connectionId);
    }
}

function applyConnectionStateUpdate(
    instance: string,
    rawState: string,
    data?: Record<string, unknown>
) {
    if (!instance) return;
    const state = String(rawState || '').toLowerCase();
    if (!state) return;
    const open = isEvolutionOpenState(state);

    const connBefore = connections.get(instance);
    const prevStatus = connBefore?.status;
    const reconnecting =
        open &&
        prevStatus !== 'open' &&
        (prevStatus === 'close' || Boolean(connectionsSettingsCache[instance]?.lastClosedAt));

    // Close durante pairing (Evolution/Baileys) — ignorar só nos primeiros ~45s; depois tratar como queda real.
    if (state === 'close' && (prevStatus === 'connecting' || prevStatus === 'created')) {
        const started = pairingStartedAt.get(instance);
        const pairingAge = started ? Date.now() - started : 120_000;
        if (pairingAge < 45_000) {
            log('info', `Close transitório ignorado (pairing): ${instance}`);
            return;
        }
        log('warn', `Pairing preso (${Math.round(pairingAge / 1000)}s) — aplicando close: ${instance}`);
    }

    if (prevStatus !== mapEvolutionState(state)) {
        invalidateConnectionStateCache(instance);
    }
    writeConnectionStateCache(instance, state);

    const status =
        open ? 'ONLINE' : state === 'connecting' ? 'CONNECTING' : 'OFFLINE';

    const conn = connections.get(instance);
    if (conn) {
        conn.status = mapEvolutionState(state);
        if (open) {
            stopQrWatch(instance);
            pairingStartedAt.delete(instance);
            clearAutoReconnect(instance);
            conn.qrCode = undefined;
            // Uptime: marca o momento do open; não zera em webhook "open" repetido.
            if (prevStatus !== 'open' || !conn.lastOpenAt) {
                conn.lastOpenAt = Date.now();
                mergeConnectionSettingsCache(instance, { connectedSince: conn.lastOpenAt });
            }
            const phone = phoneFromWebhookData(data);
            if (phone) conn.phoneNumber = phone;
            // Ao reconectar com sucesso, libera quarentenas causadas por razões não-confirmadas
            // (rapid_close, unknown) para evitar bloqueio indevido de campanhas.
            const banRow = connectionsSettingsCache[instance];
            if (banRow?.quarantineUntil && banRow.quarantineUntil > Date.now()) {
                const reason = (banRow.lastBanReason || '').toLowerCase();
                const isConfirmedBan = reason === '401' || reason === 'loggedout' || reason === 'logged_out';
                if (!isConfirmedBan) {
                    mergeConnectionSettingsCache(instance, { quarantineUntil: undefined });
                    log('info', `[BanDetect] Quarentena liberada ao reconectar (razão não confirmada: ${reason}): ${instance}`);
                }
            }
        } else if (state === 'connecting' || state === 'created') {
            if (!pairingStartedAt.has(instance)) {
                pairingStartedAt.set(instance, Date.now());
            }
        } else if (state === 'close') {
            stopQrWatch(instance);
            stopWatchingConnection(instance);
            pairingStartedAt.delete(instance);
            conn.lastOpenAt = undefined;
            mergeConnectionSettingsCache(instance, {
                connectedSince: undefined,
                lastClosedAt: Date.now(),
            });

            // Detecção de ban: SOMENTE via statusReason 401/"loggedOut" do WhatsApp.
            // Heurística de "rapid_close" foi removida — causava falsos positivos em
            // reconexões legítimas (deploy, queda de rede, restart do Evolution API).
            const statusReason = parseStatusReason(data);
            if (isBanStatusReason(statusReason)) {
                recordChipBan(instance, statusReason);
                log('warn', `[BanDetect] ${instance}: ban detectado via statusReason=${statusReason}`);
                void import('./chipProtectionService.js').then((m) =>
                    m.onConnectionClosed(instance, true)
                );
                void reviewRunningCampaignsForChipProtection(instance);
            } else {
                void import('./chipProtectionService.js').then((m) =>
                    m.onConnectionClosed(instance, false)
                );
            }
        }
        connections.set(instance, conn);
        healConnectionOwnerFromSettings(instance);
        const resolvedOwner = resolveOwnerUid(instance);
        if (open || conn.phoneNumber?.trim() || resolvedOwner) {
            mergeConnectionSettingsCache(instance, {
                ownerUid: resolvedOwner ?? conn.ownerUid,
                createdByUid:
                    connectionsSettingsCache[instance]?.createdByUid ??
                    resolvedOwner ??
                    conn.ownerUid,
                friendlyName: conn.friendlyName,
            });
            saveConnectionsSettings();
        }
    }

    const connAfter = connections.get(instance);
    const updatePayload = {
        id: instance,
        status,
        profilePicUrl: data?.profilePicUrl ?? connAfter?.profilePicUrl,
        profileName: data?.profileName ?? connAfter?.profileName,
        phoneNumber: connAfter?.phoneNumber ?? null,
    };
    const ownerUid = resolveOwnerUid(instance);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'connection-update', updatePayload);
        if (prevStatus === 'open' && !open && status === 'OFFLINE') {
            void notifyTenant(
                ownerUid,
                'chip_offline',
                {
                    connectionId: instance,
                    connectionLabel: connAfter?.friendlyName || instance,
                },
                'chip_offline'
            );
        }
        publishOwnerEvent(ownerUid, 'connections-update', filterByConnectionScope(ownerUid, getConnections()));
    } else {
        warnUnscopedConnectionEvent(instance, 'connection-update');
    }

    log('info', `Status atualizado: ${instance} → ${status}`);

    // Webhook CONNECTION_UPDATE às vezes não chega após o scan do QR — polling até `open`.
    if (state === 'connecting') {
        watchConnectionUntilOpen(instance);
    }

    if (state === 'close') {
        const paired = Boolean(connAfter?.phoneNumber?.trim());
        if (prevStatus === 'open' || paired) {
            scheduleEvolutionAutoReconnect(instance);
        }
    }

    if (open) {
        stopWatchingConnection(instance);
        void enrichConnectionMeta(instance).then(() => {
            const ou = resolveOwnerUid(instance);
            if (ou) {
                publishOwnerEvent(
                    ou,
                    'connections-update',
                    filterByConnectionScope(ou, getConnections())
                );
            }
            emitConnectionOpenToFrontend(instance);
        });
        void (async () => {
            await enrichConnectionMeta(instance);
            const ou = resolveOwnerUid(instance);
            const { getSyncProfileForTenant } = await import('./chipProtectionService.js');
            const syncProfile = ou
                ? await getSyncProfileForTenant(ou)
                : {
                      fullHistory: true,
                      fullInboxSync: true,
                      msgPrefetch: 200,
                      sparseConvLimit: 120,
                      prefetchBatchSize: 8,
                  };
            const postDeployGrace = isInDeployGraceWindow();
            if (syncProfile.fullHistory && !postDeployGrace) {
                await ensureEvolutionFullHistorySync(instance);
            }
            if (!isGoWebhookInboxMode()) {
                if (!postDeployGrace) {
                    await chatStore.syncChatsForConnection(instance, {
                        sparseLimit: syncProfile.sparseConvLimit,
                        msgPrefetch: syncProfile.msgPrefetch,
                        prefetchBatchSize: syncProfile.prefetchBatchSize,
                        fullInboxSync: syncProfile.fullInboxSync,
                    });
                }
            } else {
                await setupWebhook(instance).catch(() => undefined);
            }
            if (ou) {
                publishOwnerEvent(
                    ou,
                    'connections-update',
                    filterByConnectionScope(ou, getConnections())
                );
                const { socketConversationsPayload } = await import('./conversationsEmit.js');
                publishOwnerEvent(
                    ou,
                    'conversations-update',
                    await socketConversationsPayload(ou, ou, chatStore.getConversations(), resolveConnectionOwnerUid)
                );
            }
            if (reconnecting) {
                void recoverStuckReplyFlowSessions().then((recovered) => {
                    if (recovered > 0) {
                        log('info', `[ReplyFlow] ${recovered} sessão(ões) retomada(s) após reconexão`, {
                            connectionId: instance,
                            recovered,
                        });
                    }
                });
                void import('./inboundMissedReplay.js').then(({ replayMissedInboundForConnection }) =>
                    replayMissedInboundForConnection(instance, ou, {
                        getConversations: () => chatStore.getConversations(),
                        loadChatHistory: (conversationId, limit) =>
                            chatStore.loadChatHistory(conversationId, limit, true),
                        getLastClosedAt: (id) => connectionsSettingsCache[id]?.lastClosedAt,
                        processInbound: processInboundAutomationMessage,
                        log: (message, payload) => log('info', message, payload),
                    }).then(() => syncHotLeadsAfterInboundReplay(ou, instance))
                );
            }
        })();
    }
}

/** Fallback quando webhook CONNECTION_UPDATE não chega (comum em Swarm/Evolution v2). */
function watchConnectionUntilOpen(connectionId: string) {
    if (!connectionId || connectionWatchTimers.has(connectionId)) return;
    const existing = connections.get(connectionId);
    if (existing?.status === 'open') return;

    let attempts = 0;
    const maxAttempts = 90;

    const poll = async () => {
        if (!connections.has(connectionId)) {
            stopWatchingConnection(connectionId);
            return;
        }
        attempts++;
        invalidateConnectionStateCache(connectionId);
        const state = (await getConnectionState(connectionId, { skipCache: true })).toLowerCase();
        if (isEvolutionOpenState(state)) {
            applyConnectionStateUpdate(connectionId, state, {});
            return;
        }
        if (state === 'close' && attempts >= 4) {
            const conn = connections.get(connectionId);
            if (conn?.phoneNumber?.trim()) {
                stopWatchingConnection(connectionId);
                clearAutoReconnect(connectionId);
                scheduleEvolutionAutoReconnect(connectionId, { immediate: true });
                return;
            }
        }
        if (attempts >= maxAttempts) {
            stopWatchingConnection(connectionId);
            log('warn', `Timeout aguardando conexão abrir: ${connectionId}`);
            const conn = connections.get(connectionId);
            if (conn?.phoneNumber?.trim()) {
                clearAutoReconnect(connectionId);
                scheduleEvolutionAutoReconnect(connectionId, { immediate: true });
            } else {
                emitConnectionInitFailure(
                    connectionId,
                    'Conexão não abriu a tempo. Verifique Evolution API e webhook; use "Forçar QR" se necessário.'
                );
            }
            return;
        }
        connectionWatchTimers.set(connectionId, setTimeout(() => void poll(), 2000));
    };

    connectionWatchTimers.set(connectionId, setTimeout(() => void poll(), 2000));
}

function emitQrToFrontend(connectionId: string, extracted: ExtractedEvolutionQr) {
    stopQrWatch(connectionId);
    const conn = connections.get(connectionId);
    if (conn) {
        conn.qrCode = extracted.displayValue;
        conn.status = conn.status === 'open' ? 'open' : 'connecting';
        connections.set(connectionId, conn);
    }
    emitConnectionProgress(connectionId, 'awaiting-scan');
    const payload = { connectionId, qrCode: extracted.displayValue };
    const ownerUid = resolveOwnerUid(connectionId);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'qr-code', payload);
        publishOwnerEvent(ownerUid, 'connections-update', filterByConnectionScope(ownerUid, getConnections()));
        if (io) {
            io.to(`user:${ownerUid}`).emit('qr-code', payload);
            io.to(`user:${ownerUid}`).emit(
                'connections-update',
                filterByConnectionScope(ownerUid, getConnections())
            );
        }
    } else {
        warnUnscopedConnectionEvent(connectionId, 'qr-code');
    }
    watchConnectionUntilOpen(connectionId);
}

const countZeroRecoveryAttempts = new Map<string, number>();

/** Instâncias criadas antes do CONFIG_SESSION correto ficam com connect count:0 até logout/restart. */
async function tryRecoverCountZeroInstance(instanceName: string): Promise<boolean> {
    const attempts = countZeroRecoveryAttempts.get(instanceName) ?? 0;
    if (attempts >= 2) return false;
    countZeroRecoveryAttempts.set(instanceName, attempts + 1);
    log('info', `count:0 — recuperar sessão Evolution: ${instanceName} (tentativa ${attempts + 1})`);

    try {
        await api.post(`/instance/restart/${evoInst(instanceName)}`, {});
        await sleep(4000);
        return true;
    } catch {
        /* restart pode não existir em todas as builds */
    }

    try {
        await api.delete(`/instance/logout/${evoInst(instanceName)}`);
        await sleep(1500);
        await api.post(`/instance/connect/${evoInst(instanceName)}`, {});
        await sleep(2000);
        return true;
    } catch (error: any) {
        log('warn', `Recuperação count:0 falhou para ${instanceName}`, { error: error?.message });
        return false;
    }
}

async function fetchConnectQr(instanceName: string): Promise<ExtractedEvolutionQr | null> {
    if (isEvolutionGoEngine()) {
        try {
            await assertEvolutionGoLicensed('gerar QR');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : evolutionGoLicenseUserMessage(e);
            emitConnectionProgress(instanceName, 'failed');
            const ownerUid = resolveOwnerUid(instanceName);
            if (ownerUid) {
                publishOwnerEvent(ownerUid, 'socket-operation-error', { op: 'force-qr', error: msg });
            }
            log('warn', `fetchConnectQr bloqueado — licença Go inativa: ${instanceName}`, { msg });
            return null;
        }
    }

    const tryParse = (data: unknown, via: string): { extracted: ExtractedEvolutionQr | null; countZero: boolean } => {
        const extracted = extractQrFromApiResponse(data);
        if (extracted) return { extracted, countZero: false };
        let countZero = false;
        if (data && typeof data === 'object') {
            const row = data as Record<string, unknown>;
            const count = row.count;
            if (count === 0 || count === '0') {
                countZero = true;
                log('warn', `connect/${instanceName} retornou count:0 (${via}) — ver CONFIG_SESSION_PHONE_VERSION na Evolution`);
            }
        }
        return { extracted: null, countZero };
    };

    const runConnectPass = async (): Promise<ExtractedEvolutionQr | null> => {
        const mem = connections.get(instanceName);
        if (mem?.status === 'open') return null;
        const live = (await getConnectionState(instanceName)).toLowerCase();
        if (isEvolutionOpenState(live)) {
            applyConnectionStateUpdate(instanceName, 'open', {});
            return null;
        }

        if (isEvolutionGoEngine()) {
            await ensureEvolutionGoInstanceExists(instanceName);
        }

        let sawCountZero = false;

        try {
            const getResp = await api.get(`/instance/connect/${evoInst(instanceName)}`);
            const parsed = tryParse(getResp.data, 'GET');
            if (parsed.extracted) return parsed.extracted;
            if (parsed.countZero) sawCountZero = true;
        } catch (error: any) {
            if (isEvolutionGoLicenseError(error)) {
                const msg = evolutionGoLicenseUserMessage(error);
                emitConnectionProgress(instanceName, 'failed');
                const ownerUid = resolveOwnerUid(instanceName);
                if (ownerUid) {
                    publishOwnerEvent(ownerUid, 'socket-operation-error', { op: 'force-qr', error: msg });
                }
                log('warn', `connect/${instanceName} — licença Go inativa`, { msg });
                return null;
            }
            log('warn', `GET connect/${instanceName} falhou`, {
                error: error?.message,
                status: error?.response?.status,
            });
        }

        try {
            const postResp = await api.post(`/instance/connect/${evoInst(instanceName)}`, {});
            const parsed = tryParse(postResp.data, 'POST');
            if (parsed.extracted) return parsed.extracted;
            if (parsed.countZero) sawCountZero = true;
        } catch (error: any) {
            if (isEvolutionGoLicenseError(error)) {
                const msg = evolutionGoLicenseUserMessage(error);
                emitConnectionProgress(instanceName, 'failed');
                const ownerUid = resolveOwnerUid(instanceName);
                if (ownerUid) {
                    publishOwnerEvent(ownerUid, 'socket-operation-error', { op: 'force-qr', error: msg });
                }
                return null;
            }
            log('warn', `POST connect/${instanceName} falhou`, {
                error: error?.message,
                status: error?.response?.status,
            });
        }

        if (sawCountZero && (await tryRecoverCountZeroInstance(instanceName))) {
            try {
                const retry = await api.get(`/instance/connect/${evoInst(instanceName)}`);
                const parsed = tryParse(retry.data, 'GET-retry');
                if (parsed.extracted) return parsed.extracted;
            } catch {
                /* ok */
            }
        }

        return null;
    };

    return runConnectPass();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Aguarda QR na Evolution (create/connect) antes de devolver ao cliente. */
async function waitForQrFirst(connectionId: string, maxWaitMs = 28_000): Promise<ExtractedEvolutionQr | null> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        const conn = connections.get(connectionId);
        if (conn?.qrCode?.trim()) {
            const v = conn.qrCode.trim();
            return { displayValue: v, kind: v.startsWith('data:image/') ? 'image' : 'code' };
        }
        const extracted = await fetchConnectQr(connectionId);
        if (extracted) return extracted;
        await sleep(2000);
    }
    return null;
}

/** Busca QR na Evolution e reenvia ao painel (HTTP + socket). */
export async function refreshConnectionQr(connectionId: string): Promise<string | null> {
    const id = String(connectionId || '').trim();
    if (!id) return null;
    if (!connections.has(id)) {
        await hydrateInstancesFromEvolution();
    }
    if (!connections.has(id)) return null;

    const liveState = (await getConnectionState(id)).toLowerCase();
    if (isEvolutionOpenState(liveState)) {
        applyConnectionStateUpdate(id, 'open', {});
        return null;
    }

    let extracted = await fetchConnectQr(id);
    if (!extracted) {
        extracted = await pollConnectQr(id, 8, 2000);
    }
    if (extracted) {
        emitQrToFrontend(id, extracted);
        return extracted.displayValue;
    }
    const conn = connections.get(id);
    const cached = conn?.qrCode?.trim();
    if (cached) {
        emitQrToFrontend(id, {
            displayValue: cached,
            kind: cached.startsWith('data:image/') ? 'image' : 'code',
        });
        return cached;
    }
    return null;
}

async function pollConnectQr(
    instanceName: string,
    attempts = 6,
    delayMs = 2000
): Promise<ExtractedEvolutionQr | null> {
    for (let i = 0; i < attempts; i++) {
        const extracted = await fetchConnectQr(instanceName);
        if (extracted) return extracted;
        if (i < attempts - 1) await sleep(delayMs);
    }
    return null;
}

async function hydrateInstancesFromEvolution() {
    try {
        const response = await api.get('/instance/fetchInstances');
        const raw = response.data;
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.instances) ? raw.instances : [];
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Record<string, unknown>;
            const instanceName = String(
                row.name || row.instanceName || (row.instance as Record<string, unknown> | undefined)?.instanceName || ''
            ).trim();
            if (!instanceName) continue;

            const existing = connections.get(instanceName);
            // Shard Evolution compartilhado: não hidratar instâncias de outros clientes
            // que não constam no settings local deste container.
            // IMPORTANTE: o guard precisa vir ANTES de syncGoInstanceCredentials para não
            // recriar entradas no cache de conexões deletadas (causa de "conexões fantasmas").
            if (!connectionsSettingsCache[instanceName] && !existing) {
                continue;
            }
            // Só sincroniza credenciais se a instância já pertence a este container.
            syncGoInstanceCredentials(instanceName, row);

            const prevStatus = existing?.status;
            let mappedState = mapEvolutionState(row.connectionStatus ?? row.state ?? row.status);
            if (existing?.status === 'open' && mappedState !== 'open') {
                const verified = (
                    await getConnectionState(instanceName, { timeoutMs: CONNECTION_STATE_PROBE_TIMEOUT_MS })
                ).toLowerCase();
                if (isEvolutionOpenState(verified)) mappedState = 'open';
            }
            const phoneFromApi = phoneFromEvolutionRow(row);
            healConnectionOwnerFromSettings(instanceName);
            const cachedRow = connectionsSettingsCache[instanceName];
            const instanceObj: EvolutionInstance = {
                instanceName,
                friendlyName: existing?.friendlyName || cachedRow?.friendlyName || String(row.profileName || instanceName),
                status: mappedState,
                ownerUid: pickNonEmptyUid(
                    existing?.ownerUid,
                    cachedRow?.ownerUid,
                    cachedRow?.createdByUid,
                    ownerUidFromConnectionId(instanceName)
                ),
                profilePicUrl: typeof row.profilePicUrl === 'string' ? row.profilePicUrl : existing?.profilePicUrl,
                profileName: typeof row.profileName === 'string' ? row.profileName : existing?.profileName,
                phoneNumber: phoneFromApi || existing?.phoneNumber,
                qrCode: existing?.qrCode,
                proxy: existing?.proxy,
                lastOpenAt: existing?.lastOpenAt ?? cachedRow?.connectedSince,
            };
            applySettingsToInstance(instanceObj);
            if (mappedState === 'open' && !instanceObj.lastOpenAt) {
                instanceObj.lastOpenAt = Date.now();
                mergeConnectionSettingsCache(instanceName, { connectedSince: instanceObj.lastOpenAt });
            }
            healConnectionFriendlyName(instanceName);

            if (existing && mappedState !== prevStatus) {
                applyConnectionStateUpdate(
                    instanceName,
                    mappedState,
                    row as Record<string, unknown>
                );
            } else {
                connections.set(instanceName, instanceObj);
                if (!existing && (mappedState === 'open' || mappedState === 'connecting')) {
                    applyConnectionStateUpdate(
                        instanceName,
                        mappedState,
                        row as Record<string, unknown>
                    );
                }
            }
        }
        if (list.length > 0) {
            const ownersNotified = new Set<string>();
            for (const [id] of connections) {
                const ou = resolveOwnerUid(id);
                if (!ou || ownersNotified.has(ou)) continue;
                ownersNotified.add(ou);
                publishOwnerEvent(ou, 'connections-update', filterByConnectionScope(ou, getConnections()));
            }
        }
        for (const [id, conn] of connections.entries()) {
            if (conn.status === 'connecting') {
                watchConnectionUntilOpen(id);
            }
        }
        // Reaplica setupWebhook em instancias hidratadas (open/connecting):
        // sem isso, depois de restart do container, a Evolution continua
        // apontada para um webhook antigo/invalido e o pipeline fica vazio.
        for (const [id, conn] of connections.entries()) {
            if (conn.status === 'open' || conn.status === 'connecting') {
                setupWebhook(id).catch((err) => {
                    log('warn', 'Re-setupWebhook falhou em hydrate', {
                        instance: id,
                        error: err?.message,
                    });
                });
            }
        }
        for (const [id, conn] of connections.entries()) {
            if (conn.status === 'open' && conn.phoneNumber && !conn.profilePicUrl?.trim()) {
                void enrichConnectionMeta(id);
            }
        }
        log('info', `Instâncias Evolution sincronizadas: ${list.length}`);
    } catch (error: any) {
        log('warn', 'Falha ao sincronizar instâncias Evolution', { error: error?.message });
    }
}

interface CampaignMediaPayload {
    base64?: string;
    url?: string;
    mimeType: string;
    fileName: string;
    caption?: string;
    sendMediaAsDocument?: boolean;
}

interface MessageQueueItem {
    connectionId: string;
    to: string;
    message: string;
    campaignId?: string;
    /** dono do tenant — persistido no job para restaurar campaignsById após restart */
    ownerUid?: string;
    /** Índice da etapa (0-based) dentro de messageStages — usado no jobId para evitar colisão. */
    stageIndex?: number;
    /** Índice de rotação para SpinTrax — garante variação por mensagem */
    rotationIndex?: number;
    media?: CampaignMediaPayload;
    sendAsMedia?: boolean;
    /** Chave em `campaignMediaById` (follow-up pode usar `id:reply-step:1`). */
    mediaLookupKey?: string;
    replyFlowOpen?: {
        campaignId: string;
        phoneDigits: string;
        vars: Record<string, string>;
        ownerUid?: string;
    };
    replyFlowAfterSend?: {
        phoneDigits: string;
        newAwaitingAfterStep: number;
    };
    /** Resposta terminal de menu — encerra sessão após envio OK. */
    replyFlowDisposeAfterSend?: boolean;
    /** Resposta automática do fluxo por etapas (menu, fallback, follow-up). */
    replyFlowResponse?: boolean;
    /**
     * Pool de chips alternativos para failover silencioso.
     * Quando o chip principal falha/fica offline, o motor tenta os chips nesta lista
     * em ordem circular antes de lançar erro definitivo.
     */
    alternateChannelIds?: string[];
    /** Idempotência: definido após envio bem-sucedido para evitar reenvio em retry do BullMQ. */
    _sentOk?: boolean;
    /** Evita contabilizar processed/success duas vezes se o job for reprocessado após falha tardia. */
    _progressAccounted?: boolean;
    /** Conta quantas vezes o job foi adiado por limite diário — falha definitiva após 3 dias. */
    _limitDelayCount?: number;
    /** Adiado porque o grupo de chips estava offline. */
    _offlineDelayCount?: number;
    /** Trust score: tier delay já aplicado neste job. */
    _tierDelayApplied?: boolean;
    /** Penalidades por content hash lock repetido. */
    _contentHashStrike?: number;
    /** Motor multi-etapas lazy: identifica contactId e stepIndex desta entrega. */
    multiStepContact?: {
        contactId: string;
        stepIndex: number;
    };
    /** Reenvio manual: ignora limite de 24 h entre campanhas. */
    skipFrequencyCap?: boolean;
    /** Jornada de nutrição (lead quente) — não consome cota diária de campanha. */
    nurtureFollowUp?: boolean;
    nurtureEnrollmentId?: string;
    nurtureJourneyId?: string;
    nurtureStepIndex?: number;
}

interface WarmupItem {
    to: string;
    connectionId: string;
    message: string;
    campaignId?: string;
    createdAt: string;
    reason: string;
}

// ================== ESTADO GLOBAL ==================

function getRedisUrl(): string | null {
    return getEffectiveRedisUrl();
}

let redisConnection: IORedis | null = null;
let redisConnectionUrl: string | null = null;
let campaignQueue: Queue<MessageQueueItem> | null = null;

function getRedisConnection(): IORedis | null {
    const url = getRedisUrl();
    if (!url) return null;

    if (redisConnection && redisConnectionUrl && redisConnectionUrl !== url) {
        console.warn('[campaign-queue] REDIS_URL alterada — recriando conexão…', {
            from: redisConnectionUrl,
            to: url,
        });
        resetCampaignRedisConnection();
    }

    // Se a conexão anterior morreu permanentemente, recria tudo do zero.
    // IORedis status 'end'/'close' — conexão fechada (ex.: após restart do Redis na VPS).
    if (redisConnection && (redisConnection.status === 'end' || redisConnection.status === 'close')) {
        console.warn('[campaign-queue] Conexão Redis fechada — recriando…');
        try {
            redisConnection.disconnect();
        } catch {
            /* ignore */
        }
        redisConnection = null;
        campaignQueue = null;
        // Worker também precisa ser recriado (ele tem um duplicate da conexão morta).
        if (campaignWorker) {
            campaignWorker.close().catch(() => {});
            campaignWorker = null;
        }
    }

    if (!redisConnection) {
        redisConnectionUrl = url;
        redisConnection = new IORedis(url, {
            maxRetriesPerRequest: null,
            enableOfflineQueue: false,
            connectTimeout: 8_000,
            commandTimeout: 12_000,
            // Limita retries para não consumir 100% CPU quando Redis está inacessível.
            retryStrategy: (times) => (times > 24 ? null : Math.min(times * 500, 10_000)),
            reconnectOnError: () => true,
        });
        redisConnection.on('error', (err) => {
            console.warn('[campaign-queue] redis error:', err?.message || err);
        });
        attachRedisStressGuard(redisConnection, getCampaignBullmqRecovery());
    }
    return redisConnection;
}

/** Aguarda Redis aceitar comandos (one-off scripts importam evolutionService antes do connect). */
async function waitForRedisCommandReady(conn: IORedis, timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const pong = await conn.ping();
            if (pong === 'PONG') return true;
        } catch {
            /* retry */
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    return false;
}

/** Força recriação da conexão BullMQ (útil após restart do Redis ou URL corrigida). */
export function resetCampaignRedisConnection(): void {
    if (redisConnection) {
        try {
            redisConnection.disconnect();
        } catch {
            /* ignore */
        }
    }
    redisConnection = null;
    redisConnectionUrl = null;
    campaignQueue = null;
    if (campaignWorker) {
        campaignWorker.close().catch(() => {});
        campaignWorker = null;
    }
    console.info('[campaign-queue] Conexão Redis resetada manualmente');
}

function getCampaignBullmqRecovery(): BullmqRecoveryHandler {
    return {
        name: 'campaign-queue',
        reset: resetCampaignRedisConnection,
        ensureWorker: ensureCampaignWorker,
    };
}

/** Verifica se o Redis está acessível abrindo uma conexão independente (não interfere no BullMQ). */
async function pingRedisHealthy(): Promise<boolean> {
    const url = getRedisUrl();
    const { redisPingWithFallback } = await import('./redisPing.js');
    const result = await redisPingWithFallback(url);
    return result.ok;
}

/** Expõe fila para trim periódico (redisMaintenance) — não usar fora do servidor. */
export function getCampaignBullmqQueue(): Queue<MessageQueueItem> | null {
    return getCampaignQueue();
}

export type CampaignBullmqQueueMetrics = {
    enabled: boolean;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
};

export async function getCampaignBullmqQueueMetrics(): Promise<CampaignBullmqQueueMetrics> {
    const empty = { enabled: false, waiting: 0, active: 0, delayed: 0, failed: 0 };
    const queue = getCampaignQueue();
    if (!queue) return empty;
    try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
        return {
            enabled: true,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
        };
    } catch {
        return empty;
    }
}

function getCampaignQueue(): Queue<MessageQueueItem> | null {
    const conn = getRedisConnection();
    if (!conn) return null;
    if (!campaignQueue) {
        campaignQueue = new Queue<MessageQueueItem>('campaign-messages', {
            connection: conn,
            defaultJobOptions: {
                removeOnComplete: bullmqRemoveOnComplete(),
                removeOnFail: bullmqRemoveOnFail(),
            },
        });
        void trimBullmqQueue(campaignQueue, 'campaign-messages');
    }
    return campaignQueue;
}
const connectionQueueSizes = new Map<string, number>();
let campaignWorker: Worker<MessageQueueItem> | null = null;
let replyFlowRecoveryScheduled = false;

function scheduleReplyFlowRecovery(): void {
    if (replyFlowRecoveryScheduled) return;
    replyFlowRecoveryScheduled = true;
    setTimeout(() => {
        void recoverStuckReplyFlowSessions().then((recovered) => {
            if (recovered > 0) {
                log('info', `[ReplyFlow] ${recovered} sessão(ões) retomada(s) após queda/restart`, { recovered });
            }
        });
    }, 15_000);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.resolve(projectRoot, process.env.DATA_DIR || 'data');
const connectionsSettingsFile = path.join(dataDir, 'connections_settings.json');
/** IDs de conexões explicitamente deletadas — impede ressurreição por hydrateInstancesFromEvolution. */
const deletedConnectionIds = new Set<string>();
const deletedConnectionsFile = path.join(dataDir, 'deleted_connections.json');

function loadDeletedConnections(): void {
    try {
        if (fs.existsSync(deletedConnectionsFile)) {
            const ids = JSON.parse(fs.readFileSync(deletedConnectionsFile, 'utf8'));
            if (Array.isArray(ids)) ids.forEach((id: unknown) => { if (typeof id === 'string') deletedConnectionIds.add(id); });
        }
    } catch { /* ignora */ }
}

function saveDeletedConnections(): void {
    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(deletedConnectionsFile, JSON.stringify([...deletedConnectionIds]), 'utf8');
    } catch { /* ignora */ }
}

interface ConnectionSettingsPayload {
    dailyLimit?: number;
    growthRate?: number;
    growthType?: 'percent' | 'fixed';
    limitAction?: 'ask' | 'redirect';
    messagesSentToday?: number;
    limitExceededApproved?: boolean;
    lastLimitResetDate?: string;
    ownerUid?: string;
    /** Dono original — nunca apagado por updates de limite/envio; usado para curar órfãos. */
    createdByUid?: string;
    friendlyName?: string;
    /** Histórico de bloqueios WhatsApp para este chip. */
    banCount?: number;
    lastBannedAt?: number;
    lastBanReason?: string;
    /** Quarentena: chip bloqueado de campanhas até este timestamp. */
    quarantineUntil?: number;
    /** Epoch ms em que o chip ficou open — sobrevive a restart (Uptime no cartão). */
    connectedSince?: number;
    /** Epoch ms em que o chip caiu/offline — usado para reprocessar respostas perdidas. */
    lastClosedAt?: number;
    /** Token por instância na Evolution Go (apikey por chip). */
    evolutionGoToken?: string;
    /** UUID da instância no Evolution Go (webhook instanceId). */
    evolutionGoInstanceId?: string;
}

function pickNonEmptyUid(...candidates: Array<string | undefined>): string | undefined {
    for (const raw of candidates) {
        const v = typeof raw === 'string' ? raw.trim() : '';
        if (v && v !== 'anonymous') return v;
    }
    return undefined;
}

/** Nome técnico conn_* ou igual ao id — não é o nome escolhido pelo usuário. */
function isGenericConnectionLabel(name: string | undefined, connId: string): boolean {
    const n = (name || '').trim();
    const id = (connId || '').trim();
    if (!n) return true;
    if (id && n === id) return true;
    return /^conn_\d+_\d+$/i.test(n);
}

function resolveDisplayFriendlyName(
    connId: string,
    conn?: EvolutionInstance,
    cached?: ConnectionSettingsPayload
): string {
    const mem = conn ?? connections.get(connId);
    const row = cached ?? connectionsSettingsCache[connId];
    const candidates = [row?.friendlyName, mem?.friendlyName, mem?.profileName];
    for (const c of candidates) {
        const v = (c || '').trim();
        if (v && !isGenericConnectionLabel(v, connId)) return v;
    }
    const profile = (mem?.profileName || '').trim();
    if (profile) return profile;
    return connId;
}

/** Substitui rótulo conn_* pelo nome do perfil WhatsApp ou nome salvo. */
function healConnectionFriendlyName(connId: string, opts?: { skipRam?: boolean }): boolean {
    const id = String(connId || '').trim();
    if (!id) return false;
    const conn = opts?.skipRam ? undefined : connections.get(id);
    const row = connectionsSettingsCache[id];
    const current = (conn?.friendlyName || row?.friendlyName || '').trim();
    if (current && !isGenericConnectionLabel(current, id)) return false;
    const resolved = resolveDisplayFriendlyName(id, conn, row);
    if (isGenericConnectionLabel(resolved, id)) return false;
    if (conn) conn.friendlyName = resolved;
    mergeConnectionSettingsCache(id, {
        friendlyName: resolved,
        ownerUid: conn?.ownerUid ?? row?.ownerUid,
        createdByUid: row?.createdByUid,
    });
    return true;
}

/** Cura rótulos genéricos conn_* em settings + RAM. */
export function healAllGenericConnectionFriendlyNames(): number {
    let changed = 0;
    for (const connId of Object.keys(connectionsSettingsCache)) {
        if (healConnectionFriendlyName(connId, { skipRam: true })) changed += 1;
    }
    for (const [connId] of connections.entries()) {
        if (healConnectionFriendlyName(connId)) changed += 1;
    }
    if (changed > 0) {
        saveConnectionsSettings();
        log('info', `Nomes de canal curados (conn_* → perfil/nome salvo): ${changed}`);
    }
    return changed;
}

/** Restaura ownerUid a partir de createdByUid (settings + RAM). */
function healConnectionOwnerFromSettings(connectionId: string, opts?: { skipRam?: boolean }): boolean {
    const id = String(connectionId || '').trim();
    if (!id) return false;
    const row = connectionsSettingsCache[id];
    if (!row) return false;
    const creator = pickNonEmptyUid(row.createdByUid);
    const current = pickNonEmptyUid(row.ownerUid);
    if (current) {
        if (!row.createdByUid && current) {
            row.createdByUid = current;
            return true;
        }
        return false;
    }
    if (!creator) return false;
    row.ownerUid = creator;
    if (!opts?.skipRam) {
        try {
            const conn = connections.get(id);
            if (conn) conn.ownerUid = creator;
        } catch {
            /* connections Map ainda não inicializado no boot do módulo */
        }
    }
    return true;
}

/** Cura todos os canais órfãos em connections_settings.json e RAM. */
export function healAllOrphanConnectionOwners(): number {
    let changed = 0;
    for (const connId of Object.keys(connectionsSettingsCache)) {
        if (healConnectionOwnerFromSettings(connId)) changed += 1;
    }
    for (const [connId, conn] of connections.entries()) {
        if (conn.ownerUid?.trim()) continue;
        if (healConnectionOwnerFromSettings(connId)) changed += 1;
    }
    if (changed > 0) {
        saveConnectionsSettings();
        log('warn', `Canais órfãos curados via createdByUid: ${changed}`);
    }
    return changed;
}

let connectionsSettingsCache: Record<string, ConnectionSettingsPayload> = {};

/** Persiste settings sem apagar ownerUid/friendlyName (evita canais sumirem do escopo estrito). */
function mergeConnectionSettingsCache(connectionId: string, patch: ConnectionSettingsPayload): void {
    // Tombstone: nunca reescrever cache de conexão explicitamente deletada
    if (deletedConnectionIds.has(connectionId)) return;
    const prev = connectionsSettingsCache[connectionId] ?? {};
    const mem = connections.get(connectionId);
    const ownerUid = pickNonEmptyUid(
        patch.ownerUid,
        prev.ownerUid,
        prev.createdByUid,
        mem?.ownerUid
    );
    const createdByUid = pickNonEmptyUid(
        patch.createdByUid,
        prev.createdByUid,
        prev.ownerUid,
        patch.ownerUid,
        mem?.ownerUid
    );
    connectionsSettingsCache[connectionId] = {
        ...prev,
        ...patch,
        ownerUid,
        createdByUid,
        friendlyName: patch.friendlyName ?? prev.friendlyName ?? mem?.friendlyName,
    };
    const resolvedName = resolveDisplayFriendlyName(connectionId, mem, connectionsSettingsCache[connectionId]);
    if (!isGenericConnectionLabel(resolvedName, connectionId)) {
        connectionsSettingsCache[connectionId].friendlyName = resolvedName;
        if (mem && isGenericConnectionLabel(mem.friendlyName, connectionId)) {
            mem.friendlyName = resolvedName;
            connections.set(connectionId, mem);
        }
    }
    if (ownerUid && mem && !mem.ownerUid) {
        mem.ownerUid = ownerUid;
        connections.set(connectionId, mem);
    }
}

function loadConnectionsSettings() {
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        loadDeletedConnections();
        if (fs.existsSync(connectionsSettingsFile)) {
            const raw = fs.readFileSync(connectionsSettingsFile, 'utf8');
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            // Remove do cache qualquer entrada que esteja no tombstone (conexões deletadas)
            for (const [connId, val] of Object.entries(parsed)) {
                if (!deletedConnectionIds.has(connId) && val && typeof val === 'object') {
                    connectionsSettingsCache[connId] = val as ConnectionSettingsPayload;
                }
            }
        }
        let bootHealed = 0;
        for (const connId of Object.keys(connectionsSettingsCache)) {
            if (healConnectionOwnerFromSettings(connId, { skipRam: true })) bootHealed += 1;
        }
        if (bootHealed > 0) {
            saveConnectionsSettings();
        }
    } catch (err) {
        log('warn', 'Falha ao carregar connections_settings.json', { error: err });
    }
}

export function saveConnectionsSettings() {
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(connectionsSettingsFile, JSON.stringify(connectionsSettingsCache, null, 2), 'utf8');
    } catch (err) {
        log('warn', 'Falha ao salvar connections_settings.json', { error: err });
    }
}

/** Cópia superficial para diagnóstico admin (reconciliação de donos). */
export function getConnectionsSettingsSnapshot(): Record<string, ConnectionSettingsPayload> {
    return { ...connectionsSettingsCache };
}

/** Epoch ms em que o chip ficou open (trust score / tier). */
export function getConnectionConnectedSince(connectionId: string): number | undefined {
    const row = connectionsSettingsCache[String(connectionId || '').trim()];
    const since = row?.connectedSince;
    return typeof since === 'number' && since > 0 ? since : undefined;
}

/** Converte ownerUid legado (Firebase) para users.id Postgres — evita vazamento entre tenants. */
export async function normalizeConnectionOwnersInSettings(): Promise<{ changed: number }> {
    let changed = 0;
    try {
        const { getZapmassPool } = await import('./db/postgres.js');
        const pool = getZapmassPool();
        if (!pool) return { changed };

        for (const [connId, row] of Object.entries(connectionsSettingsCache)) {
            const raw = typeof row?.ownerUid === 'string' ? row.ownerUid.trim() : '';
            if (!raw) continue;
            const r = await pool.query<{ id: string }>(
                `SELECT id::text FROM zapmass.users
                 WHERE firebase_uid = $1 OR id::text = $1 OR id = $1::uuid
                 LIMIT 1`,
                [raw]
            );
            const canonical = r.rows[0]?.id?.trim();
            if (!canonical || canonical === raw) continue;
            connectionsSettingsCache[connId] = { ...row, ownerUid: canonical, createdByUid: row.createdByUid?.trim() || canonical };
            const conn = connections.get(connId);
            if (conn) conn.ownerUid = canonical;
            changed += 1;
        }
        if (changed > 0) {
            saveConnectionsSettings();
            log('warn', `ownerUid normalizado em connections_settings (${changed} canal/is)`);
        }
    } catch (err) {
        log('warn', 'normalizeConnectionOwnersInSettings falhou', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    return { changed };
}

// Carregar as configurações na inicialização do módulo
loadConnectionsSettings();

function applySettingsToInstance(conn: EvolutionInstance) {
    const cached = connectionsSettingsCache[conn.instanceName];
    if (cached) {
        conn.dailyLimit = cached.dailyLimit;
        conn.growthRate = cached.growthRate;
        conn.growthType = cached.growthType || 'fixed';
        conn.limitAction = cached.limitAction || 'ask';
        conn.messagesSentToday = cached.messagesSentToday || 0;
        conn.limitExceededApproved = cached.limitExceededApproved || false;
        conn.lastLimitResetDate = cached.lastLimitResetDate;
        if (typeof cached.connectedSince === 'number' && cached.connectedSince > 0) {
            conn.lastOpenAt = cached.connectedSince;
        }
        // Restaurar nome amigável salvo pelo usuário (rename-connection persiste aqui).
        if ((cached as Record<string, unknown>).friendlyName && typeof (cached as Record<string, unknown>).friendlyName === 'string') {
            conn.friendlyName = (cached as Record<string, unknown>).friendlyName as string;
        }
        healConnectionOwnerFromSettings(conn.instanceName);
        const healedOwner = pickNonEmptyUid(
            conn.ownerUid,
            connectionsSettingsCache[conn.instanceName]?.ownerUid,
            connectionsSettingsCache[conn.instanceName]?.createdByUid
        );
        if (healedOwner) {
            conn.ownerUid = healedOwner;
        }
        healConnectionFriendlyName(conn.instanceName);
    } else {
        conn.dailyLimit = undefined;
        conn.growthRate = undefined;
        conn.growthType = 'fixed';
        conn.limitAction = 'ask';
        conn.messagesSentToday = 0;
        conn.limitExceededApproved = false;
        conn.lastLimitResetDate = undefined;
    }
    checkAndResetDailyLimits(conn);
}

/** Retorna data no fuso de Brasília (UTC-3) no formato YYYY-MM-DD.
 *  Usado para resetar limites diários no horário certo (meia-noite Brasil, não UTC). */
function brazilTodayKey(ts: number = Date.now()): string {
    const d = new Date(ts - 3 * 60 * 60 * 1000); // UTC → UTC-3
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function checkAndResetDailyLimits(conn: EvolutionInstance) {
    const today = brazilTodayKey(); // YYYY-MM-DD no fuso Brasil (UTC-3), não UTC
    if (conn.lastLimitResetDate !== today) {
        log('info', `[LimitReset] Resetando limites diários para a conexão ${conn.instanceName}. Dia anterior: ${conn.lastLimitResetDate || 'nenhum'}, Novo dia: ${today}`);
        
        // Se já existia um reset anterior (não é a primeira vez que a conexão é criada) e existe taxa de crescimento configurada
        if (conn.lastLimitResetDate && conn.dailyLimit && conn.growthRate && conn.growthRate > 0) {
            const oldLimit = conn.dailyLimit;
            if (conn.growthType === 'percent') {
                conn.dailyLimit = Math.round(conn.dailyLimit * (1 + conn.growthRate / 100));
            } else {
                conn.dailyLimit = conn.dailyLimit + conn.growthRate;
            }
            log('info', `[LimitReset] Limite diário do chip ${conn.instanceName} cresceu de ${oldLimit} para ${conn.dailyLimit} mensagens.`);
        }
        
        conn.messagesSentToday = 0;
        conn.limitExceededApproved = false;
        conn.lastLimitResetDate = today;
        
        mergeConnectionSettingsCache(conn.instanceName, {
            dailyLimit: conn.dailyLimit,
            growthRate: conn.growthRate,
            growthType: conn.growthType,
            limitAction: conn.limitAction,
            messagesSentToday: conn.messagesSentToday,
            limitExceededApproved: conn.limitExceededApproved,
            lastLimitResetDate: conn.lastLimitResetDate,
            ownerUid: conn.ownerUid,
            friendlyName: conn.friendlyName,
        });
        saveConnectionsSettings();
    }
}

export async function updateConnectionSettings(
    id: string,
    settings: {
        dailyLimit?: number;
        growthRate?: number;
        growthType?: 'percent' | 'fixed';
        limitAction?: 'ask' | 'redirect';
        messagesSentToday?: number;
        limitExceededApproved?: boolean;
    }
) {
    const conn = connections.get(id);
    if (!conn) throw new Error('Conexão não encontrada');

    if (settings.dailyLimit !== undefined) conn.dailyLimit = settings.dailyLimit;
    if (settings.growthRate !== undefined) conn.growthRate = settings.growthRate;
    if (settings.growthType !== undefined) conn.growthType = settings.growthType;
    if (settings.limitAction !== undefined) conn.limitAction = settings.limitAction;
    if (settings.messagesSentToday !== undefined) conn.messagesSentToday = settings.messagesSentToday;
    if (settings.limitExceededApproved !== undefined) conn.limitExceededApproved = settings.limitExceededApproved;

    mergeConnectionSettingsCache(id, {
        dailyLimit: conn.dailyLimit,
        growthRate: conn.growthRate,
        growthType: conn.growthType,
        limitAction: conn.limitAction,
        messagesSentToday: conn.messagesSentToday,
        limitExceededApproved: conn.limitExceededApproved,
        lastLimitResetDate: conn.lastLimitResetDate,
        ownerUid: conn.ownerUid,
        friendlyName: conn.friendlyName,
    });
    saveConnectionsSettings();

    const ownerUid = resolveOwnerUid(id);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'connections-update', filterByConnectionScope(ownerUid, getConnections()));
    } else {
        warnUnscopedConnectionEvent(id, 'connections-update');
    }
}

const connections: Map<string, EvolutionInstance> = new Map();
let io: SocketIOServer | null = null;

// Métricas e conversas
let metrics: DashboardMetrics = {
    totalSent: 0,
    totalDelivered: 0,
    totalRead: 0,
    totalReplied: 0,
};
const warmupQueue: WarmupItem[] = [];
const warmedNumbers = new Set<string>();

// Gerador de IDs: Evolution aceita bem conn_* curto; uid__conn_* falhava QR (timeout/count:0).
let idCounter = 0;
const generateId = (_ownerUid?: string) => `conn_${Date.now()}_${++idCounter}`;

function evoInst(instanceName: string): string {
    return encodeURIComponent(String(instanceName || '').trim());
}

// Controle de pausa por campanha
const pausedCampaigns = new Set<string>();

// Limite de frequência: ownerUid → phone → última vez enviado (ms epoch)
// Evita reenviar para o mesmo contato em menos de FREQUENCY_CAP_MS.
// Persistido no Redis (TTL automático) para sobreviver a restart do container;
// o Map em memória é apenas cache rápido / fallback quando Redis está fora.
const frequencyCap = new Map<string, Map<string, number>>();
const FREQUENCY_CAP_MS = 24 * 60 * 60 * 1000; // 24 h (padrão)
const FREQUENCY_CAP_TTL_SEC = Math.floor(FREQUENCY_CAP_MS / 1000);

function getFrequencyCap(ownerUid: string): Map<string, number> {
    let m = frequencyCap.get(ownerUid);
    if (!m) { m = new Map(); frequencyCap.set(ownerUid, m); }
    return m;
}

function freqCapRedisKey(ownerUid: string, phoneKey: string): string {
    return `zapmass:freqcap:${ownerUid}:${phoneKey}`;
}

async function getFrequencyCapInfo(
    ownerUid: string | undefined,
    phone: string
): Promise<{ capped: boolean; lastSentAt?: number }> {
    if (!ownerUid) return { capped: false };
    const key = phone.replace(/\D/g, '').slice(-11);
    if (key.length < 8) return { capped: false };

    const cap = getFrequencyCap(ownerUid);
    const lastMem = cap.get(key);
    if (lastMem && Date.now() - lastMem < FREQUENCY_CAP_MS) {
        return { capped: true, lastSentAt: lastMem };
    }

    try {
        const redis = getRedisConnection();
        if (redis && redis.status === 'ready') {
            const raw = await redis.get(freqCapRedisKey(ownerUid, key));
            if (raw) {
                const ts = Number(raw);
                if (Number.isFinite(ts) && Date.now() - ts < FREQUENCY_CAP_MS) {
                    cap.set(key, ts);
                    return { capped: true, lastSentAt: ts };
                }
            }
        }
    } catch {
        // Redis indisponível — usa só o resultado em memória (já avaliado acima).
    }
    return { capped: false };
}

async function checkFrequencyCap(ownerUid: string | undefined, phone: string): Promise<boolean> {
    const info = await getFrequencyCapInfo(ownerUid, phone);
    return info.capped;
}

export type FrequencyCapContactResult = {
    phone: string;
    phoneKey: string;
    capped: boolean;
    lastSentAt?: string;
};

/** Pré-voo: quais contatos já receberam mensagem nas últimas 24 h. */
export async function checkFrequencyCapForPhones(
    ownerUid: string | undefined,
    phones: string[]
): Promise<FrequencyCapContactResult[]> {
    const seen = new Set<string>();
    const unique: Array<{ phone: string; phoneKey: string }> = [];
    for (const phone of phones) {
        const digits = String(phone || '').replace(/\D/g, '');
        const phoneKey = digits.slice(-11);
        if (phoneKey.length < 8 || seen.has(phoneKey)) continue;
        seen.add(phoneKey);
        unique.push({ phone: digits, phoneKey });
    }

    const mem = ownerUid ? getFrequencyCap(ownerUid) : new Map<string, number>();
    const now = Date.now();
    const results: FrequencyCapContactResult[] = unique.map(({ phone, phoneKey }) => {
        const lastMem = mem.get(phoneKey);
        if (lastMem && now - lastMem < FREQUENCY_CAP_MS) {
            return {
                phone,
                phoneKey,
                capped: true,
                lastSentAt: new Date(lastMem).toISOString(),
            };
        }
        return { phone, phoneKey, capped: false };
    });

    const needRedis = unique
        .map((u, i) => ({ ...u, i }))
        .filter((u) => !results[u.i].capped);

    const redis = getRedisConnection();
    if (!ownerUid || !redis || redis.status !== 'ready' || needRedis.length === 0) {
        return results;
    }

    try {
        const keys = needRedis.map((u) => freqCapRedisKey(ownerUid, u.phoneKey));
        const raws = await Promise.race([
            redis.mget(...keys),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
        ]);
        if (!raws) return results;
        for (let k = 0; k < needRedis.length; k++) {
            const raw = raws[k];
            if (!raw) continue;
            const ts = Number(raw);
            if (!Number.isFinite(ts) || now - ts >= FREQUENCY_CAP_MS) continue;
            mem.set(needRedis[k].phoneKey, ts);
            results[needRedis[k].i] = {
                phone: needRedis[k].phone,
                phoneKey: needRedis[k].phoneKey,
                capped: true,
                lastSentAt: new Date(ts).toISOString(),
            };
        }
    } catch {
        // Redis lento — devolve o que já está em memória.
    }
    return results;
}

async function recordFrequencyCap(ownerUid: string | undefined, phone: string): Promise<void> {
    if (!ownerUid) return;
    const key = phone.replace(/\D/g, '').slice(-11);
    getFrequencyCap(ownerUid).set(key, Date.now());
    try {
        const redis = getRedisConnection();
        if (redis && redis.status === 'ready') {
            await redis.set(freqCapRedisKey(ownerUid, key), String(Date.now()), 'EX', FREQUENCY_CAP_TTL_SEC);
        }
    } catch {
        // Sem Redis: fica só em memória (degrada graciosamente).
    }
}

// ──── Mídia de campanha: armazenada em arquivo temporário em vez de RAM ───────
// Evita OOM em campanhas simultâneas com imagens/áudios grandes.
const campaignMediaById = new Map<string, CampaignMediaPayload & { _diskPath?: string }>();

const CAMPAIGN_MEDIA_TEMP_DIR = path.join(
    typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url)),
    '../data/campaign-media'
);

function ensureCampaignMediaDir(): void {
    try { fs.mkdirSync(CAMPAIGN_MEDIA_TEMP_DIR, { recursive: true }); } catch { /* ignora */ }
}

function saveCampaignMediaToDisk(campaignId: string, media: CampaignMediaPayload): string | null {
    if (!media.base64) return null;
    try {
        ensureCampaignMediaDir();
        const ext = media.fileName?.split('.').pop() || 'bin';
        const filePath = path.join(CAMPAIGN_MEDIA_TEMP_DIR, `${campaignId}.${ext}`);
        fs.writeFileSync(filePath, Buffer.from(media.base64, 'base64'));
        const metaPath = path.join(CAMPAIGN_MEDIA_TEMP_DIR, `${campaignId}.meta.json`);
        fs.writeFileSync(
            metaPath,
            JSON.stringify({
                mimeType: media.mimeType,
                fileName: media.fileName || `anexo.${ext}`,
                sendMediaAsDocument: (media as CampaignMediaPayload & { sendMediaAsDocument?: boolean }).sendMediaAsDocument === true,
                caption: media.caption,
            })
        );
        return filePath;
    } catch (e: any) {
        log('warn', 'Falha ao salvar mídia de campanha em disco — usando RAM como fallback', { campaignId, error: e?.message });
        return null;
    }
}

function loadCampaignMediaFromDisk(diskPath: string, mimeType: string, fileName: string, caption?: string): CampaignMediaPayload | null {
    try {
        const buf = fs.readFileSync(diskPath);
        return { base64: buf.toString('base64'), mimeType, fileName, caption };
    } catch {
        return null;
    }
}

function deleteCampaignMediaFromDisk(campaignId: string): void {
    releaseCampaignMediaFromMemory(campaignId);
    purgeCampaignMediaFilesOnDisk(campaignId);
}

function releaseCampaignMediaFromMemory(storageKey: string): void {
    campaignMediaById.delete(storageKey);
}

function purgeCampaignMediaFilesOnDisk(storageKey: string): void {
    if (!storageKey) return;
    try {
        ensureCampaignMediaDir();
        const prefix = `${storageKey}.`;
        for (const fileName of fs.readdirSync(CAMPAIGN_MEDIA_TEMP_DIR)) {
            if (fileName.startsWith(prefix)) {
                try {
                    fs.unlinkSync(path.join(CAMPAIGN_MEDIA_TEMP_DIR, fileName));
                } catch {
                    /* ignora */
                }
            }
        }
    } catch {
        /* ignora */
    }
}

function resolveStoredCampaignMedia(storageKey: string): (CampaignMediaPayload & { sendMediaAsDocument?: boolean }) | null {
    if (!storageKey) return null;
    const inMem = campaignMediaById.get(storageKey);
    if (inMem) {
        if (inMem.base64) return inMem;
        if (inMem._diskPath) {
            return loadCampaignMediaFromDisk(inMem._diskPath, inMem.mimeType, inMem.fileName, inMem.caption);
        }
    }
    try {
        ensureCampaignMediaDir();
        const files = fs.readdirSync(CAMPAIGN_MEDIA_TEMP_DIR);
        const dataFile = files.find((f) => f.startsWith(`${storageKey}.`) && !f.endsWith('.meta.json'));
        if (!dataFile) return null;
        const diskPath = path.join(CAMPAIGN_MEDIA_TEMP_DIR, dataFile);
        const metaPath = path.join(CAMPAIGN_MEDIA_TEMP_DIR, `${storageKey}.meta.json`);
        let mimeType = 'application/octet-stream';
        let fileName = dataFile.slice(storageKey.length + 1);
        let sendMediaAsDocument = false;
        if (fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
                mimeType?: string;
                fileName?: string;
                sendMediaAsDocument?: boolean;
            };
            mimeType = meta.mimeType || mimeType;
            fileName = meta.fileName || fileName;
            sendMediaAsDocument = meta.sendMediaAsDocument === true;
        }
        const loaded = loadCampaignMediaFromDisk(diskPath, mimeType, fileName);
        if (!loaded) return null;
        if (sendMediaAsDocument) loaded.sendMediaAsDocument = true;
        return loaded;
    } catch {
        return null;
    }
}

export type CampaignMediaAttachmentDto = {
    dataBase64: string;
    mimeType: string;
    fileName: string;
    sendMediaAsDocument?: boolean;
};

export function getCampaignMediaAttachmentsForRetry(campaignId: string): {
    mediaAttachment?: CampaignMediaAttachmentDto;
    followUpMediaAttachment?: CampaignMediaAttachmentDto;
} {
    const cid = String(campaignId || '').trim();
    if (!cid) return {};
    const toDto = (payload: (CampaignMediaPayload & { sendMediaAsDocument?: boolean }) | null) => {
        if (!payload?.base64) return undefined;
        return {
            dataBase64: payload.base64,
            mimeType: payload.mimeType,
            fileName: payload.fileName,
            ...(payload.sendMediaAsDocument ? { sendMediaAsDocument: true } : {}),
        } satisfies CampaignMediaAttachmentDto;
    };
    const mediaAttachment = toDto(resolveStoredCampaignMedia(cid));
    const followUpMediaAttachment = toDto(resolveStoredCampaignMedia(campaignMediaStorageKey(cid, 1)));
    return {
        ...(mediaAttachment ? { mediaAttachment } : {}),
        ...(followUpMediaAttachment ? { followUpMediaAttachment } : {}),
    };
}

/** Remove arquivos de mídia da campanha (ex.: ao excluir campanha no painel). */
export function purgeCampaignMediaFiles(campaignId: string): void {
    const cid = String(campaignId || '').trim();
    if (!cid) return;
    releaseCampaignMediaFromMemory(cid);
    releaseCampaignMediaFromMemory(campaignMediaStorageKey(cid, 1));
    purgeCampaignMediaFilesOnDisk(cid);
    purgeCampaignMediaFilesOnDisk(campaignMediaStorageKey(cid, 1));
}
// ──────────────────────────────────────────────────────────────────────────────

interface CampaignRuntimeState {
    ownerUid?: string;
    total: number;
    processed: number;
    successCount: number;
    failCount: number;
    skipCount?: number;
    lastLoggedProcessed: number;
    isRunning: boolean;
    /** Chips usados no disparo (pool ou seleção manual). */
    connectionIds?: string[];
    /** Pausa automática pela proteção anti-ban (distinta de pausa manual). */
    protectionPaused?: boolean;
    protectionPauseReason?: string;
    protectionPauseUntil?: number;
    protectionPauseMessage?: string;
    /** Janela deslizante dos últimos 20 resultados para auto-pausa por taxa de erro. */
    recentOutcomes: boolean[];
    /** Evita emitir múltiplos alertas de auto-pausa seguidos. */
    autoPauseEmitted?: boolean;
    /** Variáveis de personalização por destinatário — usadas em etapas lazy/multi-step. */
    _recipientVars?: Map<string, Record<string, string>>;
    /** Timestamp de início do disparo (watchdog de campanha presa). */
    startedAt?: number;
}

const campaignsById = new Map<string, CampaignRuntimeState>();
const campaignPendingJobs = new Map<string, number>();
/** Motor lazy: armazena stageConfigs por campaignId para lookups durante processamento. */
const campaignStageConfigsById = new Map<string, CampaignStageConfig[]>();

let replyFlowEngine: ReplyFlowEngine;

export async function applySettings(ownerUid: string, settings: Partial<TenantSettingsClientPayload>) {
    const saved = await saveTenantSettings(ownerUid, settings);
    log('info', '⚙️ Configurações do tenant atualizadas', { ownerUid, ...saved });
}

// Cliente HTTP configurado (Evolution API v2 ou Evolution Go via adapter)
function getGoInstanceToken(connectionId: string): string | undefined {
    return connectionsSettingsCache[connectionId]?.evolutionGoToken;
}

function getGoInstanceUuid(connectionId: string): string | undefined {
    return connectionsSettingsCache[connectionId]?.evolutionGoInstanceId;
}

function persistGoInstanceUuid(connectionId: string, uuid: unknown): void {
    const id = typeof uuid === 'string' ? uuid.trim() : '';
    if (!id) return;
    if (connectionsSettingsCache[connectionId]?.evolutionGoInstanceId === id) return;
    mergeConnectionSettingsCache(connectionId, { evolutionGoInstanceId: id });
    saveConnectionsSettings();
}

/** Sincroniza UUID + token da instância Go (evita 401 em /user/avatar). */
function syncGoInstanceCredentials(connectionId: string, row: Record<string, unknown>): void {
    persistGoInstanceUuid(connectionId, row.id ?? row.instanceId);
    const token = typeof row.token === 'string' ? row.token.trim() : '';
    if (!token) return;
    if (connectionsSettingsCache[connectionId]?.evolutionGoToken === token) return;
    mergeConnectionSettingsCache(connectionId, { evolutionGoToken: token });
    saveConnectionsSettings();
    log('info', `Token Go sincronizado: ${connectionId}`);
}

/** Cria instância no Evolution Go se o canal existe no ZapMass mas não no motor (pós-cutover). */
async function ensureEvolutionGoInstanceExists(connectionId: string): Promise<boolean> {
    if (!isEvolutionGoEngine()) return true;
    const id = String(connectionId || '').trim();
    if (!id) return false;

    try {
        const response = await api.get('/instance/fetchInstances');
        const list = Array.isArray(response.data) ? response.data : [];
        const goUuid = getGoInstanceUuid(id);
        const found = list.some((item: Record<string, unknown>) => {
            const name = String(item.name || item.instanceName || '').trim();
            const itemId = String(item.id || item.instanceId || '').trim();
            if (name === id) {
                syncGoInstanceCredentials(id, item);
                return true;
            }
            return itemId === goUuid;
        });
        if (found) return true;
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log('warn', `ensureEvolutionGoInstanceExists: fetch falhou (${id})`, { error: msg });
    }

    const conn = connections.get(id);
    const cached = connectionsSettingsCache[id];
    const friendlyName = conn?.friendlyName || cached?.friendlyName || id;
    log('info', `Instância Go ausente — recriando: ${id}`, { friendlyName });

    try {
        const createResp = await api.post('/instance/create', {
            instanceName: id,
            qrcode: true,
        });
        persistGoInstanceUuid(id, extractGoInstanceIdFromApiPayload(createResp.data));
        if (!connections.has(id)) {
            connections.set(id, {
                instanceName: id,
                friendlyName,
                status: 'connecting',
                ownerUid: conn?.ownerUid || cached?.ownerUid || ownerUidFromConnectionId(id),
            });
        }
        await setupWebhook(id).catch(() => undefined);
        return true;
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log('warn', `ensureEvolutionGoInstanceExists: create falhou (${id})`, { error: msg });
        return false;
    }
}

function resolveGoWebhookConnectionId(hint: {
    instanceId?: string;
    instanceToken?: string;
}): string | undefined {
    const token = hint.instanceToken?.trim();
    if (token) {
        for (const [connId, settings] of Object.entries(connectionsSettingsCache)) {
            if (settings.evolutionGoToken === token) {
                if (hint.instanceId?.trim() && settings.evolutionGoInstanceId !== hint.instanceId.trim()) {
                    persistGoInstanceUuid(connId, hint.instanceId.trim());
                }
                return connId;
            }
        }
    }
    const goId = hint.instanceId?.trim();
    if (goId) {
        for (const [connId, settings] of Object.entries(connectionsSettingsCache)) {
            if (settings.evolutionGoInstanceId === goId) {
                if (token && settings.evolutionGoToken !== token) {
                    mergeConnectionSettingsCache(connId, { evolutionGoToken: token });
                    saveConnectionsSettings();
                }
                return connId;
            }
        }
    }

    const connecting = [...connections.entries()].filter(
        ([, conn]) => conn.status === 'connecting' || conn.status === 'created'
    );
    if (connecting.length === 1 && (goId || token)) {
        const [connId] = connecting[0];
        mergeConnectionSettingsCache(connId, {
            ...(goId ? { evolutionGoInstanceId: goId } : {}),
            ...(token ? { evolutionGoToken: token } : {}),
        });
        saveConnectionsSettings();
        log('info', `Webhook Go vinculado ao canal em pairing: ${connId}`, {
            instanceId: goId || '-',
            hasToken: Boolean(token),
        });
        return connId;
    }

    return undefined;
}

function extractGoInstanceIdFromApiPayload(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const row = data as Record<string, unknown>;
    const direct = row.id ?? row.hash ?? row.instanceId;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const inst = row.instance;
    if (inst && typeof inst === 'object') {
        const nested = (inst as Record<string, unknown>).instanceId;
        if (typeof nested === 'string' && nested.trim()) return nested.trim();
    }
    return undefined;
}

function ensureGoInstanceToken(connectionId: string): string {
    let token = getGoInstanceToken(connectionId);
    if (!token) {
        token = crypto.randomUUID();
        mergeConnectionSettingsCache(connectionId, { evolutionGoToken: token });
        saveConnectionsSettings();
    }
    return token;
}

const api = createEvolutionHttpClient({
    getToken: getGoInstanceToken,
    ensureToken: ensureGoInstanceToken,
    getGoInstanceUuid,
});

const chatStore: EvolutionChatStore = createEvolutionChat(api, {
    resolveConnectionOwnerUid,
    ownerUidFromConnectionId
});

/** Evita POST repetido em /settings/set na mesma sessão do processo. */
const fullHistorySyncEnsured = new Set<string>();

/**
 * Ativa syncFullHistory na Evolution (histórico completo do WhatsApp no servidor).
 * Idempotente; falha silenciosa com log warn.
 */
async function ensureEvolutionFullHistorySync(instanceName: string): Promise<boolean> {
    const id = String(instanceName || '').trim();
    if (!id || !isEvolutionFullHistorySyncEnabled()) return false;
    if (isGoWebhookInboxMode()) return false;
    if (fullHistorySyncEnsured.has(id)) return true;

    try {
        await api.post(`/settings/set/${evoInst(id)}`, {
            syncFullHistory: true,
        });
        fullHistorySyncEnsured.add(id);
        log('info', `Evolution syncFullHistory ativado: ${id}`);
        return true;
    } catch (error: any) {
        log('warn', `Falha ao ativar syncFullHistory: ${id}`, {
            error: error?.message,
            response: error?.response?.data,
        });
        return false;
    }
}

// ================== FUNÇÕES AUXILIARES ==================

async function applyProxyToInstance(instanceName: string, proxy?: ConnectionProxyConfig | null) {
    if (!proxy?.host || !proxy.port) return;
    try {
        await api.post(`/proxy/set/${evoInst(instanceName)}`, {
            enabled: true,
            host: proxy.host,
            port: String(proxy.port),
            protocol: proxy.protocol || 'http',
            username: proxy.username || '',
            password: proxy.password || '',
        });
        log('info', `Proxy configurado para ${instanceName}`, {
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol || 'http',
        });
    } catch (error: any) {
        log('warn', `Erro ao configurar proxy para ${instanceName}`, { error: error.message });
    }
}

function bumpQueueSize(connectionId: string, delta: number) {
    const next = Math.max(0, (connectionQueueSizes.get(connectionId) || 0) + delta);
    if (next === 0) connectionQueueSizes.delete(connectionId);
    else connectionQueueSizes.set(connectionId, next);
}

function emitCampaignLog(
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    payload?: Record<string, unknown>,
    ownerUid?: string
) {
    const campaignId = (payload?.campaignId as string) || undefined;
    const uid = ownerUid || (campaignId ? campaignsById.get(campaignId)?.ownerUid : undefined);
    const entry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        payload: { campaignId, ...payload },
    };
    publishOwnerEvent(uid, 'campaign-log', entry);
    log(level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'info', message, payload);

    if (uid && campaignId) {
        const persistInfo =
            level === 'ERROR' ||
            (level === 'INFO' &&
                (message === 'Mensagem enviada' ||
                    message === 'Resposta recebida no fluxo por etapas' ||
                    message === 'Resposta do contato'));
        if (persistInfo) {
            const toPersist = { ...(payload || {}) };
            if (!toPersist.to && toPersist.phoneDigits) {
                toPersist.to = String(toPersist.phoneDigits).replace(/\D/g, '');
            }
            void persistCampaignLogToFirestore(uid, campaignId, level, message, toPersist);
        }
    }
}

/** Limiar para auto-pausa: se >= AUTO_PAUSE_FAIL_THRESHOLD % dos últimos AUTO_PAUSE_WINDOW jobs falharem. */
const AUTO_PAUSE_WINDOW = 20;
const AUTO_PAUSE_FAIL_THRESHOLD = 0.6; // 60%
const AUTO_PAUSE_MIN_PROCESSED = 10;   // só avalia após atingir este mínimo

function bumpCampaignProgress(campaignId: string | undefined, success: boolean) {
    if (!campaignId) return;
    const state = campaignsById.get(campaignId);
    if (!state) return;

    state.processed += 1;
    if (success) state.successCount += 1;
    else state.failCount += 1;

    // ── Auto-pausa por alta taxa de erros ───────────────────────────────────────
    state.recentOutcomes.push(success);
    if (state.recentOutcomes.length > AUTO_PAUSE_WINDOW) {
        state.recentOutcomes.shift();
    }
    if (
        !state.autoPauseEmitted &&
        state.isRunning &&
        !pausedCampaigns.has(campaignId) &&
        state.processed >= AUTO_PAUSE_MIN_PROCESSED &&
        state.recentOutcomes.length >= AUTO_PAUSE_WINDOW
    ) {
        const recentFails = state.recentOutcomes.filter((ok) => !ok).length;
        const failRate = recentFails / state.recentOutcomes.length;
        if (failRate >= AUTO_PAUSE_FAIL_THRESHOLD) {
            state.autoPauseEmitted = true;
            pausedCampaigns.add(campaignId);
            const pct = Math.round(failRate * 100);
            log('warn', `[auto-pausa] Campanha ${campaignId} pausada: ${pct}% de falhas nos últimos ${AUTO_PAUSE_WINDOW} jobs`, {
                campaignId, failRate: pct, recentFails, window: AUTO_PAUSE_WINDOW,
            });
            emitCampaignLog(
                'WARN',
                `⚠️ Campanha pausada automaticamente: ${pct}% de falhas nos últimos ${AUTO_PAUSE_WINDOW} envios`,
                { campaignId, failRate: pct, recentFails, window: AUTO_PAUSE_WINDOW },
                state.ownerUid
            );
            if (state.ownerUid) {
                publishOwnerEvent(state.ownerUid, 'campaign-auto-paused', {
                    campaignId,
                    reason: 'high_failure_rate',
                    failRatePct: pct,
                });
                publishOwnerEvent(state.ownerUid, 'campaign-paused', { campaignId });
                void persistCampaignProgressToFirestore(
                    state.ownerUid,
                    campaignId,
                    state.successCount,
                    state.failCount,
                    state.processed,
                    'PAUSED'
                );
            }
        }
    }
    // ──────────────────────────────────────────────────────────────────────────

    publishOwnerEvent(state.ownerUid, 'campaign-progress', {
        total: state.total,
        processed: state.processed,
        successCount: state.successCount,
        failCount: state.failCount,
        campaignId,
    });

    const shouldLog =
        state.processed === 1 ||
        state.processed === state.total ||
        state.processed - state.lastLoggedProcessed >= 5;
    if (shouldLog) {
        state.lastLoggedProcessed = state.processed;
        emitCampaignLog(
            'INFO',
            'Progresso do disparo',
            {
                campaignId,
                processed: state.processed,
                total: state.total,
                success: state.successCount,
                failed: state.failCount,
            },
            state.ownerUid
        );
        if (state.ownerUid) {
            void persistCampaignProgressToFirestore(
                state.ownerUid,
                campaignId,
                state.successCount,
                state.failCount,
                state.processed
            );
        }
    }

    if (state.processed >= state.total) {
        void tryFinalizeOrHoldCampaign(campaignId);
    }
}

function bumpCampaignSkip(campaignId: string | undefined) {
    if (!campaignId) return;
    const state = campaignsById.get(campaignId);
    if (!state) return;
    state.processed += 1;
    state.skipCount = (state.skipCount || 0) + 1;
    publishOwnerEvent(state.ownerUid, 'campaign-progress', {
        total: state.total,
        processed: state.processed,
        successCount: state.successCount,
        failCount: state.failCount,
        skipCount: state.skipCount,
        campaignId,
    });
    if (state.ownerUid) {
        void persistCampaignProgressToFirestore(
            state.ownerUid,
            campaignId,
            state.successCount,
            state.failCount,
            state.processed
        );
    }
    if (state.processed >= state.total) {
        void tryFinalizeOrHoldCampaign(campaignId);
    }
}

async function tryFinalizeOrHoldCampaign(campaignId: string): Promise<void> {
        const state = campaignsById.get(campaignId);
    if (!state?.isRunning) return;

    const pendingJobs = campaignPendingJobs.get(campaignId) || 0;
    if (pendingJobs > 0) return;

    const openReplyFlowSessions = replyFlowEngine
        ? replyFlowEngine.countOpenSessionsForCampaign(campaignId)
        : 0;
    let waitingReplyContacts = 0;
    if (usePostgresCampaigns()) {
        try {
            waitingReplyContacts = await countWaitingReplyForCampaign(campaignId);
        } catch {
            waitingReplyContacts = 0;
        }
    }

    if (openReplyFlowSessions > 0 || waitingReplyContacts > 0) {
        if (state.ownerUid) {
            void persistCampaignProgressToFirestore(
                state.ownerUid,
                campaignId,
                state.successCount,
                state.failCount,
                state.processed,
                'WAITING_REPLY'
            );
            publishOwnerEvent(state.ownerUid, 'campaign-waiting-reply', {
                campaignId,
                openReplyFlowSessions,
                waitingReplyContacts,
            });
        }
        return;
    }

            state.isRunning = false;
    releaseCampaignMediaFromMemory(campaignId);
    releaseCampaignMediaFromMemory(campaignMediaStorageKey(campaignId, 1));
    void deleteCampaignRuntimeFromRedis(campaignId);
            if (state.ownerUid) {
                void persistCampaignProgressToFirestore(
                    state.ownerUid,
                    campaignId,
                    state.successCount,
                    state.failCount,
                    state.processed,
                    'COMPLETED'
                );
        void persistCampaignReportSnapshot(state.ownerUid, campaignId);
                publishOwnerEvent(state.ownerUid, 'campaign-finished', {
                    campaignId,
                    successCount: state.successCount,
                    failCount: state.failCount,
                    total: state.total,
                });
                void notifyTenant(
                    state.ownerUid,
                    'campaign_complete',
                    {
                        campaignId,
                        campaignName: campaignId,
                        sent: state.successCount,
                        failed: state.failCount,
                        total: state.total,
                    },
                    'campaign_complete'
                );
            }
        }

function finishCampaignJob(campaignId: string | undefined, success: boolean) {
    if (!campaignId) return;
    bumpCampaignProgress(campaignId, success);

    const pending = Math.max(0, (campaignPendingJobs.get(campaignId) || 0) - 1);
    if (pending <= 0) {
        campaignPendingJobs.delete(campaignId);
        void tryFinalizeOrHoldCampaign(campaignId);
    } else {
        campaignPendingJobs.set(campaignId, pending);
        void saveCampaignRuntimeToRedis(campaignId);
    }
}

async function skipCampaignJobOnce(
    job: Job<MessageQueueItem>,
    item: MessageQueueItem
): Promise<void> {
    if (item._progressAccounted) return;
    item._progressAccounted = true;
    await job.updateData(item).catch(() => {});
    if (!item.campaignId) return;
    bumpCampaignSkip(item.campaignId);
    const pending = Math.max(0, (campaignPendingJobs.get(item.campaignId) || 0) - 1);
    if (pending <= 0) {
        campaignPendingJobs.delete(item.campaignId);
        void tryFinalizeOrHoldCampaign(item.campaignId);
    } else {
        campaignPendingJobs.set(item.campaignId, pending);
        void saveCampaignRuntimeToRedis(item.campaignId);
    }
}

async function accountCampaignJobOnce(
    job: Job<MessageQueueItem>,
    item: MessageQueueItem,
    success: boolean
): Promise<void> {
    if (item._progressAccounted) return;
    item._progressAccounted = true;
    await job.updateData(item).catch(() => {});
    finishCampaignJob(item.campaignId, success);
}

/** Campanha ativa pertence ao tenant; reconcilia ownerUid de membro da equipa. */
export async function ensureTenantOwnsCampaign(
    tenantUid: string,
    campaignId: string,
    workspaceMemberUids?: ReadonlySet<string>,
    actingAuthUid?: string
): Promise<boolean> {
    const cid = String(campaignId || '').trim();
    if (!cid) return false;
    
    const reconcileOwner = (ownerUid: string | undefined): boolean => {
        let resolved = resolveCampaignTenantOwner(
            tenantUid,
            ownerUid,
            workspaceMemberUids,
            actingAuthUid
        );
        if (!resolved && canReconcileLegacyCampaignOwner(tenantUid, ownerUid, workspaceMemberUids)) {
            resolved = tenantUid;
        }
        if (!resolved) return false;
        const memState = campaignsById.get(cid);
        if (memState && memState.ownerUid !== resolved) {
            memState.ownerUid = resolved;
        }
        evolutionRegisterCampaign(cid, resolved);
        return true;
    };

    const state = campaignsById.get(cid);
    if (state && reconcileOwner(state.ownerUid)) return true;

    const geoOwner = getCampaignGeoOwner(cid);
    if (geoOwner && reconcileOwner(geoOwner)) return true;

    if (!campaignsById.has(cid)) {
        await ensureCampaignRuntimeInMemory(cid, tenantUid);
        const restored = campaignsById.get(cid);
        if (restored && reconcileOwner(restored.ownerUid)) return true;
    }

    try {
        const lookupUids = buildCampaignOwnerLookupUids(tenantUid, workspaceMemberUids, actingAuthUid);
        const datastoreOwner = await lookupCampaignOwnerUidInDatastore(cid, lookupUids);
        if (datastoreOwner && reconcileOwner(datastoreOwner)) return true;
    } catch (e: any) {
        log('warn', 'Erro ao verificar dono da campanha no datastore', { campaignId: cid, error: e.message });
    }

    return false;
}

export async function canControlCampaign(
    uid: string,
    campaignId: string,
    workspaceMemberUids?: ReadonlySet<string>,
    actingAuthUid?: string
): Promise<boolean> {
    return ensureTenantOwnsCampaign(uid, campaignId, workspaceMemberUids, actingAuthUid);
}

// ── Redis reply-flow session persistence ──────────────────────────────────────
const REPLYFLOW_SESSION_TTL_SECS = 7 * 24 * 3600; // 7 dias

async function saveReplyFlowSessionToRedis(
    connectionId: string,
    phoneDigits: string,
    session: ReplyFlowSession
): Promise<void> {
    const conn = getRedisConnection();
    if (!conn) return;
    try {
        const key = `zapmass:rf:sess:${connectionId}:${phoneDigits}`;
        await conn.setex(key, REPLYFLOW_SESSION_TTL_SECS, JSON.stringify(session));
    } catch (e: any) {
        log('warn', 'saveReplyFlowSessionToRedis falhou', { error: e?.message });
    }
}

async function loadReplyFlowSessionFromRedis(
    connectionId: string,
    phoneDigits: string
): Promise<ReplyFlowSession | null> {
    const conn = getRedisConnection();
    if (!conn) return null;
    try {
        const key = `zapmass:rf:sess:${connectionId}:${phoneDigits}`;
        const raw = await conn.get(key);
        if (!raw) return null;
        const sess = JSON.parse(raw) as ReplyFlowSession;
        if (!sess?.campaignId || sess.awaitingAfterStep == null) return null;
        return sess;
    } catch {
        return null;
    }
}

async function deleteReplyFlowSessionFromRedis(connectionId: string, phoneDigits: string): Promise<void> {
    const conn = getRedisConnection();
    if (!conn) return;
    try {
        await conn.del(`zapmass:rf:sess:${connectionId}:${phoneDigits}`);
    } catch { /* ignora */ }
}

type ReplyFlowContextSnapshot = {
    campaignId: string;
    ownerUid?: string;
    vars: Record<string, string>;
    toRaw: string;
    openedAt: number;
};

async function saveReplyFlowContextToRedis(
    connectionId: string,
    phoneDigits: string,
    ctx: ReplyFlowContextSnapshot
): Promise<void> {
    const conn = getRedisConnection();
    if (!conn) return;
    try {
        const key = `zapmass:rf:ctx:${connectionId}:${phoneDigits}`;
        await conn.setex(key, REPLYFLOW_SESSION_TTL_SECS, JSON.stringify(ctx));
    } catch (e: any) {
        log('warn', 'saveReplyFlowContextToRedis falhou', { error: e?.message });
    }
}

async function loadReplyFlowContextFromRedis(
    connectionId: string,
    phoneDigits: string
): Promise<ReplyFlowContextSnapshot | null> {
    const conn = getRedisConnection();
    if (!conn) return null;
    try {
        const key = `zapmass:rf:ctx:${connectionId}:${phoneDigits}`;
        const raw = await conn.get(key);
        if (!raw) return null;
        const ctx = JSON.parse(raw) as ReplyFlowContextSnapshot;
        if (!ctx?.campaignId) return null;
        return ctx;
    } catch {
        return null;
    }
}

async function deleteReplyFlowContextFromRedis(connectionId: string, phoneDigits: string): Promise<void> {
    const conn = getRedisConnection();
    if (!conn) return;
    try {
        await conn.del(`zapmass:rf:ctx:${connectionId}:${phoneDigits}`);
    } catch { /* ignora */ }
}

/** Reabre sessão perdida quando há contexto recente da campanha (resposta sem sessão ativa). */
async function tryReopenReplyFlowFromContext(connectionId: string, phoneDigits: string): Promise<boolean> {
    if (!replyFlowEngine || replyFlowEngine.hasSession(connectionId, phoneDigits)) return false;

    const variants = new Set([phoneDigits]);
    if (phoneDigits.length === 13 && phoneDigits.startsWith('55') && phoneDigits.charAt(4) === '9') {
        variants.add(phoneDigits.slice(0, 4) + phoneDigits.slice(5));
    } else if (phoneDigits.length === 12 && phoneDigits.startsWith('55')) {
        variants.add(phoneDigits.slice(0, 4) + '9' + phoneDigits.slice(4));
    }

    for (const variant of variants) {
        const ctx = await loadReplyFlowContextFromRedis(connectionId, variant);
        if (!ctx?.campaignId) continue;
        const ageMs = Date.now() - (ctx.openedAt || 0);
        const maxReopenMs = 72 * 3600 * 1000;
        if (ageMs > maxReopenMs) continue;

        ensureReplyFlowEngine();
        const remoteJid = variant.length >= 8 ? `${variant}@s.whatsapp.net` : undefined;
        replyFlowEngine.openSession({
            connectionId,
            phoneDigits: variant,
            campaignId: ctx.campaignId,
            ownerUid: ctx.ownerUid,
            vars: ctx.vars || {},
            toRaw: ctx.toRaw || variant,
            convKey: `${connectionId}:${variant}`,
            remoteJid,
        });
        log('info', 'Sessão reply flow reaberta a partir de contexto Redis', {
            connectionId,
            phoneDigits: variant,
            campaignId: ctx.campaignId,
        });
        return true;
    }
    return false;
}

const REPLYFLOW_SESSION_KEY_PREFIX = 'zapmass:rf:sess:';

/** Re-enfileira respostas pendentes após queda, ban temporário ou restart. */
export async function recoverStuckReplyFlowSessions(): Promise<number> {
    const conn = getRedisConnection();
    if (!conn) return 0;
    if (!(await waitForRedisCommandReady(conn))) {
        log('warn', '[ReplyFlow] Redis indisponível — pulando recover de sessões presas');
        return 0;
    }
    ensureReplyFlowEngine();

    let recovered = 0;
    let cursor = '0';
    try {
    do {
        const [next, keys] = await conn.scan(cursor, 'MATCH', `${REPLYFLOW_SESSION_KEY_PREFIX}*`, 'COUNT', 100);
        cursor = next;
        for (const key of keys) {
            let sess: ReplyFlowSession | null = null;
            try {
                const raw = await conn.get(key);
                if (!raw) continue;
                sess = JSON.parse(raw) as ReplyFlowSession;
            } catch {
                continue;
            }
            const pending = sess?.pendingOutbound;
            if (!pending?.message?.trim() || !sess?.campaignId) continue;

            const keyBody = key.slice(REPLYFLOW_SESSION_KEY_PREFIX.length);
            const colonIdx = keyBody.indexOf(':');
            if (colonIdx <= 0) continue;
            const connectionId = keyBody.slice(0, colonIdx);
            const phoneDigits = keyBody.slice(colonIdx + 1);

            replyFlowEngine.restoreSession(connectionId, phoneDigits, sess);
            pending.enqueuedAt = Date.now();
            void saveReplyFlowSessionToRedis(connectionId, phoneDigits, sess);

            const mediaKey = pending.mediaStorageKey || '';
            const sendAsMedia = Boolean(mediaKey && campaignMediaById.has(mediaKey));
            const ownerFromState = campaignsById.get(sess.campaignId)?.ownerUid ?? sess.ownerUid;

            void enqueueCampaignItem(
                {
                    connectionId,
                    to: sess.toRaw,
                    message: pending.message,
                    campaignId: sess.campaignId,
                    ownerUid: ownerFromState,
                    sendAsMedia,
                    mediaLookupKey: mediaKey || undefined,
                    replyFlowResponse: true,
                    replyFlowDisposeAfterSend: pending.disposeAfterSend,
                    replyFlowAfterSend: pending.disposeAfterSend
                        ? undefined
                        : { phoneDigits, newAwaitingAfterStep: sess.awaitingAfterStep + 1 },
                    skipFrequencyCap: true,
                },
                5000 + Math.random() * 5000
            );
            recovered++;
            log('info', 'Sessão reply flow retomada após queda', {
                connectionId,
                phoneDigits,
                campaignId: sess.campaignId,
                awaitingAfterStep: sess.awaitingAfterStep,
                disposeAfterSend: pending.disposeAfterSend,
            });
        }
    } while (cursor !== '0');
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        log('warn', '[ReplyFlow] recoverStuckReplyFlowSessions falhou', { error: message, recovered });
    }

    return recovered;
}

// ──── Persistência de Runtime de Campanha no Redis ────────────────────────────
const CAMPAIGN_RUNTIME_TTL_SECS = 24 * 3600; // 24h

interface CampaignRuntimeRedis extends Omit<CampaignRuntimeState, '_recipientVars' | 'recentOutcomes'> {
    campaignId: string;
    savedAt: number;
    startedAt?: number;
    _recipientVars?: Record<string, Record<string, string>>;
}

function serializeRecipientVars(
    vars?: Map<string, Record<string, string>>
): Record<string, Record<string, string>> | undefined {
    if (!vars || !(vars instanceof Map) || vars.size === 0) return undefined;
    return Object.fromEntries(vars);
}

function deserializeRecipientVars(
    raw?: Record<string, Record<string, string>> | Map<string, Record<string, string>>
): Map<string, Record<string, string>> | undefined {
    if (!raw) return undefined;
    if (raw instanceof Map) return raw.size > 0 ? raw : undefined;
    const entries = Object.entries(raw).filter(([phone]) => phone.length >= 8);
    return entries.length > 0 ? new Map(entries) : undefined;
}

function syncPausedCampaignFromRuntime(campaignId: string, state: CampaignRuntimeState): void {
    if (state.protectionPaused) {
        pausedCampaigns.add(campaignId);
    }
}

async function saveCampaignRuntimeToRedis(campaignId: string): Promise<void> {
    const conn = getRedisConnection();
    if (!conn || !campaignId) return;
    const state = campaignsById.get(campaignId);
    if (!state) return;
    try {
        const payload: CampaignRuntimeRedis = {
            ownerUid: state.ownerUid,
            total: state.total,
            processed: state.processed,
            successCount: state.successCount,
            failCount: state.failCount,
            skipCount: state.skipCount,
            lastLoggedProcessed: state.lastLoggedProcessed,
            isRunning: state.isRunning,
            connectionIds: state.connectionIds,
            protectionPaused: state.protectionPaused,
            protectionPauseReason: state.protectionPauseReason,
            protectionPauseUntil: state.protectionPauseUntil,
            protectionPauseMessage: state.protectionPauseMessage,
            autoPauseEmitted: state.autoPauseEmitted,
            startedAt: state.startedAt,
            _recipientVars: serializeRecipientVars(state._recipientVars),
            campaignId,
            savedAt: Date.now(),
        };
        await conn.setex(
            `zapmass:campaign:runtime:${campaignId}`,
            CAMPAIGN_RUNTIME_TTL_SECS,
            JSON.stringify(payload)
        );
    } catch (e: any) {
        log('warn', 'saveCampaignRuntimeToRedis falhou', { campaignId, error: e?.message });
    }
}

async function loadCampaignRuntimeFromRedis(campaignId: string): Promise<CampaignRuntimeState | null> {
    const conn = getRedisConnection();
    if (!conn || !campaignId) return null;
    try {
        const raw = await conn.get(`zapmass:campaign:runtime:${campaignId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CampaignRuntimeRedis;
        if (!parsed?.ownerUid || typeof parsed.total !== 'number') return null;
        const restored: CampaignRuntimeState = {
            ownerUid: parsed.ownerUid,
            total: parsed.total,
            processed: parsed.processed || 0,
            successCount: parsed.successCount || 0,
            failCount: parsed.failCount || 0,
            lastLoggedProcessed: parsed.lastLoggedProcessed || 0,
            isRunning: parsed.isRunning !== false,
            connectionIds: Array.isArray(parsed.connectionIds) ? parsed.connectionIds : undefined,
            protectionPaused: parsed.protectionPaused,
            protectionPauseReason: parsed.protectionPauseReason,
            protectionPauseUntil: parsed.protectionPauseUntil,
            protectionPauseMessage: parsed.protectionPauseMessage,
            _recipientVars: deserializeRecipientVars(
                parsed._recipientVars as unknown as Record<string, Record<string, string>>
            ),
            startedAt: parsed.startedAt ?? parsed.savedAt,
            recentOutcomes: [],
        };
        return restored;
    } catch {
        return null;
    }
}

async function deleteCampaignRuntimeFromRedis(campaignId: string): Promise<void> {
    const conn = getRedisConnection();
    if (!conn || !campaignId) return;
    try {
        await conn.del(`zapmass:campaign:runtime:${campaignId}`);
    } catch { /* ignora */ }
}

/**
 * Garante que campaignsById tem entrada para a campanha.
 * Se não estiver em RAM, tenta restaurar do Redis.
 * Usado em processCampaignJob quando o servidor reiniciou durante um disparo ativo.
 */
async function ensureCampaignRuntimeInMemory(campaignId: string, fallbackOwnerUid?: string): Promise<void> {
    if (!campaignId || campaignsById.has(campaignId)) return;
    const fromRedis = await loadCampaignRuntimeFromRedis(campaignId);
    if (fromRedis) {
        campaignsById.set(campaignId, fromRedis);
        syncPausedCampaignFromRuntime(campaignId, fromRedis);
        log('info', `[reconcile] Runtime da campanha ${campaignId} restaurado do Redis`, { ownerUid: fromRedis.ownerUid });
        return;
    }
    // Fallback: cria entrada mínima com ownerUid do job
    const uid = fallbackOwnerUid;
    if (uid) {
        const pending = campaignPendingJobs.get(campaignId) || 1;
        campaignsById.set(campaignId, {
            ownerUid: uid,
            total: pending,
            processed: 0,
            successCount: 0,
            failCount: 0,
            lastLoggedProcessed: 0,
            isRunning: true,
            recentOutcomes: [],
        });
        log('info', `[reconcile] Runtime mínimo criado para campanha ${campaignId} (sem Redis)`, { ownerUid: uid });
    }
}
// ──────────────────────────────────────────────────────────────────────────────

/** Tenta recuperar sessão de reply flow do Redis quando não está em RAM (ex.: após restart). */
async function tryRestoreReplyFlowSession(connectionId: string, phoneDigits: string): Promise<void> {
    if (!replyFlowEngine || replyFlowEngine.hasSession(connectionId, phoneDigits)) return;

    // Tenta também a variante sem o 9 dígito BR (5511 9 XXXX-XXXX ↔ 5511 XXXX-XXXX)
    const variants = new Set([phoneDigits]);
    if (phoneDigits.length === 13 && phoneDigits.startsWith('55') && phoneDigits.charAt(4) === '9') {
        variants.add(phoneDigits.slice(0, 4) + phoneDigits.slice(5));
    } else if (phoneDigits.length === 12 && phoneDigits.startsWith('55')) {
        variants.add(phoneDigits.slice(0, 4) + '9' + phoneDigits.slice(4));
    }

    for (const variant of variants) {
        const sess = await loadReplyFlowSessionFromRedis(connectionId, variant);
        if (sess) {
            log('info', 'Sessão reply flow restaurada do Redis após restart', {
                connectionId,
                phoneDigits: variant,
                campaignId: sess.campaignId,
                awaitingAfterStep: sess.awaitingAfterStep,
            });
            // Recarrega a definição da campanha se necessário
            replyFlowEngine.restoreSession(connectionId, variant, sess);
            return;
        }
    }

    await tryReopenReplyFlowFromContext(connectionId, phoneDigits);
}
// ──────────────────────────────────────────────────────────────────────────────

function ensureReplyFlowEngine() {
    if (replyFlowEngine) return;
    replyFlowEngine = new ReplyFlowEngine({
        enqueue: (item) => {
            // Delay mínimo de 3s entre a resposta do contato e o próximo envio do reply flow
            // para evitar rajadas na API Evolution e parecer menos robótico.
            const replyDelay = 3000 + Math.random() * 4000;
            const ownerFromState = item.campaignId ? campaignsById.get(item.campaignId)?.ownerUid : undefined;
            const mediaKey = item.mediaStorageKey || '';
            const sendAsMedia = Boolean(mediaKey && campaignMediaById.has(mediaKey));
            void enqueueCampaignItem({
                connectionId: item.connectionId,
                to: item.to,
                message: item.message,
                campaignId: item.campaignId,
                ownerUid: ownerFromState,
                sendAsMedia,
                mediaLookupKey: mediaKey || undefined,
                replyFlowAfterSend: item.replyFlowAfterSend,
                replyFlowDisposeAfterSend: item.replyFlowDisposeAfterSend,
                replyFlowResponse: true,
                skipFrequencyCap: true,
            }, replyDelay);
        },
        onMarketingConsent: (ownerUid, campaignId, effect, phoneDigits, replyText, connectionId) => {
            publishOwnerEvent(ownerUid, 'contact-marketing-consent', {
                campaignId,
                phoneDigits,
                effect,
                replyText: String(replyText || '').slice(0, 500),
                at: new Date().toISOString(),
            });
            if (effect === 'opt_in' && ownerUid && connectionId) {
                void tryAutoEnrollOnOptIn({
                    tenantId: ownerUid,
                    phoneDigits,
                    connectionId,
                    conversationId: `${connectionId}:${phoneDigits}`,
                });
            }
        },
        onLog: (message, payload) =>
            emitCampaignLog('INFO', message, payload, payload?.ownerUid as string | undefined),
        onInboundReply: ({ campaignId, connectionId, phoneDigits, ownerUid, marketingEffect }) => {
            evolutionTrackIncomingReply(connectionId, phoneDigits, { campaignId, ownerUid });
            if (ownerUid && marketingEffect === 'opt_in') {
                void tryAutoEnrollHotLead({
                    tenantId: ownerUid,
                    phoneDigits,
                    connectionId,
                    conversationId: `${connectionId}:${phoneDigits}`,
                });
            }
        },
        isCampaignPaused: (campaignId) => pausedCampaigns.has(campaignId),
        onSessionSave: (connectionId, phoneDigits, session) => {
            void saveReplyFlowSessionToRedis(connectionId, phoneDigits, session);
            void saveReplyFlowContextToRedis(connectionId, phoneDigits, {
                campaignId: session.campaignId,
                ownerUid: session.ownerUid,
                vars: session.vars || {},
                toRaw: session.toRaw,
                openedAt: Date.now(),
            });
        },
        onSessionDisposed: (connectionId, phoneDigits) => {
            void deleteReplyFlowSessionFromRedis(connectionId, phoneDigits);
            void deleteReplyFlowContextFromRedis(connectionId, phoneDigits);
        },
        // Quando todas as sessões de reply flow de uma campanha fecham, tenta finalizar.
        // Não deletamos campaignPendingJobs aqui porque respostas de menu podem ter sido
        // enfileiradas logo antes do disposeSession — tryFinalizeOrHoldCampaign verifica
        // se pending > 0 e retorna sem finalizar se ainda houver jobs em andamento.
        onAllSessionsClosed: (campaignId) => {
            void tryFinalizeOrHoldCampaign(campaignId);
        },
    });
    ensureNurtureEnqueue();
}

/** Campanha com fluxo por resposta ativo para este contato (se houver). */
export function resolveActiveReplyFlowCampaignId(
    connectionId: string,
    phoneDigits: string,
    incomingConvId?: string
): string | undefined {
    ensureReplyFlowEngine();
    return replyFlowEngine?.resolveCampaignIdForIncoming(connectionId, phoneDigits, incomingConvId);
}

/** Reprocessa resposta inbound no fluxo (útil após reabrir sessão manualmente). */
export async function reprocessReplyFlowInbound(params: {
    connectionId: string;
    phoneDigits: string;
    bodyText: string;
    incomingConvId?: string;
}): Promise<{ hadSessionBefore: boolean; hasSessionAfter: boolean }> {
    ensureReplyFlowEngine();
    await tryRestoreReplyFlowSession(params.connectionId, params.phoneDigits);
    const hadSessionBefore = replyFlowEngine!.hasSession(params.connectionId, params.phoneDigits);
    await replyFlowEngine!.handleIncoming({
        connectionId: params.connectionId,
        phoneDigits: params.phoneDigits,
        bodyText: params.bodyText,
        incomingConvId: params.incomingConvId,
    });
    return {
        hadSessionBefore,
        hasSessionAfter: replyFlowEngine!.hasSession(params.connectionId, params.phoneDigits),
    };
}

let nurtureEnqueueRegistered = false;
function ensureNurtureEnqueue() {
    if (nurtureEnqueueRegistered) return;
    nurtureEnqueueRegistered = true;
    registerNurtureEnqueue(async (params) => {
        await enqueueCampaignItem(
            {
                connectionId: params.connectionId,
                to: params.contactPhone,
                message: params.message,
                campaignId: `nurture:${params.journeyId}`,
                ownerUid: params.tenantId,
                nurtureFollowUp: true,
                skipFrequencyCap: true,
                replyFlowResponse: true,
                nurtureEnrollmentId: params.enrollmentId,
                nurtureJourneyId: params.journeyId,
                nurtureStepIndex: params.stepIndex,
                ...(params.media
                    ? {
                          media: {
                              url: params.media.url,
                              mimeType: params.media.mimeType,
                              fileName: params.media.fileName,
                              caption: params.media.caption || params.message,
                              ...(params.media.sendAsDocument ? { sendMediaAsDocument: true } : {})
                          },
                          sendAsMedia: true
                      }
                    : {})
            },
            params.delayMs
        );
    });
}

async function filterActiveConnections(connectionIds: string[]): Promise<string[]> {
    const active: string[] = [];
    for (const connId of connectionIds) {
        if (connections.get(connId)?.status === 'open') {
            active.push(connId);
            continue;
        }
        if (await isConnectionOpen(connId)) active.push(connId);
        else {
            emitCampaignLog('WARN', `Canal excluído do disparo (indisponível): ${connId}`, { connectionId: connId });
        }
    }
    return active;
}

function log(level: 'info' | 'warn' | 'error', message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const prefix = `[EvolutionAPI:${level.toUpperCase()}]`;
    console.log(`${prefix} ${timestamp} ${message}`, data || '');
    
    if (!io) return;

    // Tenta resolver o dono pelo data (campaignId/ownerUid/connectionId)
    // para nao vazar logs entre tenants. Se nao houver pista, evento fica
    // apenas no console do servidor.
    let ownerUid: string | undefined;
    if (data && typeof data === 'object') {
        const d: Record<string, any> = data;
        if (typeof d.ownerUid === 'string' && d.ownerUid) {
            ownerUid = d.ownerUid;
        } else if (typeof d.campaignId === 'string' && d.campaignId) {
            ownerUid = campaignsById.get(d.campaignId)?.ownerUid;
        }
        if (!ownerUid && typeof d.connectionId === 'string' && d.connectionId) {
            ownerUid = resolveOwnerUid(d.connectionId);
        }
    }

    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'campaign:' + level, {
            timestamp,
            reason: message,
            ...data,
        });
    }
}

// ================== API METHODS ==================

/**
 * Cria uma nova instância (conexão WhatsApp) - FUNÇÃO INTERNA
 */
async function createConnectionInternal(
    id: string,
    name: string,
    proxy?: ConnectionProxyConfig,
    ownerUid?: string
): Promise<{ qrCode?: string; error?: string }> {
    try {
        log('info', `Criando instância: ${name} (${id})`);
        emitConnectionProgress(id, 'preparing');
        emitConnectionProgress(id, 'launching-browser');

        const createPayload: Record<string, unknown> = {
            instanceName: id,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
            ...(isEvolutionFullHistorySyncEnabled() ? { syncFullHistory: true } : {}),
        };

        if (proxy?.host && proxy.port) {
            createPayload.proxy = {
                host: proxy.host,
                port: String(proxy.port),
                protocol: proxy.protocol || 'http',
                username: proxy.username || '',
                password: proxy.password || '',
            };
        }

        emitConnectionProgress(id, 'loading-whatsapp-web');
        const response = await api.post('/instance/create', createPayload);
        persistGoInstanceUuid(id, extractGoInstanceIdFromApiPayload(response.data));

        const instance: EvolutionInstance = {
            instanceName: id,
            friendlyName: name,
            status: 'created',
            ownerUid: ownerUid || ownerUidFromConnectionId(id),
            ...(proxy?.host && proxy.port ? { proxy } : {}),
        };

        mergeConnectionSettingsCache(id, {
            ownerUid: instance.ownerUid,
            createdByUid: instance.ownerUid,
            friendlyName: name,
        });
        saveConnectionsSettings();

        connections.set(id, instance);

        if (proxy?.host && proxy.port) {
            await applyProxyToInstance(id, proxy);
        }

        await setupWebhook(id);
        if (!isEvolutionGoEngine()) {
            await ensureEvolutionFullHistorySync(id);
        }

        emitConnectionProgress(id, 'awaiting-scan');
        let extracted = extractQrFromApiResponse(response.data);
        if (!extracted) {
            extracted = await pollConnectQr(id, 6, 2000);
        }
        if (!extracted) {
            extracted = await waitForQrFirst(id, 28_000);
        }
        if (extracted) {
            emitQrToFrontend(id, extracted);
        } else {
            log('warn', `Instância criada sem QR após espera — watchdog + webhook`, { id });
            ensureQrDelivered(id);
        }

        log('info', `Instância criada: ${name}`, { instanceName: id });

        return { qrCode: extracted?.displayValue };

    } catch (error: any) {
        log('error', `Erro ao criar instância ${name}`, {
            error: error.message,
            response: error.response?.data,
        });
        return { error: error.message };
    }
}

/**
 * Configura webhook para receber eventos da instância
 */
async function ensureGoInstanceWebhook(instanceName: string): Promise<void> {
    if (!isEvolutionGoEngine()) return;
    if (!connections.has(instanceName) && !getGoInstanceUuid(instanceName)) return;
    try {
        await api.post(`/instance/connect/${evoInst(instanceName)}`, {});
        log('info', `Webhook Go aplicado via connect: ${instanceName}`);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log('warn', `ensureGoInstanceWebhook falhou: ${instanceName}`, { error: msg });
    }
}

/**
 * Configura webhook para receber eventos da instância
 */
async function setupWebhook(instanceName: string) {
    if (isEvolutionGoEngine()) {
        await ensureGoInstanceWebhook(instanceName);
        return;
    }
    try {
        let url = evolutionConfig.webhookUrl;
        const tok = process.env.EVOLUTION_WEBHOOK_TOKEN?.trim();
        const headers: Record<string, string> = {};
        if (tok) {
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}token=${encodeURIComponent(tok)}`;
            headers['Authorization'] = `Bearer ${tok}`;
            headers['x-evolution-webhook-token'] = tok;
        }
        const events = [
            'QRCODE_UPDATED',
            'CONNECTION_UPDATE',
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
        ];
        // Evolution API v2 exige objeto "webhook" na raiz (v1 usava campos flat → HTTP 400).
        // byEvents:false — todos os eventos vão para a mesma URL; com true a Evolution posta em
        // /webhook/.../qrcode-updated (404 se só existir POST /webhook/evolution).
        await api.post(`/webhook/set/${evoInst(instanceName)}`, {
            webhook: {
                enabled: true,
                url,
                byEvents: false,
                base64: true,
                headers,
                events,
            },
        });
        log('info', `Webhook configurado para ${instanceName}`, { url });
    } catch (error: any) {
        const detail = error?.response?.data;
        log('warn', `Erro ao configurar webhook para ${instanceName}`, {
            error: error.message,
            response: detail,
        });
    }
}

/**
 * Obtém status da conexão
 */
async function probeGoConnectionStateFromInstanceList(instanceName: string): Promise<string | null> {
    if (!isEvolutionGoEngine()) return null;
    try {
        const response = await api.get('/instance/fetchInstances', { timeout: 8_000 });
        const list = Array.isArray(response.data) ? response.data : [];
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Record<string, unknown>;
            const name = String(row.name || row.instanceName || '').trim();
            if (name !== instanceName) continue;
            if (row.connected === true || row.connectionStatus === 'open') return 'open';
            const parsed = parseConnectionStatePayload(row);
            return parsed || 'close';
        }
    } catch {
        /* ok */
    }
    return null;
}

export async function getConnectionState(
    instanceName: string,
    options?: { timeoutMs?: number; skipCache?: boolean; maxCacheAgeMs?: number }
): Promise<string> {
    const mem = connections.get(instanceName);
    if (mem?.status === 'open') return 'open';

    if (!options?.skipCache) {
        const cached = readCachedConnectionState(instanceName, options?.maxCacheAgeMs);
        if (cached) return cached;
    }

    try {
        const response = await api.get(`/instance/connectionState/${evoInst(instanceName)}`, {
            timeout: options?.timeoutMs ?? evolutionConfig.timeout,
        });
        const state = parseConnectionStatePayload(response.data);
        if (!isEvolutionOpenState(state)) {
            const fromList = await probeGoConnectionStateFromInstanceList(instanceName);
            if (fromList && isEvolutionOpenState(fromList)) {
                writeConnectionStateCache(instanceName, fromList);
                return fromList;
            }
        }
        writeConnectionStateCache(instanceName, state);
        return state;
    } catch (error: any) {
        const status = error?.response?.status;
        if (isEvolutionGoEngine()) {
            const fromList = await probeGoConnectionStateFromInstanceList(instanceName);
            if (fromList) {
                writeConnectionStateCache(instanceName, fromList);
                return fromList;
            }
        }
        if (status === 404) {
            writeConnectionStateCache(instanceName, 'close');
            return 'close';
        }
        const memStatus = connections.get(instanceName)?.status;
        if (memStatus) return memStatus;
        return 'close';
    }
}

/**
 * Força novo QR Code.
 * Se o chip foi banido anteriormente (banCount > 0), executa "reconexão limpa":
 * deleta a instância na Evolution API e a recria com credenciais zeradas —
 * evitando que o WhatsApp identifique o device fingerprint antigo.
 */
export async function forceQr(id: string): Promise<{ qrCode?: string; error?: string; cleanReconnect?: boolean }> {
    log('info', `Forçando novo QR para: ${id}`);
    stopWatchingConnection(id);
    stopQrWatch(id);
    clearAutoReconnect(id);
    pairingStartedAt.delete(id);

    if (isEvolutionGoEngine()) {
        try {
            await assertEvolutionGoLicensed('forçar QR');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : evolutionGoLicenseUserMessage(e);
            emitConnectionProgress(id, 'failed');
            return { error: msg };
        }
    }

    const conn = connections.get(id);
    if (!conn) {
        await hydrateInstancesFromEvolution();
    }
    if (!connections.has(id)) {
        throw new Error('Canal não encontrado. Atualize a página ou crie um canal novo.');
    }

    const banInfo = getConnectionBanInfo(id);
    const needsCleanReconnect = banInfo.banCount > 0;

    if (needsCleanReconnect) {
        log('warn', `[CleanReconnect] Chip ${id} foi banido ${banInfo.banCount}x — apagando credenciais Evolution para reconexão limpa`);
        // Preserva metadados do chip (dono, nome, configurações)
        const cached = connectionsSettingsCache[id] ? { ...connectionsSettingsCache[id] } : undefined;
        const connMem = connections.get(id);
        const ownerUid = resolveOwnerUid(id);
        const friendlyName = connMem?.friendlyName || cached?.friendlyName || id;
        const proxy = connMem?.proxy;

        // 1. Apaga a instância (zera device fingerprint, chaves, sessão)
        try {
            try { await api.delete(`/instance/logout/${evoInst(id)}`); } catch { /* ok */ }
            await api.delete(`/instance/delete/${evoInst(id)}`);
            connections.delete(id);
            log('info', `[CleanReconnect] Instância ${id} apagada`);
        } catch (err: any) {
            log('warn', `[CleanReconnect] Falha ao apagar instância ${id}`, { error: err?.message });
        }

        await sleep(2000);

        // 2. Recria a instância com credenciais zeradas
        try {
            const createResp = await api.post('/instance/create', {
                instanceName: evoInst(id),
                qrcode: true,
                ...(isEvolutionGoEngine()
                    ? {}
                    : {
                          token: evolutionConfig.apiKey,
                          integration: 'WHATSAPP-BAILEYS',
                      }),
            });
            persistGoInstanceUuid(id, extractGoInstanceIdFromApiPayload(createResp.data));
            log('info', `[CleanReconnect] Instância ${id} recriada com credenciais limpas`);
        } catch (err: any) {
            log('warn', `[CleanReconnect] Falha ao recriar instância ${id}`, { error: err?.message });
        }

        await sleep(1500);

        // 3. Restaura proxy se havia
        if (proxy?.host) {
            try {
                await setConnectionProxy(id, {
                    host: proxy.host,
                    port: proxy.port || '8080',
                    protocol: (proxy.protocol as any) || 'http',
                });
            } catch { /* ok */ }
        }

        // 4. Restaura metadados
        if (ownerUid || friendlyName) {
            if (!connectionsSettingsCache[id]) connectionsSettingsCache[id] = {};
            if (ownerUid) {
                connectionsSettingsCache[id].ownerUid = ownerUid;
                connectionsSettingsCache[id].createdByUid = connectionsSettingsCache[id].createdByUid || ownerUid;
            }
            if (friendlyName && friendlyName !== id) connectionsSettingsCache[id].friendlyName = friendlyName;
            saveConnectionsSettings();
        }

        // 5. Reinicia conexão RAM
        await hydrateInstancesFromEvolution();
        await setupWebhook(id).catch(() => { /* ok */ });
    }

    const active = connections.get(id);
    if (!active) {
        // Instância recém-criada pode não estar na RAM ainda — adiciona placeholder
        const placeholder: EvolutionInstance = {
            instanceName: id,
            friendlyName: id,
            status: 'connecting',
        };
        connections.set(id, placeholder);
    } else {
        active.phoneNumber = '';
        active.qrCode = undefined;
        active.status = 'connecting';
        connections.set(id, active);
    }

    pairingStartedAt.set(id, Date.now());
    emitConnectionProgress(id, 'loading-whatsapp-web');
    emitConnectionsUpdateForConnection(id);

    if (isEvolutionGoEngine()) {
        await ensureEvolutionGoInstanceExists(id);
    }

    if (!needsCleanReconnect) {
        try {
            await api.delete(`/instance/logout/${evoInst(id)}`);
        } catch {
            /* instância pode já estar deslogada */
        }
    }

    let extracted = await fetchConnectQr(id);
    if (!extracted) {
        extracted = await waitForQrFirst(id, 30_000);
    }
    if (!extracted) {
        extracted = await pollConnectQr(id, 10, 2500);
    }
    if (!extracted) {
        ensureQrDelivered(id, 25, 2000);
        applyConnectionStateUpdate(id, 'connecting', {});
        log('info', `forceQr: polling QR em background para ${id}`);
        return { error: 'QR ainda não disponível. Aguarde alguns segundos.', cleanReconnect: needsCleanReconnect };
    }

    emitQrToFrontend(id, extracted);
    log('info', `Novo QR gerado para: ${id}${needsCleanReconnect ? ' (reconexão limpa — credenciais zeradas)' : ''}`);
    return { qrCode: extracted.displayValue, cleanReconnect: needsCleanReconnect };
}

/**
 * Desconecta (logout) sem remover a instância — exibe QR para novo pareamento.
 */
export async function disconnectConnection(id: string): Promise<void> {
    log('info', `Desconectando instância (logout): ${id}`);
    stopWatchingConnection(id);
    stopQrWatch(id);
    clearAutoReconnect(id);
    pairingStartedAt.delete(id);

    if (!connections.has(id)) {
        await hydrateInstancesFromEvolution();
    }
    if (!connections.has(id)) {
        throw new Error('Canal não encontrado.');
    }

    try {
        await api.delete(`/instance/logout/${evoInst(id)}`);
    } catch (error: any) {
        log('warn', `logout ${id} falhou`, { error: error?.message });
    }

    applyConnectionStateUpdate(id, 'close', {});
    const conn = connections.get(id);
    if (conn) {
        conn.qrCode = undefined;
        conn.lastActivity = 'Desconectado';
        connections.set(id, conn);
    }
    emitConnectionsUpdateForConnection(id);

    void (async () => {
        const extracted = await fetchConnectQr(id);
        if (extracted) {
            emitQrToFrontend(id, extracted);
        } else {
            ensureQrDelivered(id, 25, 2000);
        }
    })();
}

/**
 * Reconecta uma instância
 */
export async function reconnectConnection(id: string) {
    try {
        log('info', `Reconectando instância: ${id}`);
        emitConnectionProgress(id, 'loading-whatsapp-web');

        const live = (await getConnectionState(id)).toLowerCase();
        if (isEvolutionOpenState(live)) {
            applyConnectionStateUpdate(id, 'open', {});
            log('info', `Instância já aberta: ${id}`);
            return;
        }

        const conn = connections.get(id);
        if (conn?.phoneNumber?.trim() && (live === 'close' || live === 'connecting')) {
            if (conn) {
                conn.status = 'connecting';
                connections.set(id, conn);
            }
            emitConnectionsUpdateForConnection(id);
            clearAutoReconnect(id);
            scheduleEvolutionAutoReconnect(id, { immediate: true });
            log('info', `Auto-reconnect imediato (canal pareado): ${id}`);
            return;
        }

        const extracted = await fetchConnectQr(id);
        if (extracted) {
            emitQrToFrontend(id, extracted);
        } else {
            ensureQrDelivered(id);
            watchConnectionUntilOpen(id);
            applyConnectionStateUpdate(id, 'connecting', {});
        }

        // Garante que o webhook esteja registrado tambem na reconexao
        // (instancias antigas podem estar com URL/token desatualizados).
        setupWebhook(id).catch((err) => {
            log('warn', 'Re-setupWebhook falhou em reconnect', {
                instance: id,
                error: err?.message,
            });
        });

        log('info', `Instância reconectada: ${id}`);

    } catch (error: any) {
        log('error', `Erro ao reconectar ${id}`, { error: error.message });
    }
}

/**
 * Deleta uma instância
 */
export async function deleteConnection(
    id: string,
    opts?: { reason?: string; caller?: string; phone?: string }
): Promise<void> {
    const reason = opts?.reason ?? 'manual';
    const caller = opts?.caller ?? 'explicit';
    const mem = connections.get(id);
    const cached = connectionsSettingsCache[id];
    log('warn', `deleteConnection: ${id}`, {
        reason,
        caller,
        status: mem?.status ?? null,
        phoneNumber: mem?.phoneNumber ?? opts?.phone ?? null,
        friendlyName: mem?.friendlyName ?? cached?.friendlyName ?? null,
        ownerUid: resolveOwnerUid(id) ?? null,
    });
    const ownerUid = resolveOwnerUid(id);

    stopWatchingConnection(id);
    stopQrWatch(id);
    clearAutoReconnect(id);
    pairingStartedAt.delete(id);
    countZeroRecoveryAttempts.delete(id);

    try {
        try {
            await api.delete(`/instance/logout/${evoInst(id)}`);
        } catch {
            /* ok */
        }
        await api.delete(`/instance/delete/${evoInst(id)}`);
    } catch (error: any) {
        const status = error?.response?.status;
        const msg = String(
            error?.response?.data?.message ||
                error?.response?.data?.error ||
                error?.message ||
                ''
        );
        const instanceMissing =
            status === 404 ||
            /record not found|not found|does not exist|instance.*not.*found/i.test(msg);
        // Evolution Go inacessível (ENOTFOUND/ECONNREFUSED) → limpar localmente sem bloquear
        const networkUnreachable =
            !error?.response &&
            /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|socket hang up/i.test(msg);
        if (isEvolutionGoLicenseError(error)) {
            log('warn', `delete ${id}: Evolution Go sem licença — removendo canal só no ZapMass`, { status });
        } else if (instanceMissing) {
            log('warn', `delete ${id}: instância já ausente na Evolution — limpando ZapMass`, {
                status,
                msg: msg.slice(0, 120),
            });
        } else if (networkUnreachable) {
            log('warn', `delete ${id}: Evolution Go inacessível (${msg.slice(0, 80)}) — removendo canal localmente`, {});
        } else if (status !== 404) {
            log('error', `Erro ao deletar ${id}`, { error: msg || 'Falha ao remover canal na Evolution', status });
            throw new Error(msg || 'Falha ao remover canal na Evolution');
        }
    }

    connections.delete(id);
    connectionQueueSizes.delete(id);
    // Tombstone: registrar deleção antes de limpar cache para evitar ressurreição
    deletedConnectionIds.add(id);
    saveDeletedConnections();
    if (connectionsSettingsCache[id]) {
        delete connectionsSettingsCache[id];
        saveConnectionsSettings();
    }
    const removedChats = chatStore.purgeConversationsForConnection(id);

    if (ownerUid) {
        const scoped = filterByConnectionScope(ownerUid, getConnections());
        publishOwnerEvent(ownerUid, 'connection-deleted', { id });
        publishOwnerEvent(ownerUid, 'connections-update', scoped);
        const { socketConversationsPayload } = await import('./conversationsEmit.js');
        publishOwnerEvent(
            ownerUid,
            'conversations-update',
            await socketConversationsPayload(ownerUid, ownerUid, chatStore.getConversations(), resolveConnectionOwnerUid)
        );
    } else {
        warnUnscopedConnectionEvent(id, 'connection-deleted');
    }

    log('info', `Instância deletada: ${id}`, { removedChats });
}

/**
 * Envia uma mensagem com Mídia - FUNÇÃO INTERNA
 */
async function sendMediaInternal(
    connectionId: string,
    to: string,
    base64: string,
    mimeType: string,
    fileName: string,
    caption?: string
): Promise<{ ok: boolean; messageId?: string; errorDetail?: string }> {
    const number = normalizeOutboundNumber(to);
    if (!number) {
        return { ok: false, errorDetail: `Número inválido: ${to}` };
    }

    let type = 'document';
    if (mimeType.startsWith('image/')) type = 'image';
    else if (mimeType.startsWith('video/')) type = 'video';
    else if (mimeType.startsWith('audio/')) type = 'audio';

    const { url } = await saveMediaFromBase64(base64, mimeType, fileName);
    const variants = buildOutboundPhoneVariants(number);
    let lastResult: { ok: boolean; messageId?: string; errorDetail?: string } = { ok: false };

    for (let i = 0; i < variants.length; i++) {
        const tryNumber = variants[i];
        if (i === 0) {
            log('info', `Enviando media via ${connectionId}`, { to: tryNumber, mimeType, fileName });
        } else {
            log('info', `Retentando mídia com variante BR do número`, {
                connectionId,
                toOriginal: to,
                variant: tryNumber,
                previousError: lastResult.errorDetail,
            });
        }

        lastResult = await attemptEvolutionSendMedia(
            connectionId,
            tryNumber,
            to,
            { mediatype: type, mimetype: mimeType, caption: caption || '', media: url, fileName }
        );
        if (lastResult.ok) return lastResult;
        if (i >= variants.length - 1 || !isRetryableOutbound400(lastResult.errorDetail)) break;
    }

    return lastResult;
}

async function attemptEvolutionSendMedia(
    connectionId: string,
    number: string,
    toOriginal: string,
    payload: {
        mediatype: string;
        mimetype: string;
        caption: string;
        media: string;
        fileName: string;
    }
): Promise<{ ok: boolean; messageId?: string; errorDetail?: string }> {
    try {
        const response = await api.post(`/message/sendMedia/${evoInst(connectionId)}`, {
            number,
            delay: 1200,
            mediatype: payload.mediatype,
            mimetype: payload.mimetype,
            caption: payload.caption,
            media: payload.media,
            fileName: payload.fileName,
        }, {
            timeout: evolutionConfig.mediaUploadTimeout,
        });
        const messageId = response.data?.key?.id || response.data?.key?._serialized;
        if (response.data?.key) {
            log('info', `✅ Media enviada com sucesso`, { to: number, messageId, url: payload.media });
            return { ok: true, messageId: messageId ? String(messageId) : undefined };
        }
        return { ok: false, errorDetail: 'Evolution retornou resposta sem confirmação de mídia' };
    } catch (error: unknown) {
        const detail = formatEvolutionHttpError(error, toOriginal);
        const ax = error as { message?: string; response?: { status?: number; data?: unknown } };
        log('error', `Erro ao enviar media`, {
            connectionId,
            toOriginal,
            toNormalized: number,
            error: ax?.message || detail,
            httpStatus: ax?.response?.status,
            responseBody: JSON.stringify(ax?.response?.data || {}).slice(0, 500),
        });
        return { ok: false, errorDetail: detail };
    }
}

/**
 * Uma tentativa de sendText na Evolution (sem retry de variante).
 */
import { computeComposingDelayMs } from './campaignComposingDelay.js';
async function sendPresenceComposing(
    connectionId: string,
    toNumber: string,
    delayMs: number
): Promise<void> {
    const ms = Math.floor(Math.max(0, delayMs));
    if (ms <= 0) return;
    const number = normalizeOutboundNumber(toNumber);
    if (!number) return;
    try {
        await api.post(`/chat/sendPresence/${evoInst(connectionId)}`, {
            number,
            presence: 'composing',
            delay: ms,
            options: { delay: ms, presence: 'composing', number },
        });
        await new Promise((resolve) => setTimeout(resolve, ms));
    } catch (err) {
        log('warn', 'sendPresence composing falhou (ignorado)', {
            connectionId,
            to: number,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function attemptEvolutionSendText(
    connectionId: string,
    number: string,
    message: string,
    toOriginal: string,
    skipInlinePresence = false
): Promise<{ ok: boolean; messageId?: string; errorDetail?: string; isPending?: boolean }> {
    try {
        const response = await api.post(`/message/sendText/${evoInst(connectionId)}`, {
            number,
            ...(skipInlinePresence
                ? {}
                : { options: { delay: 1200, presence: 'composing' }, delay: 1200 }),
            textMessage: { text: message },
            text: message,
        });

        const responseData = response.data;
        const messageId = responseData?.key?.id || responseData?.key?._serialized;

        if (responseData?.key) {
            log('info', `✅ Mensagem aceita pela Evolution API`, {
                toNormalized: number,
                messageId,
                status: responseData?.status,
            });
            return { ok: true, messageId: messageId ? String(messageId) : undefined };
        }

        if (responseData?.message === 'Message Sent' || responseData?.id) {
            const altId = String(responseData?.id || '');
            log('info', `✅ Mensagem aceita (formato alternativo)`, { toNormalized: number, altId });
            return { ok: true, messageId: altId || undefined };
        }

        if (responseData?.messageId) {
            log('info', `✅ Mensagem aceita (Evolution v2 — campo messageId)`, { toNormalized: number, messageId: responseData.messageId });
            return { ok: true, messageId: String(responseData.messageId) };
        }

        const statusOk = typeof responseData?.status === 'string' &&
            ['PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED', 'sent', 'delivered'].includes(responseData.status);
        if (statusOk) {
            log('info', `✅ Mensagem aceita (Evolution — status ${responseData.status})`, { toNormalized: number });
            return { ok: true, isPending: responseData.status === 'PENDING' };
        }

        const isExplicitError =
            responseData?.error ||
            (typeof responseData?.message === 'string' && /error|failed|invalid|unauthorized/i.test(responseData.message));
        if (!isExplicitError && responseData && typeof responseData === 'object') {
            log('warn', `Evolution respondeu 2xx sem 'key' — assumindo sucesso preventivo`, {
                toNormalized: number,
                responseSnippet: JSON.stringify(responseData).slice(0, 400),
            });
            return { ok: true };
        }

        const errMsg2xx = String(responseData?.error || responseData?.message || 'Evolution retornou resposta sem confirmação');
        log('warn', `Evolution respondeu com possível falha de entrega`, {
            toNormalized: number,
            toOriginal,
            connectionId,
            responseSnippet: JSON.stringify(responseData).slice(0, 400),
        });
        return { ok: false, errorDetail: errMsg2xx };
    } catch (error: unknown) {
        const detail = formatEvolutionHttpError(error, toOriginal);
        const ax = error as { response?: { status?: number; data?: unknown }; message?: string };
        log('error', `Erro HTTP ao enviar mensagem`, {
            connectionId,
            toOriginal,
            toNormalized: number,
            error: ax?.message || detail,
            httpStatus: ax?.response?.status,
            responseBody: JSON.stringify(ax?.response?.data || {}).slice(0, 500),
        });
        return { ok: false, errorDetail: detail };
    }
}

/**
 * Envia uma mensagem - FUNÇÃO INTERNA (3 argumentos)
 */
async function sendMessageInternal(
    connectionId: string,
    to: string,
    message: string
): Promise<{ ok: boolean; messageId?: string; errorDetail?: string; isPending?: boolean }> {
    const rawOutgoingText = String(message ?? '');
    const hadUnresolvedTemplate = hasUnresolvedCampaignTemplateTokens(rawOutgoingText);
    const outgoingText = hadUnresolvedTemplate
        ? sanitizeCampaignTemplateForOutbound(rawOutgoingText, campaignRotationIndexFromPhone(to))
        : rawOutgoingText;
    if (hadUnresolvedTemplate && outgoingText !== rawOutgoingText) {
        log('warn', 'Template normalizado no gateway antes do envio', {
            connectionId,
            to,
            before: rawOutgoingText.slice(0, 240),
            after: outgoingText.slice(0, 240),
        });
    }
    if (hasUnresolvedCampaignTemplateTokens(outgoingText)) {
        const errorDetail =
            'Envio bloqueado: não foi possível transformar a mensagem em texto final. Revise o conteúdo da campanha.';
        log('error', errorDetail, {
            connectionId,
            to,
            messagePreview: rawOutgoingText.slice(0, 240),
        });
        return { ok: false, errorDetail };
    }

    const number = normalizeOutboundNumber(to);

    if (!number) {
        log('warn', `Número inválido após normalização — envio ignorado`, { to, connectionId });
        return { ok: false, errorDetail: `Número inválido: ${to}` };
    }

    const variants = buildOutboundPhoneVariants(number);
    let lastResult: { ok: boolean; messageId?: string; errorDetail?: string; isPending?: boolean } = { ok: false };

    for (let i = 0; i < variants.length; i++) {
        const tryNumber = variants[i];
        if (i === 0) {
            log('info', `Enviando mensagem via ${connectionId}`, { toNormalized: tryNumber, toOriginal: to });
        } else {
            log('info', `Retentando envio com variante BR do número`, {
                connectionId,
                toOriginal: to,
                variant: tryNumber,
                previousError: lastResult.errorDetail,
            });
        }

        lastResult = await attemptEvolutionSendText(connectionId, tryNumber, outgoingText, to, true);
        if (lastResult.ok) return lastResult;

        const hasMoreVariants = i < variants.length - 1;
        if (!hasMoreVariants || !isRetryableOutbound400(lastResult.errorDetail)) break;
    }

    return lastResult;
}

/** Envio direto na Evolution (aquecimento) — sem inbox/LID do chat. */
export async function sendTextToPhoneDirect(
    connectionId: string,
    toPhone: string,
    message: string
): Promise<{ ok: boolean; messageId?: string; errorDetail?: string; isPending?: boolean }> {
    return sendMessageInternal(connectionId, toPhone, message);
}

const ENQUEUE_CAMPAIGN_TIMEOUT_MS = 45_000;

async function enqueueCampaignItem(item: MessageQueueItem, delayMs = 0) {
    const queue = getCampaignQueue();
    if (!queue) {
        // Sem Redis o job sumiria silenciosamente e a campanha nunca enviaria.
        // Lanca para o caller decidir (startCampaign vai falhar e avisar a UI).
        log('error', 'Redis indisponível — campanha não pode enfileirar (defina REDIS_URL)', {
            connectionId: item.connectionId,
            to: item.to,
            campaignId: item.campaignId,
        });
        throw new Error('Fila Redis indisponível. Verifique REDIS_URL/serviço Redis na VPS.');
    }

    if (isBullmqRecoveryPending('campaign-queue')) {
        throw new Error('Redis sob stress (memória cheia). Aguarde alguns segundos e tente novamente.');
    }

    // Backpressure: bloqueia enfileiramento se PG tiver > 50k jobs pending
    const backpressure = await isBackpressureActive().catch(() => false);
    if (backpressure) {
        log('warn', '[CampaignJobs] Backpressure ativo: fila PG com >50k pending. Enfileiramento bloqueado temporariamente.', {
            campaignId: item.campaignId,
        });
        throw new Error('Sistema sob backpressure — tente novamente em instantes.');
    }

    bumpQueueSize(item.connectionId, 1);
    if (item.campaignId) {
        campaignPendingJobs.set(item.campaignId, (campaignPendingJobs.get(item.campaignId) || 0) + 1);
    }
    // jobId estável: inclui stageIndex para evitar colisão entre etapas do mesmo contato.
    // O sufixo Date.now() permanece para evitar duplicação ao reenfileirar após pausa/retry.
    const stageTag = item.stageIndex != null ? `s${item.stageIndex}` : 's0';
    const jobId = `${item.campaignId || 'direct'}__${item.connectionId}__${item.to}__${stageTag}__${Date.now()}`;

    const addPromise = queue.add('send', item, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        delay: Math.max(0, delayMs),
        removeOnComplete: bullmqRemoveOnComplete(),
        removeOnFail: bullmqRemoveOnFail(),
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            addPromise,
            new Promise<never>((_, reject) => {
                timeoutId = setTimeout(
                    () => reject(new Error('Tempo esgotado ao enfileirar mensagem (Redis lento ou indisponível).')),
                    ENQUEUE_CAMPAIGN_TIMEOUT_MS
                );
            }),
        ]);

        // Espelha o job no PostgreSQL como fonte de verdade (idempotente via ON CONFLICT)
        if (item.campaignId && item.ownerUid) {
            void registerCampaignJob({
                idempotencyKey: jobId,
                campaignId: item.campaignId,
                tenantId: item.ownerUid,
                connectionId: item.connectionId,
                toNumber: item.to,
                stageIndex: item.stageIndex ?? 0,
                payload: item as unknown as Record<string, unknown>,
            }).catch(() => undefined); // não bloqueia — é registro de auditoria
        }
    } catch (err) {
        bumpQueueSize(item.connectionId, -1);
        if (item.campaignId) {
            const pending = (campaignPendingJobs.get(item.campaignId) || 1) - 1;
            if (pending <= 0) campaignPendingJobs.delete(item.campaignId);
            else campaignPendingJobs.set(item.campaignId, pending);
        }
        throw err;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function isCampaignChannelUsable(connectionId: string): boolean {
    const id = String(connectionId || '').trim();
    if (!id) return false;
    const conn = connections.get(id);
    if (conn?.status !== 'open') return false;
    return !getConnectionBanInfo(id).inQuarantine;
}

async function isCampaignChannelHealthy(connectionId: string): Promise<boolean> {
    if (!isCampaignChannelUsable(connectionId)) return false;
    const score = await getChipCircuitBreaker().getHealthScore(connectionId);
    return getChipCircuitBreaker().isUsable(score);
}

async function maybeNotifyCircuitBreakerOpen(connectionId: string, ownerUid?: string): Promise<void> {
    const ou = String(ownerUid || '').trim();
    const chipId = String(connectionId || '').trim();
    if (!ou || !chipId) return;
    const score = await getChipCircuitBreaker().getHealthScore(chipId);
    if (score.state !== 'OPEN') return;
    const label = connections.get(chipId)?.friendlyName || chipId;
    await emitAntiBanAlert(ou, 'chip-circuit-breaker-open', {
        connectionId: chipId,
        connectionLabel: label,
    });
}

async function maybeNotifyCircuitBreakerHalfOpen(connectionId: string, ownerUid?: string): Promise<void> {
    const ou = String(ownerUid || '').trim();
    const chipId = String(connectionId || '').trim();
    if (!ou || !chipId) return;
    const score = await getChipCircuitBreaker().getHealthScore(chipId);
    if (score.state !== 'HALF_OPEN') return;
    const label = connections.get(chipId)?.friendlyName || chipId;
    await emitAntiBanAlert(ou, 'chip-circuit-breaker-half-open', {
        connectionId: chipId,
        connectionLabel: label,
        failRatePct: Math.round(score.failRate * 1000) / 10,
    });
}

async function pickHealthyFailoverChannel(
    currentId: string,
    alternateIds: string[] | undefined,
    campaignId?: string,
    rotationIndex?: number
): Promise<string | null> {
    return pickDispatchChannel({
        campaignId,
        currentId,
        alternateIds,
        rotationIndex,
        preferCurrent: true,
        isChannelUsable: isCampaignChannelUsable,
    });
}

async function buildCampaignGuardContext(
    item: MessageQueueItem,
    state: CampaignRuntimeState
): Promise<{
    ownerUid: string;
    channelIds: string[];
    chipProtectionPolicy?: import('../shared/chipProtection.js').ChipProtectionPolicy;
    chipProtectionLockUntil?: string;
    chipProtectionLockReason?: string;
}> {
    const { loadTenantSettings } = await import('./tenantSettings.js');
    const ownerUid = state.ownerUid || item.ownerUid || '';
    const settings = await loadTenantSettings(ownerUid);
    const channelIds = collectCampaignChannelIds(
        item.connectionId,
        item.alternateChannelIds,
        state.connectionIds
    );
    return {
        ownerUid,
        channelIds,
        chipProtectionPolicy: settings.chipProtectionPolicy,
        chipProtectionLockUntil: settings.chipProtectionLockUntil,
        chipProtectionLockReason: settings.chipProtectionLockReason,
    };
}

async function runCampaignDispatchGuard(
    item: MessageQueueItem,
    state: CampaignRuntimeState
): Promise<CampaignDispatchGuardResult | null> {
    if (!item.campaignId || !state.ownerUid) return null;
    const ctx = await buildCampaignGuardContext(item, state);
    const guard = await evaluateCampaignDispatchGuard({
        ...ctx,
        isChannelUsable: isCampaignChannelUsable,
    });
    if (guard.action === 'pause' && !state.protectionPaused) {
        pauseCampaignForProtection(item.campaignId, {
            reason: guard.reason,
            ownerUid: state.ownerUid,
            autoResumeAt: guard.autoResumeAt,
            message: guard.message,
        });
    }
    return guard;
}

function pauseCampaignForProtection(
    campaignId: string,
    meta: {
        reason: string;
        ownerUid?: string;
        autoResumeAt?: number;
        message: string;
    }
): void {
    const state = campaignsById.get(campaignId);
    if (!state?.isRunning || state.protectionPaused) return;

    state.protectionPaused = true;
    state.protectionPauseReason = meta.reason;
    state.protectionPauseUntil = meta.autoResumeAt;
    state.protectionPauseMessage = meta.message;

    pausedCampaigns.add(campaignId);
    const ou = resolveCampaignOwnerUid(campaignId, meta.ownerUid);
    log('warn', `[CampaignProtection] Campanha pausada: ${campaignId}`, {
        reason: meta.reason,
        autoResumeAt: meta.autoResumeAt,
    });
    emitCampaignLog('WARN', `🛡️ ${meta.message}`, { campaignId, reason: meta.reason }, ou);
    if (ou) {
        publishOwnerEvent(ou, 'campaign-protection-paused', {
            campaignId,
            reason: meta.reason,
            message: meta.message,
            autoResumeAt: meta.autoResumeAt,
        });
        void emitAntiBanAlert(ou, 'campaign-protection-paused', {
            campaignId,
            reason: meta.reason,
            message: meta.message,
            autoResumeAt: meta.autoResumeAt,
        });
        publishOwnerEvent(ou, 'campaign-paused', { campaignId, protection: true });
        void persistCampaignProgressToFirestore(
            ou,
            campaignId,
            state.successCount,
            state.failCount,
            state.processed,
            'PAUSED'
        );
    }
    void saveCampaignRuntimeToRedis(campaignId);
}

function resumeCampaignFromProtection(campaignId: string, ownerUid?: string): void {
    void (async () => {
        const queue = getCampaignQueue();
        if (queue) {
            try {
                const spread = await spreadCampaignJobsOnResume(queue, campaignId, {
                    spreadStepMs: Number(process.env.GRADUAL_RESUME_SPREAD_MS ?? 15_000),
                    jitterMaxMs: Number(process.env.GRADUAL_RESUME_JITTER_MS ?? 5_000),
                });
                if (spread.rescheduled > 0) {
                    log('info', `[GradualResume] Campanha ${campaignId}: ${spread.rescheduled} job(s) redistribuídos`, spread);
                }
            } catch (e) {
                log('warn', `[GradualResume] Falha ao redistribuir jobs: ${campaignId}`, {
                    error: (e as Error)?.message,
                });
            }
        }

        const state = campaignsById.get(campaignId);
        if (state) {
            state.protectionPaused = false;
            state.protectionPauseReason = undefined;
            state.protectionPauseUntil = undefined;
            state.protectionPauseMessage = undefined;
        }
        resumeCampaign(campaignId, ownerUid);
        const ou = resolveCampaignOwnerUid(campaignId, ownerUid);
        emitCampaignLog(
            'INFO',
            '🛡️ Campanha retomada com distribuição gradual (anti-spike). Horários futuros preservados.',
            { campaignId },
            ou
        );
        if (ou) {
            publishOwnerEvent(ou, 'campaign-protection-resumed', { campaignId, gradualSpread: true });
        }
        void saveCampaignRuntimeToRedis(campaignId);
    })();
}

/** Reavalia campanhas ativas após ban/queda de um chip. */
export async function reviewRunningCampaignsForChipProtection(connectionId: string): Promise<void> {
    const chipId = String(connectionId || '').trim();
    if (!chipId) return;

    for (const [campaignId, state] of campaignsById.entries()) {
        if (!state.isRunning) continue;
        const ids = state.connectionIds || [];
        if (!ids.includes(chipId)) continue;

        const item: MessageQueueItem = {
            connectionId: chipId,
            to: '',
            message: '',
            campaignId,
            ownerUid: state.ownerUid,
            alternateChannelIds: ids.length > 1 ? ids : undefined,
        };
        await runCampaignDispatchGuard(item, state);
    }
}

/** Snapshot de campanhas sob proteção anti-ban (UI / diagnóstico). */
export function getCampaignProtectionSnapshot(ownerUid: string): {
    running: number;
    protectionPaused: Array<{
        campaignId: string;
        reason?: string;
        message?: string;
        autoResumeAt?: number;
    }>;
} {
    const uid = String(ownerUid || '').trim();
    const protectionPaused: Array<{
        campaignId: string;
        reason?: string;
        message?: string;
        autoResumeAt?: number;
    }> = [];
    let running = 0;
    for (const [campaignId, state] of campaignsById.entries()) {
        if (!state.isRunning || state.ownerUid !== uid) continue;
        running++;
        if (state.protectionPaused) {
            protectionPaused.push({
                campaignId,
                reason: state.protectionPauseReason,
                message: state.protectionPauseMessage,
                autoResumeAt: state.protectionPauseUntil,
            });
        }
    }
    return { running, protectionPaused };
}

/** Retoma campanhas pausadas pela proteção quando chips/locks permitem. */
export async function tickAutoResumeProtectedCampaigns(): Promise<void> {
    const now = Date.now();
    for (const [campaignId, state] of campaignsById.entries()) {
        if (!state.isRunning || !state.protectionPaused) continue;
        if (state.protectionPauseUntil && state.protectionPauseUntil > now) continue;

        const ids = state.connectionIds || [];
        if (ids.length === 0) continue;

        const ctx = await buildCampaignGuardContext(
            {
                connectionId: ids[0],
                to: '',
                message: '',
                campaignId,
                ownerUid: state.ownerUid,
                alternateChannelIds: ids.length > 1 ? ids : undefined,
            },
            state
        );
        const guard = await evaluateCampaignDispatchGuard({
            ...ctx,
            isChannelUsable: isCampaignChannelUsable,
        });
        if (guard.action === 'proceed') {
            resumeCampaignFromProtection(campaignId, state.ownerUid);
        }
    }
}

async function processCampaignJob(job: Job<MessageQueueItem>, token?: string) {
    const item = job.data;

    // Idempotência: envio já confirmado — só fecha contadores do job, sem reenviar nem recontar.
    if (item._sentOk) {
        bumpQueueSize(item.connectionId, -1);
        await accountCampaignJobOnce(job, item, true);
        return;
    }

    // BullMQ v5: para readiar um job ATIVO é obrigatório passar o `token` e lançar
    // DelayedError — caso contrário o moveToDelayed falha (lock) e o job vai para "failed".
    if (item.campaignId && !campaignsById.has(item.campaignId)) {
        const fallback = item.ownerUid || item.replyFlowOpen?.ownerUid;
        await ensureCampaignRuntimeInMemory(item.campaignId, fallback);
    }
    const campaignStateEarly = item.campaignId ? campaignsById.get(item.campaignId) : undefined;

    if (item.campaignId && campaignStateEarly?.ownerUid && campaignStateEarly.isRunning) {
        const guard = await runCampaignDispatchGuard(item, campaignStateEarly);
        if (guard?.action === 'pause') {
            await job.moveToDelayed(Date.now() + 3000, token);
            throw new DelayedError();
        }
        if (guard?.action === 'slow' && guard.extraDelayMs) {
            await job.moveToDelayed(Date.now() + guard.extraDelayMs, token);
            throw new DelayedError();
        }
    }

    if (item.campaignId && pausedCampaigns.has(item.campaignId)) {
        await job.moveToDelayed(Date.now() + 3000, token);
        throw new DelayedError();
    }

    // Marca início do processamento no PG (estado 'sending' — protege contra reaper precoce)
    void markJobSending(job.id ?? '', process.env.WORKER_ID || `worker-${process.pid}`).catch(() => undefined);

    const campaignState = campaignStateEarly;
    if (item.to) {
        const canonicalTo = normalizePhoneKey(item.to);
        if (canonicalTo) item.to = canonicalTo;
    }

    // Última barreira antes do envio: jobs antigos persistidos no Redis, warmup e
    // integrações legadas podem ter entrado na fila com o template cru. Resolver
    // aqui garante que nenhum `{A|B}` chegue ao WhatsApp, mesmo após restart.
    const queueVars =
        item.replyFlowOpen?.vars ??
        (() => {
            const phone = normalizePhoneKey(item.to || '');
            const varsMap = campaignStateEarly?._recipientVars;
            if (!phone || !varsMap) return undefined;
            return varsMap instanceof Map ? varsMap.get(phone) : undefined;
        })() ??
        {};
    const resolvedQueueMessage = applyMessageVars(item.message, item.to, queueVars, item.rotationIndex);
    if (resolvedQueueMessage !== item.message) {
        item.message = resolvedQueueMessage;
        await job.updateData(item).catch(() => {});
    }

    const ownerUidForJob = campaignState?.ownerUid || item.ownerUid;
    const textForHashLock = String(item.message || '').trim();
    if (ownerUidForJob && textForHashLock.length >= 8 && !item.nurtureFollowUp) {
        const skipHashForMediaOnly =
            Boolean(item.sendAsMedia) &&
            Boolean(item.campaignId || item.mediaLookupKey) &&
            campaignMediaById.has(item.mediaLookupKey || item.campaignId || '');
        if (!skipHashForMediaOnly) {
        const hashLock = await validateCampaignContentHash(
            getSharedRedis(),
            ownerUidForJob,
            item.campaignId,
            textForHashLock
        );
        if (hashLock.action === 'PAUSE_CAMPAIGN') {
            if (item.campaignId) {
                pauseCampaignForProtection(item.campaignId, {
                    reason: 'PAUSED_BY_HIGH_DUPLICATION',
                    ownerUid: ownerUidForJob,
                    message:
                        'Campanha pausada: conteúdo idêntico repetido em excesso. Adicione Spintax ({A|B}) ou varie o texto.',
                });
            }
            emitCampaignLog(
                'WARN',
                'Campanha pausada por duplicação de texto idêntico (circuit breaker de hash).',
                { campaignId: item.campaignId, contentHash: hashLock.hash, violations: hashLock.campaignViolations },
                ownerUidForJob
            );
            throw new UnrecoverableError('Campanha pausada por duplicação de texto');
        }
        if (hashLock.action === 'DELAY_JOB') {
            const delayMs = hashLock.delayMs ?? 45_000;
            log('warn', '[ContentHashLock] Conteúdo idêntico repetido — reagendando job', {
                tenantId: ownerUidForJob,
                hash: hashLock.hash,
                count: hashLock.count,
                delayMs,
                campaignId: item.campaignId,
            });
            emitCampaignLog(
                'WARN',
                `Conteúdo idêntico repetido — adicionando ${Math.round(delayMs / 1000)}s de delay. Use Spintax para variar o texto.`,
                { campaignId: item.campaignId, contentHash: hashLock.hash, count: hashLock.count },
                ownerUidForJob
            );
            await job.moveToDelayed(Date.now() + delayMs, token);
            throw new DelayedError();
        }
        }
    }

    const dispatchSettings = getTenantDispatchSettings(campaignState?.ownerUid);

    // Trust score: chips novos recebem delay extra antes do envio (ramp-up).
    if (!item.nurtureFollowUp && !item._tierDelayApplied) {
        const tierProfile = resolveChipTier(getConnectionConnectedSince(item.connectionId));
        const tierConn = connections.get(item.connectionId);
        if (tierConn && isTierDailyCapReached(tierConn.messagesSentToday || 0, tierProfile)) {
            checkAndResetDailyLimits(tierConn);
            if (isTierDailyCapReached(tierConn.messagesSentToday || 0, tierProfile)) {
                const nowBr = new Date(Date.now() - 3 * 3600_000);
                const msBrMidnight =
                    (24 - nowBr.getUTCHours()) * 3600_000 -
                    nowBr.getUTCMinutes() * 60_000 -
                    nowBr.getUTCSeconds() * 1000;
                emitCampaignLog(
                    'WARN',
                    `Chip ${item.connectionId} atingiu cap diário do tier ${tierProfile.label} (${tierProfile.suggestedDailyCap}/dia). Reagendado para amanhã.`,
                    { campaignId: item.campaignId, connectionId: item.connectionId, tier: tierProfile.tier },
                    campaignState?.ownerUid
                );
                await job.moveToDelayed(Date.now() + Math.max(msBrMidnight, 60_000), token);
                throw new DelayedError();
            }
        }
        let extraDelay = computeTierExtraDelayMs(dispatchSettings.minDelayMs, tierProfile);
        const cbScore = await getChipCircuitBreaker().getHealthScore(item.connectionId);
        extraDelay = Math.floor(extraDelay * getChipCircuitBreaker().delayMultiplier(cbScore));
        if (extraDelay > 0) {
            item._tierDelayApplied = true;
            await job.updateData(item).catch(() => {});
            await job.moveToDelayed(Date.now() + extraDelay, token);
            throw new DelayedError();
        }
    }

    if (dispatchSettings.sleepMode && isBrazilNightHour() && !hasSleepModeOverride(item.campaignId)) {
        const ownerUid = campaignState?.ownerUid;
        if (item.campaignId && ownerUid && markSleepModeNotified(item.campaignId)) {
            publishOwnerEvent(ownerUid, 'campaign-sleep-mode-pause', {
                campaignId: item.campaignId,
                untilHour: 8,
                message:
                    'Modo silêncio noturno (20h–8h, horário de Brasília). A campanha foi pausada. Deseja continuar enviando agora?',
            });
            emitCampaignLog(
                'WARN',
                'Modo silêncio noturno (20h–8h). Campanha pausada — confirme na tela se deseja continuar enviando.',
                { campaignId: item.campaignId },
                ownerUid
            );
        }
        pruneSleepModeNotified();
        const delayMs = Math.min(Math.max(msUntilBrazil8am(), 60_000), 300_000);
        log('info', '😴 Sleep mode ativo — campanha aguardando confirmação ou 8h', {
            ownerUid,
            campaignId: item.campaignId,
            delayMs,
        });
        await job.moveToDelayed(Date.now() + delayMs, token);
        throw new DelayedError();
    }

    if (!(await isCampaignChannelHealthy(item.connectionId))) {
        void maybeNotifyCircuitBreakerOpen(item.connectionId, campaignState?.ownerUid || item.ownerUid);
        void maybeNotifyCircuitBreakerHalfOpen(item.connectionId, campaignState?.ownerUid || item.ownerUid);
        const failoverId = await pickHealthyFailoverChannel(
            item.connectionId,
            item.alternateChannelIds,
            item.campaignId,
            item.rotationIndex
        );
        if (failoverId && failoverId !== item.connectionId) {
            emitCampaignLog(
                'WARN',
                `Chip ${item.connectionId} indisponível/isolado — alternando para ${failoverId} antes do envio`,
                { campaignId: item.campaignId, de: item.connectionId, para: failoverId, to: item.to },
                campaignState?.ownerUid
            );
            item.connectionId = failoverId;
            await job.updateData(item).catch(() => {});
            await job.moveToDelayed(Date.now() + 2000, token);
            throw new DelayedError();
        }
    }

    // Bloqueia chips em quarentena (recuperados de ban) para proteger contra novo bloqueio
    const banInfoForJob = getConnectionBanInfo(item.connectionId);
    if (banInfoForJob.inQuarantine) {
        const remainMs = (banInfoForJob.quarantineUntil ?? 0) - Date.now();
        const remainH = Math.ceil(remainMs / 3_600_000);
        const connLabel = connections.get(item.connectionId)?.friendlyName || item.connectionId;
        emitCampaignLog(
            'WARN',
            `Canal ${connLabel} em QUARENTENA (recuperado de ban). Aguarde mais ${remainH}h antes de usar em campanhas.`,
            { campaignId: item.campaignId, to: item.to, connectionId: item.connectionId },
            campaignState?.ownerUid
        );
        await job.moveToDelayed(Date.now() + Math.min(remainMs, 3_600_000), token);
        throw new DelayedError();
    }

    const conn = connections.get(item.connectionId);
    if (conn && !item.nurtureFollowUp) {
        checkAndResetDailyLimits(conn);

        const dailyLimit = conn.dailyLimit || 0;
        const sentToday = conn.messagesSentToday || 0;

        if (dailyLimit > 0 && sentToday >= dailyLimit && !conn.limitExceededApproved) {
            log('info', `[Limits] Conexão ${item.connectionId} atingiu o limite diário de ${dailyLimit} mensagens.`);

            if (conn.limitAction === 'redirect') {
                const owner = resolveOwnerUid(item.connectionId);
                const altConn = Array.from(connections.values()).find((c) => {
                    if (c.instanceName === item.connectionId) return false;
                    if (c.status !== 'open') return false;
                    if (resolveOwnerUid(c.instanceName) !== owner) return false;
                    
                    checkAndResetDailyLimits(c);
                    const cLimit = c.dailyLimit || 0;
                    const cSent = c.messagesSentToday || 0;
                    return cLimit === 0 || cSent < cLimit;
                });

                if (altConn) {
                    log('info', `[Limits] Redirecionando envio do canal ${item.connectionId} para o canal ${altConn.instanceName} devido ao limite atingido.`);
                    emitCampaignLog(
                        'WARN',
                        `Limite diário atingido no canal ${conn.friendlyName || item.connectionId}. Redirecionando envio para o canal ${altConn.friendlyName || altConn.instanceName}.`,
                        { campaignId: item.campaignId, to: item.to, connectionId: item.connectionId },
                        campaignState?.ownerUid
                    );
                    
                    item.connectionId = altConn.instanceName;
                    await job.updateData(item).catch(() => {});
                    await job.updateProgress({ redirectedTo: altConn.instanceName });
                    await job.moveToDelayed(Date.now() + 2000, token);
                    throw new DelayedError();
                } else {
                    log('warn', `[Limits] Canal ${item.connectionId} excedeu o limite e limitAction é 'redirect', mas nenhuma conexão alternativa saudável foi encontrada. Tratando como 'ask'.`);
                }
            }

            emitCampaignLog(
                'ERROR',
                `Envio suspenso no canal ${conn.friendlyName || item.connectionId}. Limite diário de ${dailyLimit} mensagens foi atingido. Defina uma ação ou aprove a continuação nas configurações da conexão.`,
                { campaignId: item.campaignId, to: item.to, connectionId: item.connectionId },
                campaignState?.ownerUid
            );
            
            const owner = resolveOwnerUid(item.connectionId);
            if (owner) {
                publishOwnerEvent(owner, 'connection-limit-exceeded', {
                    connectionId: item.connectionId,
                    dailyLimit,
                    messagesSentToday: sentToday,
                    campaignId: item.campaignId
                });
            }

            // Adiar até meia-noite (reset diário) em vez de 15s em loop infinito.
            // DelayedError não conta como attempt — sem limite de tentativas, o loop de 15s
            // mantinha os jobs "pending" para sempre. Agora retenta 1× por dia.
            item._limitDelayCount = (item._limitDelayCount || 0) + 1;
            if (item._limitDelayCount > 3) {
                // Após 3 dias esperando e limite ainda excedido → falha definitiva
                throw new Error(
                    `Limite diário atingido no canal ${conn.friendlyName || item.connectionId} por ${item._limitDelayCount} dias consecutivos. Aumente o limite ou adicione outro chip.`
                );
            }
            await job.updateData(item).catch(() => {});
            // Calcula ms até a próxima meia-noite (fuso Brasil UTC-3)
            const nowBr = new Date(Date.now() - 3 * 3600_000);
            const msBrMidnight = (24 - nowBr.getUTCHours()) * 3600_000 - nowBr.getUTCMinutes() * 60_000 - nowBr.getUTCSeconds() * 1000;
            await job.moveToDelayed(Date.now() + Math.max(msBrMidnight, 60_000), token);
            throw new DelayedError();
        }
    }

    if (!(await isConnectionOpen(item.connectionId))) {
        const failoverId = await pickHealthyFailoverChannel(
            item.connectionId,
            item.alternateChannelIds,
            item.campaignId,
            item.rotationIndex
        );
        if (failoverId && failoverId !== item.connectionId) {
            emitCampaignLog(
                'WARN',
                `Chip ${item.connectionId} offline — alternando para ${failoverId} antes do envio`,
                { campaignId: item.campaignId, de: item.connectionId, para: failoverId, to: item.to },
                campaignState?.ownerUid
            );
            item.connectionId = failoverId;
            await job.updateData(item).catch(() => {});
            await job.moveToDelayed(Date.now() + 2000, token);
            throw new DelayedError();
        }
        item._offlineDelayCount = (item._offlineDelayCount || 0) + 1;
        if (item._offlineDelayCount >= 5) {
            const connLabel = connections.get(item.connectionId)?.friendlyName || item.connectionId;
            const stallMsg = `Campanha pausada: chip ${connLabel} offline no servidor. Reconecte em Conexões e clique em Retomar.`;
            emitCampaignLog(
                'WARN',
                stallMsg,
                { campaignId: item.campaignId, connectionId: item.connectionId, to: item.to },
                campaignState?.ownerUid
            );
            if (item.campaignId) {
                pauseCampaign(item.campaignId, campaignState?.ownerUid);
            }
            await job.moveToDelayed(Date.now() + 300_000, token);
            throw new DelayedError();
        }
        if (item._offlineDelayCount > 180) {
            const state = await getConnectionState(item.connectionId);
            throw new Error(
                `Nenhum chip do grupo conectado após várias tentativas (${item.connectionId}, ${state})`
            );
        }
        emitCampaignLog(
            'WARN',
            `Grupo sem chip conectado — reagenda em 2 min (tentativa ${item._offlineDelayCount})`,
            { campaignId: item.campaignId, connectionId: item.connectionId, to: item.to },
            campaignState?.ownerUid
        );
        await job.updateData(item).catch(() => {});
        await job.moveToDelayed(Date.now() + 120_000, token);
        throw new DelayedError();
    }

    const normalizedDest = normalizeOutboundNumber(item.to);
    if (!normalizedDest) {
        return await failCampaignSend(job, item, item.to, `Número inválido: ${item.to}`, campaignState);
    }

    const resolvedOutbound = await resolveOutboundNumberForSend(item.connectionId, item.to);
    if ('error' in resolvedOutbound) {
        return await failCampaignSend(job, item, normalizedDest, resolvedOutbound.error, campaignState);
    }
    const sendTo = resolvedOutbound.number;

    // ── Limite de frequência: não reenviar para o mesmo contato em 24 h ───────
    if (
        item.campaignId &&
        !item.skipFrequencyCap &&
        !isCampaignFlowContinuation(item) &&
        (await checkFrequencyCap(campaignState?.ownerUid, item.to))
    ) {
        log('info', `[freq-cap] Contato ${normalizedDest} já recebeu mensagem nas últimas 24 h — pulando`, {
            campaignId: item.campaignId, to: normalizedDest,
        });
        emitCampaignLog(
            'WARN',
            `Contato ${normalizedDest} ignorado: já recebeu mensagem nas últimas 24 h`,
            { campaignId: item.campaignId, to: normalizedDest, skipReason: 'frequency_cap' },
            campaignState?.ownerUid
        );
        bumpQueueSize(item.connectionId, -1);
        await skipCampaignJobOnce(job, item);
        return;
    }
    // ──────────────────────────────────────────────────────────────────────────

    if (ownerUidForJob && item.to) {
        if (await isContactOptedOut(ownerUidForJob, item.to, getSharedRedis())) {
            emitCampaignLog(
                'WARN',
                `Contato ${item.to} está na lista negra (opt-out) — envio cancelado.`,
                { campaignId: item.campaignId, to: item.to, skipReason: 'opt_out' },
                campaignState?.ownerUid
            );
            bumpQueueSize(item.connectionId, -1);
            await skipCampaignJobOnce(job, item);
            return;
        }
    }

    log('info', 'Tentando envio', {
        toNormalized: sendTo,
        toOriginal: item.to,
        connectionId: item.connectionId,
        campaignId: item.campaignId,
    });
    emitCampaignLog(
        'INFO',
        `Enviando para ${sendTo}`,
        { campaignId: item.campaignId, to: sendTo, connectionId: item.connectionId },
        campaignState?.ownerUid
    );

    let mediaToSend = item.media;
    const mediaLookup = item.mediaLookupKey || item.campaignId;
    if (item.sendAsMedia && mediaLookup && campaignMediaById.has(mediaLookup)) {
        const meta = campaignMediaById.get(mediaLookup)!;
        if ((meta as any)._diskPath) {
            // Lê do arquivo temporário em disco (não fica base64 em RAM).
            mediaToSend = loadCampaignMediaFromDisk(
                (meta as any)._diskPath,
                meta.mimeType,
                meta.fileName,
                meta.caption
            ) ?? meta;
        } else {
            mediaToSend = meta;
        }
    }

    const hasMediaPayload = Boolean(mediaToSend?.base64 || mediaToSend?.url);
    const textPayload = String(item.message || '').trim();
    if (!hasMediaPayload && !textPayload) {
        throw new Error('Mensagem vazia após personalização — verifique variáveis e spintax');
    }

    let sendResult: { ok: boolean; messageId?: string; errorDetail?: string } = { ok: false };
    if (hasMediaPayload) {
        if (mediaToSend.url) {
            sendResult = await sendMediaByUrlInternal(
                item.connectionId,
                sendTo,
                mediaToSend.url,
                mediaToSend.mimeType,
                mediaToSend.fileName,
                mediaToSend.caption || item.message
            );
        } else if (mediaToSend.base64) {
            sendResult = await sendMediaInternal(
                item.connectionId,
                sendTo,
                mediaToSend.base64,
                mediaToSend.mimeType,
                mediaToSend.fileName,
                mediaToSend.caption || item.message
            );
        }
    } else {
        const composeMs = computeComposingDelayMs(textPayload);
        await sendPresenceComposing(item.connectionId, sendTo, composeMs);
        sendResult = await sendMessageInternal(item.connectionId, sendTo, item.message);
    }

    const cb = getChipCircuitBreaker();
    await cb.recordSent(item.connectionId);

    if (!sendResult.ok) {
        const detail = String(sendResult.errorDetail || '');
        if (/\b4\d{2}\b/.test(detail) || /401|403|429/.test(detail)) {
            await cb.recordFail4xx(item.connectionId);
            void maybeNotifyCircuitBreakerOpen(item.connectionId, campaignState?.ownerUid || item.ownerUid);
            void maybeNotifyCircuitBreakerHalfOpen(item.connectionId, campaignState?.ownerUid || item.ownerUid);
        }
        // Failover silencioso: tenta chips alternativos do pool antes de lançar erro.
        const alternates = Array.isArray(item.alternateChannelIds) ? item.alternateChannelIds : [];
        if (alternates.length > 1) {
            const originalId = item.connectionId;
            const tried = new Set<string>([originalId]);
            let switched = false;
            for (let step = 0; step < alternates.length; step++) {
                const altId = await pickDispatchChannel({
                    campaignId: item.campaignId,
                    currentId: originalId,
                    alternateIds: alternates,
                    rotationIndex: (item.rotationIndex ?? 0) + step + 1,
                    preferCurrent: false,
                    isChannelUsable: isCampaignChannelUsable,
                });
                if (!altId || tried.has(altId)) continue;
                tried.add(altId);
                if (!(await isCampaignChannelHealthy(altId))) continue;
                emitCampaignLog(
                    'WARN',
                    `Chip ${originalId} falhou — alternando para ${altId} (failover automático)`,
                    { campaignId: item.campaignId, de: originalId, para: altId },
                    campaignState?.ownerUid
                );
                item.connectionId = altId;
                await job.updateData(item).catch(() => {});
                const altRetry = item.media
                    ? await sendMediaInternal(
                          altId,
                          sendTo,
                          item.media.base64 || '',
                          item.media.mimeType,
                          item.media.fileName,
                          item.media.caption || item.message
                      )
                    : await (async () => {
                          await sendPresenceComposing(altId, sendTo, computeComposingDelayMs(textPayload));
                          return sendMessageInternal(altId, sendTo, item.message);
                      })();
                if (altRetry.ok) {
                    sendResult = altRetry;
                    switched = true;
                    break;
                }
            }
            if (!switched) {
                if (campaignState && item.campaignId) {
                    await runCampaignDispatchGuard(item, campaignState);
                }
                const errDetail = sendResult.errorDetail || 'Todos os chips do pool falharam';
                return await failCampaignSend(
                    job,
                    item,
                    sendTo,
                    `${errDetail} (todos os chips tentados)`,
                    campaignState
                );
            }
        } else {
            const errDetail = sendResult.errorDetail || 'Evolution API não confirmou entrega';
            return await failCampaignSend(job, item, sendTo, errDetail, campaignState);
        }
    }

    // Marca envio OK antes de qualquer lógica pós-envio: se o processo cair aqui,
    // o retry do BullMQ detecta _sentOk=true e não reenvia (idempotência).
    item._sentOk = true;
    await job.updateData(item).catch(() => {});
    await cb.recordDeliveredAck(item.connectionId);

    // Espelha sucesso no PG (auditoria + recovery)
    void finalizeCampaignJob(job.id ?? '', { status: 'sent' }).catch(() => undefined);

    // Registra timestamp de envio para o limitador de frequência (24 h).
    if (!item.nurtureFollowUp) {
        await recordFrequencyCap(campaignState?.ownerUid, item.to);
    }

    if (conn && !item.nurtureFollowUp) {
        conn.messagesSentToday = (conn.messagesSentToday || 0) + 1;
        recordConnectionDispatch(item.connectionId);
        mergeConnectionSettingsCache(item.connectionId, {
            dailyLimit: conn.dailyLimit,
            growthRate: conn.growthRate,
            growthType: conn.growthType,
            limitAction: conn.limitAction,
            messagesSentToday: conn.messagesSentToday,
            limitExceededApproved: conn.limitExceededApproved,
            lastLimitResetDate: conn.lastLimitResetDate,
            ownerUid: conn.ownerUid,
            friendlyName: conn.friendlyName,
        });
        saveConnectionsSettings();
        
        const ownerUid = resolveOwnerUid(item.connectionId);
        if (ownerUid) {
            publishOwnerEvent(ownerUid, 'connections-update', filterByConnectionScope(ownerUid, getConnections()));
        }
    }

    const phoneDigits = normalizePhoneKey(item.to);
    if (item.campaignId && sendResult.ok) {
        const funnelOwner =
            campaignState?.ownerUid ||
            item.ownerUid ||
            item.replyFlowOpen?.ownerUid ||
            resolveOwnerUid(item.connectionId);
        evolutionTrackMessageSent(
            sendResult.messageId,
            item.connectionId,
            phoneDigits,
            item.campaignId,
            funnelOwner
        );
        const campaignText =
            mediaToSend?.caption || item.message || '[mídia]';
        const campaignMsgType: ChatMessage['type'] = mediaToSend
            ? mediaToSend.mimeType?.startsWith('image/')
                ? 'image'
                : mediaToSend.mimeType?.startsWith('video/')
                  ? 'video'
                  : mediaToSend.mimeType?.startsWith('audio/')
                    ? 'audio'
                    : 'document'
            : 'text';
        try {
            chatStore.appendCampaignOutboundMessage({
                connectionId: item.connectionId,
                phoneDigits,
                messageId: sendResult.messageId,
                text: campaignText,
                campaignId: item.campaignId,
                messageType: campaignMsgType,
            });
        } catch (trackErr: unknown) {
            const errMsg = trackErr instanceof Error ? trackErr.message : String(trackErr);
            log('warn', 'Nao foi possivel registrar mensagem de campanha no chat', { errMsg });
        }
    }

    if (
        item.nurtureFollowUp &&
        item.nurtureEnrollmentId &&
        item.nurtureJourneyId &&
        sendResult.ok &&
        item.ownerUid
    ) {
        const journey = await loadJourneyByIdPg(item.ownerUid, item.nurtureJourneyId);
        if (journey) {
            void completeNurtureStepAfterSend({
                tenantId: item.ownerUid,
                enrollmentId: item.nurtureEnrollmentId,
                journeyId: item.nurtureJourneyId,
                sentStepIndex: item.nurtureStepIndex ?? 0,
                journeyDoc: journey.doc
            }).catch((e) =>
                log('warn', 'completeNurtureStepAfterSend falhou', { error: (e as Error)?.message })
            );
        }
        evolutionTrackManualMessageSent(
            sendResult.messageId,
            item.connectionId,
            phoneDigits,
            item.ownerUid
        );
    }

    const replyFlowStep =
        item.replyFlowOpen != null
            ? 1
            : item.replyFlowAfterSend != null
              ? item.replyFlowAfterSend.newAwaitingAfterStep + 1
              : undefined;
    emitCampaignLog(
        'INFO',
        'Mensagem enviada',
        {
            campaignId: item.campaignId,
            to: phoneDigits,
            connectionId: item.connectionId,
            ...(replyFlowStep != null ? { replyFlowStep } : {}),
        },
        campaignState?.ownerUid
    );

    ensureReplyFlowEngine();
    if (item.replyFlowOpen?.campaignId) {
        const remoteJid =
            phoneDigits.length >= 8 ? `${phoneDigits}@s.whatsapp.net` : undefined;
        replyFlowEngine.openSession({
            connectionId: item.connectionId,
            phoneDigits: item.replyFlowOpen.phoneDigits,
            campaignId: item.replyFlowOpen.campaignId,
            ownerUid: item.replyFlowOpen.ownerUid,
            vars: item.replyFlowOpen.vars,
            toRaw: item.to,
            convKey: `${item.connectionId}:${item.replyFlowOpen.phoneDigits}`,
            remoteJid,
        });
    }
    if (item.replyFlowAfterSend) {
        replyFlowEngine.updateSessionAfterSend(
            item.connectionId,
            item.replyFlowAfterSend.phoneDigits,
            item.replyFlowAfterSend.newAwaitingAfterStep
        );
    } else if (item.replyFlowDisposeAfterSend) {
        replyFlowEngine.confirmReplyFlowOutboundDelivered(
            item.connectionId,
            phoneDigits,
            true
        );
    }

    bumpQueueSize(item.connectionId, -1);

    // Motor multi-etapas lazy: agenda próxima etapa se houver stageConfigs.
    if (item.multiStepContact && item.campaignId) {
        const { contactId, stepIndex } = item.multiStepContact;
        const stageConfigs = campaignStageConfigsById.get(item.campaignId);
        if (stageConfigs && stageConfigs.length > 0) {
            await onStepCompleted({
                campaignId: item.campaignId,
                tenantId: campaignState?.ownerUid || item.ownerUid || '',
                contactId,
                completedStepIndex: stepIndex,
                stageConfigs,
                connectionId: item.connectionId,
                ownerUid: campaignState?.ownerUid || item.ownerUid,
                callbacks: {
                    enqueue: async (p) => {
                        await enqueueCampaignItem(
                            {
                                connectionId: p.connectionId,
                                to: item.to,
                                message: p.message,
                                campaignId: p.campaignId,
                                ownerUid: p.ownerUid,
                                stageIndex: p.stepIndex,
                                rotationIndex: item.rotationIndex,
                                sendAsMedia: campaignMediaById.has(p.campaignId),
                                multiStepContact: { contactId: p.contactId, stepIndex: p.stepIndex },
                            },
                            p.delayMs
                        );
                        // NÃO incrementar campaignPendingJobs aqui — enqueueCampaignItem já incrementa.
                        // O duplo incremento anterior inflava o contador e impedia a campanha de finalizar.
                    },
                    onLog: (msg, payload) => emitCampaignLog('INFO', msg, payload, campaignState?.ownerUid),
                    resolveConnectionId: () => item.connectionId,
                    resolveVars: (cid) => {
                        const cleaned = normalizePhoneKey(cid);
                        // Garante que as variáveis do contato (nome, etc.) são passadas para etapas seguintes
                        const state = campaignsById.get(item.campaignId || '');
                        const recipientVars = (state as any)?._recipientVars;
                        if (recipientVars instanceof Map) {
                            return recipientVars.get(cleaned) || {};
                        }
                        return buildRecipientVarsMap(undefined).get(cleaned) || {};
                    },
                    applyVars: (template, cid, vars) => applyMessageVars(template, cid, vars),
                    getDispatchDelayMs: () => dispatchSettings.minDelayMs,
                    publishEvent: (ownerUid, event, data) => publishOwnerEvent(ownerUid, event, data),
                },
            });
        }
    }

    await accountCampaignJobOnce(job, item, true);

    publishOwnerEvent(campaignState?.ownerUid, 'campaign:message-sent', {
        campaignId: item.campaignId,
        to: item.to,
        success: true,
    });

    const delay =
        dispatchSettings.minDelayMs +
        Math.random() * (dispatchSettings.maxDelayMs - dispatchSettings.minDelayMs);
    await new Promise((r) => setTimeout(r, delay));
}

async function sendMediaByUrlInternal(
    connectionId: string,
    to: string,
    mediaUrl: string,
    mimeType: string,
    fileName: string,
    caption?: string
): Promise<{ ok: boolean; messageId?: string; errorDetail?: string }> {
    const number = normalizeOutboundNumber(to);
    if (!number) {
        return { ok: false, errorDetail: `Número inválido: ${to}` };
    }

    let type = 'document';
    if (mimeType.startsWith('image/')) type = 'image';
    else if (mimeType.startsWith('video/')) type = 'video';
    else if (mimeType.startsWith('audio/')) type = 'audio';

    const variants = buildOutboundPhoneVariants(number);
    let lastResult: { ok: boolean; messageId?: string; errorDetail?: string } = { ok: false };

    for (let i = 0; i < variants.length; i++) {
        const tryNumber = variants[i];
        lastResult = await attemptEvolutionSendMedia(
            connectionId,
            tryNumber,
            to,
            { mediatype: type, mimetype: mimeType, caption: caption || '', media: mediaUrl, fileName }
        );
        if (lastResult.ok) return lastResult;
        if (i >= variants.length - 1 || !isRetryableOutbound400(lastResult.errorDetail)) break;
    }

    return lastResult;
}

/** Falha de envio: contabiliza uma vez e não re-tenta jobs irrecuperáveis (HTTP 400). */
async function failCampaignSend(
    job: Job<MessageQueueItem>,
    item: MessageQueueItem,
    destLabel: string,
    errDetail: string,
    campaignState?: CampaignRuntimeState
): Promise<never> {
    const msg = `Falha no envio para ${destLabel} — ${errDetail}`;
    emitCampaignLog(
        'ERROR',
        `Falha ao enviar para ${destLabel}`,
        {
            campaignId: item.campaignId,
            to: destLabel,
            connectionId: item.connectionId,
            error: errDetail,
        },
        campaignState?.ownerUid
    );

    bumpQueueSize(item.connectionId, -1);
    const unrecoverable = isUnrecoverableOutboundError(errDetail);
    if (
        unrecoverable &&
        item.replyFlowResponse &&
        (item.replyFlowDisposeAfterSend || item.replyFlowAfterSend)
    ) {
        ensureReplyFlowEngine();
        replyFlowEngine.rollbackPendingOutbound(item.connectionId, normalizePhoneKey(item.to));
    }
    await accountCampaignJobOnce(job, item, false);
    publishOwnerEvent(campaignState?.ownerUid, 'campaign:message-sent', {
        campaignId: item.campaignId,
        to: item.to,
        success: false,
        error: msg,
    });
    void finalizeCampaignJob(job.id ?? '', { status: 'dead', error: msg }).catch(() => undefined);
    if (item.campaignId && item.to) {
        void updateContactStateOnFailure(item.campaignId, item.to, msg);
    }

    if (isUnrecoverableOutboundError(errDetail)) {
        throw new UnrecoverableError(msg);
    }
    throw new Error(msg);
}

function ensureCampaignWorker() {
    const conn = getRedisConnection();
    if (!conn || campaignWorker) return;

    // Concorrência configurável via CAMPAIGN_WORKER_CONCURRENCY (default 10).
    // Cada job aguarda delay humano internamente, portanto aumentar a concorrência
    // não sobrecarrega a Evolution — apenas aumenta o throughput paralelo.
    // O limiter global limita a 20 jobs/segundo (burst ≤ 40) para evitar rate-limit.
    const concurrency = Math.max(1, Math.min(50, parseInt(process.env.CAMPAIGN_WORKER_CONCURRENCY || '10', 10)));
    campaignWorker = new Worker<MessageQueueItem>('campaign-messages', processCampaignJob, {
        connection: conn.duplicate(),
        concurrency,
        limiter: { max: 20, duration: 1000 },
    });

    attachWorkerStressGuard(campaignWorker, getCampaignBullmqRecovery());

    const q = getCampaignQueue();
    if (q) void trimBullmqQueue(q, 'campaign-messages');

    campaignWorker.on('failed', (job, err) => {
        const item = job?.data;
        log('error', 'Job de campanha falhou', {
            to: item?.to,
            connectionId: item?.connectionId,
            campaignId: item?.campaignId,
            error: err.message,
            attemptsMade: job?.attemptsMade,
        });

        // Atualiza espelho PG: failed ou dead dependendo de attempts restantes
        if (item && job) {
            const isDead = job.attemptsMade >= (job.opts.attempts || 1);
            void finalizeCampaignJob(job.id ?? '', { status: isDead ? 'dead' : 'failed', error: err.message }).catch(() => undefined);
        }

        if (item && job && job.attemptsMade >= (job.opts.attempts || 1)) {
            bumpQueueSize(item.connectionId, -1);
            if (item.replyFlowResponse && (item.replyFlowDisposeAfterSend || item.replyFlowAfterSend)) {
                ensureReplyFlowEngine();
                replyFlowEngine.rollbackPendingOutbound(item.connectionId, normalizePhoneKey(item.to));
            }
            if (item._sentOk || item._progressAccounted) {
                return;
            }
            finishCampaignJob(item.campaignId, false);
            const campaignState = item.campaignId ? campaignsById.get(item.campaignId) : undefined;
            publishOwnerEvent(campaignState?.ownerUid, 'campaign:message-sent', {
                campaignId: item.campaignId,
                to: item.to,
                success: false,
                error: err.message,
            });
            // Alerta definitivo após esgotar todos os retries — visível na UI em tempo real.
            publishOwnerEvent(campaignState?.ownerUid, 'campaign:job-dead', {
                campaignId: item.campaignId,
                to: item.to,
                connectionId: item.connectionId,
                error: err.message,
                stageIndex: item.stageIndex ?? 0,
                attemptsMade: job.attemptsMade,
            });
            if (io && campaignState?.ownerUid) {
                io.to(`user:${campaignState.ownerUid}`).emit('campaign:job-dead', {
                    campaignId: item.campaignId,
                    to: item.to,
                    connectionId: item.connectionId,
                    error: err.message,
                });
            }
            if (campaignState?.ownerUid) {
                void notifyTenant(
                    campaignState.ownerUid,
                    'campaign_job_dead',
                    {
                        campaignId: item.campaignId,
                        to: item.to,
                        connectionId: item.connectionId,
                        error: err.message,
                    },
                    'job_dead'
                );
            }
            emitCampaignLog(
                'ERROR',
                'Falha definitiva no envio (todos os retries esgotados)',
                {
                    campaignId: item.campaignId,
                    to: item.to,
                    connectionId: item.connectionId,
                    error: err.message,
                    attemptsMade: job.attemptsMade,
                    stageIndex: item.stageIndex ?? 0,
                },
                campaignState?.ownerUid
            );
            // Atualiza estado do contato no motor persistente (se disponível).
            if (item.campaignId && item.to) {
                void updateContactStateOnFailure(item.campaignId, item.to, err.message);
            }
        }
    });

    campaignWorker.on('completed', () => {
        /* contadores já ajustados no processCampaignJob */
    });

    log('info', 'Worker BullMQ de campanhas iniciado');
    scheduleReplyFlowRecovery();
}

function pickRemapConnectionForCampaign(
    item: MessageQueueItem,
    connectionIds: string[],
    strategy: PoolStrategy,
    channelWeights?: Record<string, number>
): string {
    const current = String(item.connectionId || '').trim();
    if (connectionIds.includes(current) && isCampaignChannelUsable(current)) {
        return current;
    }
    const usable = connectionIds.filter((id) => isCampaignChannelUsable(id));
    const pool = usable.length > 0 ? usable : connectionIds;
    return pickInitialDispatchChannel({
        strategy,
        connectionIds: pool,
        channelWeights,
        index: item.rotationIndex ?? 0,
    });
}

/**
 * Altera os chips de disparo de uma campanha em andamento/pausada.
 * Atualiza doc, runtime Redis, pool Redis e remapeia jobs pendentes na fila.
 */
export async function updateCampaignChannels(
    tenantId: string,
    campaignId: string,
    options: {
        connectionIds: string[];
        channelWeights?: Record<string, number>;
        poolStrategy?: PoolStrategy;
        remigratePendingJobs?: boolean;
    }
): Promise<{ ok: boolean; error?: string; remappedJobs?: number; onlineCount?: number }> {
    const cid = String(campaignId || '').trim();
    const rawIds = [...new Set((options.connectionIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (rawIds.length === 0) {
        return { ok: false, error: 'Selecione ao menos um chip.' };
    }

    const owned = await ensureTenantOwnsCampaign(tenantId, cid);
    if (!owned) return { ok: false, error: 'Campanha não encontrada.' };

    const tenantConns = getConnectionsForTenant(tenantId);
    const ownedSet = new Set(
        tenantConns.flatMap((c) => [c.id, c.instanceName].filter(Boolean) as string[])
    );
    const filtered = rawIds.filter((id) => ownedSet.has(id));
    if (filtered.length === 0) {
        return { ok: false, error: 'Nenhum chip pertence a esta conta.' };
    }

    const { getCampaign, mergeUpdateCampaign } = await import('./repositories/campaignsRepository.js');
    const campaign = await getCampaign(tenantId, cid);
    if (!campaign) return { ok: false, error: 'Campanha não encontrada.' };

    const status = String(campaign.status || '').toUpperCase();
    if (status === 'COMPLETED') {
        return { ok: false, error: 'Campanha já concluída — clone ou crie nova campanha.' };
    }

    const channelWeights = options.channelWeights ?? campaign.channelWeights;
    const poolStrategy = resolvePoolStrategy(
        options.poolStrategy ?? (campaign as { poolStrategy?: PoolStrategy }).poolStrategy,
        channelWeights
    );

    const docPatch: Record<string, unknown> = {
        selectedConnectionIds: filtered,
    };
    if (channelWeights && Object.keys(channelWeights).length > 0) {
        docPatch.channelWeights = channelWeights;
    }
    if (options.poolStrategy) docPatch.poolStrategy = options.poolStrategy;
    if (
        campaign.scheduleStartSnapshot &&
        typeof campaign.scheduleStartSnapshot === 'object'
    ) {
        docPatch.scheduleStartSnapshot = {
            ...campaign.scheduleStartSnapshot,
            connectionIds: filtered,
        };
    }
    await mergeUpdateCampaign(tenantId, cid, docPatch);

    let state = campaignsById.get(cid);
    if (!state) {
        await ensureCampaignRuntimeInMemory(cid, tenantId);
        state = campaignsById.get(cid);
    }
    if (state) {
        state.connectionIds = [...filtered];
        void saveCampaignRuntimeToRedis(cid);
    }

    await saveCampaignPoolConfig(cid, {
        strategy: poolStrategy,
        channelWeights: channelWeights || {},
        connectionIds: filtered,
    });

    let remappedJobs = 0;
    const queue = getCampaignQueue();
    if (queue && options.remigratePendingJobs !== false) {
        try {
            const jobs = await queue.getJobs(['waiting', 'delayed', 'paused']);
            for (const job of jobs) {
                const data = job.data as MessageQueueItem;
                if (String(data?.campaignId || '') !== cid) continue;
                const newConnId = pickRemapConnectionForCampaign(
                    data,
                    filtered,
                    poolStrategy,
                    channelWeights
                );
                const alt = filtered.length > 1 ? filtered : undefined;
                const altChanged =
                    JSON.stringify(alt ?? []) !== JSON.stringify(data.alternateChannelIds ?? []);
                if (newConnId !== data.connectionId || altChanged) {
                    await job.updateData({
                        ...data,
                        connectionId: newConnId,
                        alternateChannelIds: alt,
                    });
                    remappedJobs++;
                }
            }
        } catch (e: unknown) {
            log('warn', 'updateCampaignChannels: falha ao remapear jobs', {
                campaignId: cid,
                error: (e as Error)?.message,
            });
        }
    }

    const onlineCount = filtered.filter((id) => isCampaignChannelUsable(id)).length;

    emitCampaignLog(
        'INFO',
        `Chips da campanha atualizados (${filtered.length} chip(s), ${onlineCount} online, ${remappedJobs} job(s) remapeado(s))`,
        { campaignId: cid, connectionIds: filtered, remappedJobs, onlineCount },
        tenantId
    );

    publishOwnerEvent(tenantId, 'campaign-channels-updated', {
        campaignId: cid,
        connectionIds: filtered,
        remappedJobs,
        onlineCount,
    });

    return { ok: true, remappedJobs, onlineCount };
}

/**
 * Reenvia / retoma disparos na **mesma** campanha (falhos ou pendentes por etapa).
 */
export async function redispatchCampaign(
    tenantId: string,
    campaignId: string,
    options: {
        mode?: 'failed' | 'resume';
        connectionIds?: string[];
        phones?: string[];
        stepIndex?: number;
        skipFrequencyCap?: boolean;
    } = {}
): Promise<{ ok: boolean; enqueued: number; error?: string }> {
    const mode = options.mode || 'failed';
    const skipFrequencyCap = options.skipFrequencyCap !== false;

    const { getCampaign } = await import('./repositories/campaignsRepository.js');
    const campaign = await getCampaign(tenantId, campaignId);
    if (!campaign) return { ok: false, enqueued: 0, error: 'Campanha não encontrada.' };

    let pendingJobs = campaignPendingJobs.get(campaignId) || 0;
    const memState = campaignsById.get(campaignId);
    // Contador preso após conclusão impede reenvio — limpa quando a campanha não está mais ativa.
    if (pendingJobs > 0 && !memState?.isRunning) {
        campaignPendingJobs.delete(campaignId);
        pendingJobs = 0;
    }
    if (pendingJobs > 0 && memState?.isRunning) {
        return { ok: false, enqueued: 0, error: 'Campanha ainda em execução. Aguarde ou pause antes de reenviar.' };
    }

    pausedCampaigns.delete(campaignId);

    const stepIdx = typeof options.stepIndex === 'number' ? options.stepIndex : 0;

    const connectionIds =
        options.connectionIds?.length ? options.connectionIds : campaign.selectedConnectionIds || [];
    if (connectionIds.length === 0) {
        return { ok: false, enqueued: 0, error: 'Nenhum chip selecionado.' };
    }

    const activeConnectionIds = await filterActiveConnections(connectionIds);
    if (activeConnectionIds.length === 0) {
        return { ok: false, enqueued: 0, error: 'Nenhum chip online. Reconecte no painel de Conexões.' };
    }

    const redisOk = await pingRedisHealthy();
    if (!redisOk) {
        return { ok: false, enqueued: 0, error: 'Redis indisponível — disparo não pode ser retomado.' };
    }

    ensureCampaignWorker();

    let stageConfigs = campaignStageConfigsById.get(campaignId);
    if (!stageConfigs?.length && Array.isArray(campaign.stageConfigs)) {
        stageConfigs = campaign.stageConfigs.filter((s) => String(s?.body || '').trim().length > 0);
        if (stageConfigs.length) campaignStageConfigsById.set(campaignId, stageConfigs);
    }
    const useLazyMotor = Boolean(stageConfigs?.length);

    type Target = { phone: string; stepIndex: number };
    let targets: Target[] = [];

    if (usePostgresCampaigns()) {
        const { listContactsForRedispatch } = await import('./repositories/campaignContactStateRepository.js');
        const rows = await listContactsForRedispatch(campaignId, mode, options.stepIndex);
        targets = rows.map((r) => ({ phone: r.contactId, stepIndex: r.stepIndex }));
    }

    if (targets.length === 0) {
        const snap = await buildCampaignReportSnapshot(tenantId, campaignId);
        const failedRows = (snap?.rows || []).filter((r) => {
            const st = String(r.status || '').toUpperCase();
            return st === 'FAILED' || st === 'FAIL' || st === 'ERROR';
        });
        targets = failedRows.map((r) => ({
            phone: normalizePhoneKey(String(r.phone || '')),
            stepIndex: typeof options.stepIndex === 'number' ? options.stepIndex : 0,
        }));
    }

    if (mode === 'failed') {
        const { collectFailedRedispatchTargetsFromLogs } = await import('./campaignRedispatchTargets.js');
        const fromLogs = await collectFailedRedispatchTargetsFromLogs(tenantId, campaignId, stepIdx);
        if (fromLogs.length > 0) {
            const byKey = new Map<string, Target>();
            for (const t of [...targets, ...fromLogs]) {
                const k = `${normalizePhoneKey(t.phone)}@${t.stepIndex}`;
                if (normalizePhoneKey(t.phone).length >= 8) byKey.set(k, t);
            }
            targets = Array.from(byKey.values());
        }
    }

    targets = await refreshRedispatchTargetPhones(tenantId, targets);

    // Fluxo por resposta não grava campaign_contact_state — retomar via snapshot − enviados.
    if (targets.length === 0 && mode === 'resume') {
        const { resolveUnsentStep0TargetsFromSnapshot } = await import('./campaignRedispatchTargets.js');
        targets = await resolveUnsentStep0TargetsFromSnapshot(tenantId, campaignId, campaign);
    }

    if (options.phones?.length) {
        const allow = new Set(
            options.phones.map((p) => normalizePhoneKey(p)).filter((p) => p.length >= 8)
        );
        targets = targets.filter((t) => allow.has(normalizePhoneKey(t.phone)));
    }

    if (targets.length === 0 && mode === 'failed' && options.phones?.length) {
        targets = options.phones
            .map((p) => ({
                phone: normalizePhoneKey(p),
                stepIndex: stepIdx,
            }))
            .filter((t) => t.phone.length >= 10);
        targets = await refreshRedispatchTargetPhones(tenantId, targets);
    }

    const seen = new Set<string>();
    targets = targets.filter((t) => {
        const k = `${normalizePhoneKey(t.phone)}@${t.stepIndex}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return normalizePhoneKey(t.phone).length >= 8;
    });

    if (targets.length === 0) {
        return {
            ok: false,
            enqueued: 0,
            error:
                mode === 'failed'
                    ? 'Nenhum contato com falha para reenviar.'
                    : 'Nada pendente para retomar nesta campanha.',
        };
    }

    if (mode === 'failed') {
        try {
            const { resetFailedContactsAtStep } = await import(
                './repositories/campaignContactStateRepository.js'
            );
            await resetFailedContactsAtStep(campaignId, stepIdx);
        } catch {
            // campanhas só com logs/snapshot seguem sem PG
        }
    }

    const replyFlow = campaign.replyFlow;
    const sanitizedReplySteps =
        replyFlow?.enabled && Array.isArray(replyFlow.steps) && replyFlow.steps.length >= 1
            ? sanitizeReplyFlowSteps(replyFlow.steps)
            : [];
    const useReplyFlow = sanitizedReplySteps.length >= 1;
    if (useReplyFlow) {
        ensureReplyFlowEngine();
        replyFlowEngine.registerDef(campaignId, sanitizedReplySteps, sanitizeReplyFlowMeta(replyFlow));
    }

    const templates = (
        campaign.messageStages?.length ? campaign.messageStages : [campaign.message]
    )
        .map((t) => String(t || '').trim())
        .filter((t) => t.length > 0);

    const dispatchSettings = resolveCampaignDispatchSettings(tenantId, campaign.delaySeconds);
    const hasMedia = campaignMediaById.has(campaignId);
    const prev = campaignsById.get(campaignId);
    const recipientVars = prev?._recipientVars || buildRecipientVarsMap(undefined);
    const baseProcessed = prev?.processed ?? campaign.processedCount ?? 0;

    campaignsById.set(campaignId, {
        ownerUid: tenantId,
        total: baseProcessed + targets.length,
        processed: baseProcessed,
        successCount: prev?.successCount ?? campaign.successCount ?? 0,
        failCount: prev?.failCount ?? campaign.failedCount ?? 0,
        lastLoggedProcessed: prev?.lastLoggedProcessed ?? baseProcessed,
        isRunning: true,
        startedAt: prev?.startedAt ?? Date.now(),
        recentOutcomes: prev?.recentOutcomes ?? [],
        _recipientVars: recipientVars,
    });
    campaignPendingJobs.set(campaignId, (campaignPendingJobs.get(campaignId) || 0) + targets.length);
    void saveCampaignRuntimeToRedis(campaignId);

    let enqueued = 0;
    try {
        for (let i = 0; i < targets.length; i++) {
            const { phone, stepIndex } = targets[i];
            const cleanPhone = normalizePhoneKey(phone);
            const assignedConnectionId = activeConnectionIds[i % activeConnectionIds.length];
            const staggerDelay = i * dispatchSettings.minDelayMs;
            const vars = recipientVars.get(cleanPhone) || {};

            if (useLazyMotor && stageConfigs?.[stepIndex]) {
                const stage = stageConfigs[stepIndex];
                const personalizedMessage = applyMessageVars(stage.body, cleanPhone, vars, i);
                await enqueueCampaignItem(
                    {
                        connectionId: assignedConnectionId,
                        to: phone,
                        message: personalizedMessage,
                        campaignId,
                        ownerUid: tenantId,
                        stageIndex: stepIndex,
                        rotationIndex: i,
                        sendAsMedia: hasMedia && stepIndex === 0,
                        skipFrequencyCap,
                        multiStepContact: { contactId: cleanPhone, stepIndex },
                    },
                    staggerDelay
                );
            } else if (useReplyFlow && stepIndex === 0) {
                const personalizedMessage = applyMessageVars(sanitizedReplySteps[0].body, cleanPhone, vars, i);
                await enqueueCampaignItem(
                    {
                        connectionId: assignedConnectionId,
                        to: phone,
                        message: personalizedMessage,
                        campaignId,
                        ownerUid: tenantId,
                        rotationIndex: i,
                        sendAsMedia: hasMedia,
                        skipFrequencyCap,
                        replyFlowOpen: {
                            campaignId,
                            phoneDigits: cleanPhone,
                            vars,
                            ownerUid: tenantId,
                        },
                    },
                    staggerDelay
                );
            } else {
                const template = templates[stepIndex] || templates[0] || campaign.message;
                const personalizedMessage = applyMessageVars(template, cleanPhone, vars, i);
                await enqueueCampaignItem(
                    {
                        connectionId: assignedConnectionId,
                        to: phone,
                        message: personalizedMessage,
                        campaignId,
                        ownerUid: tenantId,
                        stageIndex: stepIndex,
                        rotationIndex: i,
                        sendAsMedia: hasMedia && stepIndex === 0,
                        skipFrequencyCap,
                    },
                    staggerDelay
                );
            }
            enqueued++;
        }

        emitCampaignLog(
            'INFO',
            `Reenvio na mesma campanha: ${enqueued} contato(s) (${mode})`,
            { campaignId, mode, enqueued, stepIndex: options.stepIndex },
            tenantId
        );
        void persistCampaignProgressToFirestore(
            tenantId,
            campaignId,
            prev?.successCount ?? campaign.successCount ?? 0,
            prev?.failCount ?? campaign.failedCount ?? 0,
            baseProcessed,
            'RUNNING'
        );
        publishOwnerEvent(tenantId, 'campaign-started', { total: enqueued, campaignId, redispatch: true });
        return { ok: true, enqueued };
    } catch (err: unknown) {
        campaignsById.delete(campaignId);
        campaignPendingJobs.delete(campaignId);
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, enqueued: 0, error: msg || 'Falha ao enfileirar reenvio.' };
    }
}

/**
 * Inicia campanha com suporte a multi-etapas, reply flow e channelWeights.
 * Quando `stageConfigs` está presente, inicializa o motor persistente por contato.
 */
export async function startCampaign(
    numbers: string[],
    messageTemplates: string[],
    connectionIds: string[],
    campaignId?: string,
    recipients?: CampaignRecipient[],
    replyFlow?: {
        enabled?: boolean;
        steps?: Array<{
            body?: string;
            acceptAnyReply?: boolean;
            validTokens?: string[];
            invalidReplyBody?: string;
            marketingEffect?: string;
            options?: Array<{ tokens?: string[]; reply?: string; marketingEffect?: string }>;
        }>;
    },
    ownerUid?: string,
    channelWeights?: Record<string, number>,
    media?: CampaignMediaPayload,
    followUpMedia?: CampaignMediaPayload,
    delaySeconds?: number,
    stageConfigs?: CampaignStageConfig[],
    skipFrequencyCap?: boolean,
    delaySecondsMax?: number,
    humanizedPauses?: boolean,
    dailySchedule?: {
        enabled: boolean;
        /** Dias da semana permitidos: 0=Dom 1=Seg … 6=Sáb. Ausente = todos os dias. */
        allowedWeekdays?: number[];
        timePeriodEnabled?: boolean;
        periods?: Array<{
            name: 'morning' | 'afternoon';
            pct: number;       // % da cota diária para este período
            startHour: number; // hora de início (0-23)
            endHour: number;   // hora de fim (0-23)
        }>;
        days: Array<{
            dayIndex: number;
            limitPerChannel: number;
        }>;
    },
    poolDispatch?: {
        strategy?: PoolStrategy;
        channelWeights?: Record<string, number>;
        poolId?: string;
    }
): Promise<boolean> {
    if (connectionIds.length === 0 || numbers.length === 0) return false;

    const cid = campaignId || `campaign_${Date.now()}`;

    const persistCampaignMediaPayload = (storageKey: string, payload?: CampaignMediaPayload) => {
        if (!storageKey || !payload) return;
        if (payload.base64) {
            const diskPath = saveCampaignMediaToDisk(storageKey, payload);
            if (diskPath) {
                campaignMediaById.set(storageKey, {
                    mimeType: payload.mimeType,
                    fileName: payload.fileName,
                    caption: payload.caption,
                    _diskPath: diskPath,
                } as CampaignMediaPayload & { _diskPath: string });
            } else {
                campaignMediaById.set(storageKey, payload);
            }
        } else if (payload.url) {
            campaignMediaById.set(storageKey, payload);
        }
    };
    persistCampaignMediaPayload(cid, media);
    persistCampaignMediaPayload(campaignMediaStorageKey(cid, 1), followUpMedia);

    const sanitizedReplySteps =
        Boolean(replyFlow?.enabled && Array.isArray(replyFlow?.steps) && replyFlow.steps.length >= 1)
            ? sanitizeReplyFlowSteps(replyFlow.steps)
            : [];
    const useReplyFlow = sanitizedReplySteps.length >= 1;

    const templates = messageTemplates.map((t) => String(t || '').trim()).filter((t) => t.length > 0);
    if (!useReplyFlow && templates.length === 0) return false;

    ensureReplyFlowEngine();
    ensureCampaignWorker();

    // Verificar Redis antes de enfileirar: se não responder, lança erro claro para o socket handler.
    const redisOk = await pingRedisHealthy();
    if (!redisOk) {
        const redisErr = 'Redis indisponível na VPS — reinicie o container: docker compose restart redis';
        emitCampaignLog('ERROR', redisErr, { campaignId: cid }, ownerUid);
        log('error', 'startCampaign abortado: Redis não respondeu ao ping', { campaignId: cid });
        throw new Error(redisErr);
    }

    if (useReplyFlow) {
        replyFlowEngine.registerDef(cid, sanitizedReplySteps, sanitizeReplyFlowMeta(replyFlow));
    }

    const activeConnectionIds = await filterActiveConnections(connectionIds);
    if (activeConnectionIds.length === 0) {
        const connErr = 'Nenhum chip respondeu — reconecte o WhatsApp no painel de Conexões e tente de novo.';
        emitCampaignLog('ERROR', connErr, { campaignId: cid }, ownerUid);
        throw new Error(connErr);
    }

    // Verifica se há stageConfigs → motor multi-etapas lazy (qualquer trigger_type)
    const validStageConfigs = Array.isArray(stageConfigs) && stageConfigs.length > 0
        ? stageConfigs.filter((s) => s?.body?.trim?.())
        : [];
    const useLazyMotor = validStageConfigs.length > 0;

    if (useLazyMotor) {
        campaignStageConfigsById.set(cid, validStageConfigs);
    }

    const stageCount = useReplyFlow ? sanitizedReplySteps.length : templates.length;
    // Motor lazy: total = número de contatos (cada contato conta como 1 job rastreado)
    const totalJobs = useLazyMotor
        ? numbers.length
        : numbers.length * (useReplyFlow ? 1 : stageCount);
    const recipientVars = buildRecipientVarsMap(recipients);
    const hasMedia = campaignMediaById.has(cid);

    const resolvedPoolWeights = poolDispatch?.channelWeights ?? channelWeights ?? {};
    const poolStrategy = resolvePoolStrategy(poolDispatch?.strategy, resolvedPoolWeights);
    const usePoolDispatch = !useReplyFlow && activeConnectionIds.length > 1;

    if (usePoolDispatch) {
        await saveCampaignPoolConfig(cid, {
            strategy: poolStrategy,
            channelWeights: resolvedPoolWeights,
            connectionIds: activeConnectionIds,
            poolId: poolDispatch?.poolId,
        });
    }

    campaignsById.set(cid, {
        ownerUid,
        total: totalJobs,
        processed: 0,
        successCount: 0,
        failCount: 0,
        lastLoggedProcessed: 0,
        isRunning: true,
        startedAt: Date.now(),
        connectionIds: [...activeConnectionIds],
        recentOutcomes: [],
        // Guarda variáveis dos destinatários para uso em etapas posteriores (multi-step/reply-flow)
        _recipientVars: recipientVars,
    });
    // Persiste runtime no Redis imediatamente para sobreviver a restarts.
    void saveCampaignRuntimeToRedis(cid);
    evolutionRegisterCampaign(cid, ownerUid);

    // Inicializa estado persistente para cada contato (motor multi-etapas).
    // Best-effort: falha silenciosa não bloqueia o envio.
    if (ownerUid && (useLazyMotor || validStageConfigs.length > 0)) {
        const cleanPhones = numbers.map((n) => normalizePhoneKey(n)).filter((p) => p.length >= 8);
        void initMultiStepContactStates(ownerUid, cid, cleanPhones);
    }

    const dispatchSettings = resolveCampaignDispatchSettings(ownerUid, delaySeconds, delaySecondsMax);

    // Intervalo médio para cálculo do stagger (ponto central da faixa min-max)
    const avgDelayMs = (dispatchSettings.minDelayMs + dispatchSettings.maxDelayMs) / 2;

    const dailyScheduleEnabled = dailySchedule?.enabled && Array.isArray(dailySchedule?.days) && dailySchedule.days.length > 0;
    if (dailyScheduleEnabled) {
        log('info', 'Campanha com cronograma diário — jobs espaçados pelos dias do plano', {
            campaignId: cid,
            days: dailySchedule?.days?.length,
            chips: activeConnectionIds.length,
        });
    }
    const enqueuedCountPerDayPerChannel: Record<string, Record<number, number>> = {};
    const enqueuedIndexPerDayPerChannel: Record<string, Record<number, number>> = {};

    try {
        for (let i = 0; i < numbers.length; i++) {
            const num = numbers[i];
            const cleanPhone = normalizePhoneKey(num);
            const vars = recipientVars.get(cleanPhone) || {};
            const assignedConnectionId = usePoolDispatch
                ? pickInitialDispatchChannel({
                      strategy: poolStrategy,
                      connectionIds: activeConnectionIds,
                      channelWeights: resolvedPoolWeights,
                      index: i,
                  })
                : activeConnectionIds[i % activeConnectionIds.length];

            let staggerDelay = 0;

            if (dailyScheduleEnabled && dailySchedule?.days) {
                if (!enqueuedCountPerDayPerChannel[assignedConnectionId]) {
                    enqueuedCountPerDayPerChannel[assignedConnectionId] = {};
                }
                if (!enqueuedIndexPerDayPerChannel[assignedConnectionId]) {
                    enqueuedIndexPerDayPerChannel[assignedConnectionId] = {};
                }

                let chosenDayIndex = 0;
                let dayFound = false;

                for (const dConfig of dailySchedule.days) {
                    const currentCount = enqueuedCountPerDayPerChannel[assignedConnectionId][dConfig.dayIndex] || 0;
                    if (currentCount < dConfig.limitPerChannel) {
                        chosenDayIndex = dConfig.dayIndex;
                        dayFound = true;
                        break;
                    }
                }

                if (!dayFound) {
                    const sortedDays = [...dailySchedule.days].sort((a, b) => b.dayIndex - a.dayIndex);
                    chosenDayIndex = sortedDays[0]?.dayIndex ?? 0;
                }

                enqueuedCountPerDayPerChannel[assignedConnectionId][chosenDayIndex] = (enqueuedCountPerDayPerChannel[assignedConnectionId][chosenDayIndex] || 0) + 1;
                const contactIndexInDay = enqueuedIndexPerDayPerChannel[assignedConnectionId][chosenDayIndex] || 0;
                enqueuedIndexPerDayPerChannel[assignedConnectionId][chosenDayIndex] = contactIndexInDay + 1;

                const jitterFactor = 0.75 + Math.random() * 0.5;
                let intraDayStagger = Math.round(contactIndexInDay * avgDelayMs * jitterFactor)
                    + (humanizedPauses && contactIndexInDay > 0 && contactIndexInDay % 30 === 0
                        ? Math.round((120_000 + Math.random() * 180_000))
                        : 0);

                const dayLimit = dailySchedule.days.find(d => d.dayIndex === chosenDayIndex)?.limitPerChannel ?? 100;
                staggerDelay = computeDailyScheduleDelayMs({
                    nowMs: Date.now(),
                    dayIndex: chosenDayIndex,
                    contactIndexInDay,
                    intraDayStaggerMs: intraDayStagger,
                    allowedWeekdays: dailySchedule.allowedWeekdays,
                    timePeriodEnabled: dailySchedule.timePeriodEnabled,
                    periods: dailySchedule.periods,
                    dayLimit,
                });
            } else {
                const jitterFactor = 0.75 + Math.random() * 0.5;
                staggerDelay = Math.round(i * avgDelayMs * jitterFactor)
                    + (humanizedPauses && i > 0 && i % 30 === 0
                        ? Math.round((120_000 + Math.random() * 180_000))
                        : 0);
            }

            if (useLazyMotor) {
                // Motor lazy: apenas etapa 0 enfileirada agora; etapas seguintes após conclusão/resposta
                const firstStage = validStageConfigs[0];
                const personalizedMessage = applyMessageVars(firstStage.body, cleanPhone, vars, i);
            await enqueueCampaignItem(
                {
                    connectionId: assignedConnectionId,
                    to: num,
                    message: personalizedMessage,
                    campaignId: cid,
                        ownerUid,
                        stageIndex: 0,
                        rotationIndex: i,
                    sendAsMedia: hasMedia,
                        multiStepContact: { contactId: cleanPhone, stepIndex: 0 },
                        skipFrequencyCap: skipFrequencyCap === true,
                        alternateChannelIds: activeConnectionIds.length > 1 ? activeConnectionIds : undefined,
                    },
                    staggerDelay
                );
            } else if (useReplyFlow) {
                const personalizedMessage = applyMessageVars(sanitizedReplySteps[0].body, cleanPhone, vars, i);
                await enqueueCampaignItem(
                    {
                        connectionId: assignedConnectionId,
                        to: num,
                        message: personalizedMessage,
                        campaignId: cid,
                        ownerUid,
                        rotationIndex: i,
                        sendAsMedia: hasMedia,
                        skipFrequencyCap: skipFrequencyCap === true,
                        alternateChannelIds: activeConnectionIds.length > 1 ? activeConnectionIds : undefined,
                    replyFlowOpen: {
                        campaignId: cid,
                        phoneDigits: cleanPhone,
                        vars,
                        ownerUid,
                    },
                },
                staggerDelay
            );
        } else {
            for (let stageIndex = 0; stageIndex < templates.length; stageIndex++) {
                    const personalizedMessage = applyMessageVars(templates[stageIndex], cleanPhone, vars, i);
                    // Delay entre etapas: usa o mesmo intervalo configurado entre contatos.
                    const interStageMinDelay = dispatchSettings.minDelayMs;
                    const stageDelay = staggerDelay + stageIndex * interStageMinDelay;
                await enqueueCampaignItem(
                    {
                        connectionId: assignedConnectionId,
                        to: num,
                        message: personalizedMessage,
                        campaignId: cid,
                            ownerUid,
                            stageIndex,
                            rotationIndex: i,
                        sendAsMedia: hasMedia && stageIndex === 0,
                            skipFrequencyCap: skipFrequencyCap === true,
                            alternateChannelIds: activeConnectionIds.length > 1 ? activeConnectionIds : undefined,
                    },
                    stageDelay
                );
            }
        }
        }

        emitCampaignLog(
            'INFO',
            'Campanha iniciada',
            {
                campaignId: cid,
                total: totalJobs,
                connections: activeConnectionIds.length,
                stages: stageCount,
                replyFlow: useReplyFlow,
            },
            ownerUid
        );
        publishOwnerEvent(ownerUid, 'campaign-started', { total: totalJobs, campaignId: cid });
        void import('./chipProtectionService.js').then((m) =>
            m.refreshEffectiveProtection(ownerUid)
        );
        // Garante status RUNNING no Firestore independente de o socket chegar ao frontend.
        void persistCampaignProgressToFirestore(ownerUid, cid, 0, 0, 0, 'RUNNING');
    } catch (err: any) {
        // Falha de enfileiramento (Redis fora, etc.): cancela campanha em RAM
        // e propaga para o socket handler avisar a UI.
        log('error', 'startCampaign falhou ao enfileirar — abortando', {
            campaignId: cid,
            error: err?.message,
        });
        campaignsById.delete(cid);
        publishOwnerEvent(ownerUid, 'campaign-error', {
            campaignId: cid,
            error: err?.message || 'Falha ao enfileirar mensagens da campanha.',
        });
        throw err;
    }

    return true;
}

/**
 * Inicialização do serviço
 */
async function reconcileConnectionHealth() {
    const onlineChips = [...connections.values()].filter((c) => c.status === 'open').length;
    if (onlineChips === 0) return;

    const entries = [...connections.entries()].filter(
        ([id]) => !connectionWatchTimers.has(id) && !qrWatchTimers.has(id)
    );
    await Promise.all(
        entries.map(async ([id, conn]) => {
            const cached = readCachedConnectionState(id, 12_000);
            const apiState = (
                cached ??
                (await getConnectionState(id, { timeoutMs: CONNECTION_STATE_PROBE_TIMEOUT_MS }))
            ).toLowerCase();
            const memState = conn.status;
            const paired = Boolean(conn.phoneNumber?.trim());

            if (isEvolutionOpenState(apiState) && memState !== 'open') {
                applyConnectionStateUpdate(id, 'open', {});
                return;
            }

            if (memState === 'connecting' || memState === 'created') {
                const pairingAge = Date.now() - (pairingStartedAt.get(id) ?? 0);
                if (isEvolutionOpenState(apiState)) {
                    applyConnectionStateUpdate(id, 'open', {});
                } else if (apiState === 'connecting') {
                    watchConnectionUntilOpen(id);
                } else if (apiState === 'close' && pairingAge > 50_000) {
                    log('info', `Health: pairing preso ${id} (${Math.round(pairingAge / 1000)}s)`);
                    applyConnectionStateUpdate(id, 'close', {});
                    if (paired) scheduleEvolutionAutoReconnect(id);
                }
                return;
            }

            if (memState === 'open' && !isEvolutionOpenState(apiState)) {
                log('info', `Health reconcile ${id}: mem=open api=${apiState}`);
                applyConnectionStateUpdate(id, apiState === 'connecting' ? 'connecting' : 'close', {});
                return;
            }

            if (paired && memState === 'close' && !isEvolutionOpenState(apiState) && !autoReconnectState.has(id)) {
                if (!isInDeployGraceWindow()) {
                    scheduleEvolutionAutoReconnect(id);
                }
            }
        })
    );

    try {
        const cb = getChipCircuitBreaker();
        await Promise.all(
            [...connections.keys()].map(async (id) => {
                const score = await cb.getHealthScore(id);
                circuitStateByConnection.set(id, score.state);
            })
        );
    } catch {
        /* opcional */
    }
}

export function init(socketIO: SocketIOServer) {
    io = socketIO;
    chatStore.init(socketIO, { notifyConversationsChanged: emitScopedConversationsUpdate });
    ensureReplyFlowEngine();
    initEvolutionWebhookQueue(handleWebhook);
        log('info', 'Evolution WhatsApp engine initialized', {
        engine: evolutionConfig.engine,
        apiUrl: evolutionConfig.apiUrl,
        webhookUrl: evolutionConfig.webhookUrl,
    });

    void normalizeConnectionOwnersInSettings().then(async () => {
        healAllOrphanConnectionOwners();
        const pruned = chatStore.pruneConversationsWithoutResolvableOwner(resolveOwnerUid);
        if (pruned > 0) {
            log('warn', 'Conversas sem ownerUid removidas do cache local', { pruned });
        }
        const { refreshTenantUsersCache } = await import('./reconcileConnectionOwners.js');
        await refreshTenantUsersCache();
        await hydrateInstancesFromEvolution();
        const reconciled = await autoReconcileConnectionOwners();
        if (reconciled.applied.length > 0 || reconciled.removed.length > 0) {
            log('warn', 'Isolamento: canais reatribuídos no boot', {
                applied: reconciled.applied,
                removed: reconciled.removed,
                errors: reconciled.errors,
            });
        } else if (reconciled.actions.length > 0 && reconciled.errors.length > 0) {
            log('warn', 'Isolamento: falha ao reatribuir canais', {
                actions: reconciled.actions.length,
                errors: reconciled.errors,
            });
        }
        await hydrateInstancesFromEvolution();
        healAllGenericConnectionFriendlyNames();
        return reconcileConnectionHealth();
    });
    if (!connectionHealthTimer) {
        const healthIntervalMs = isInDeployGraceWindow() ? 30_000 : 120_000;
        connectionHealthTimer = setInterval(() => {
            void reconcileConnectionHealth();
        }, healthIntervalMs);
        setTimeout(() => {
            if (!connectionHealthTimer) return;
            clearInterval(connectionHealthTimer);
            connectionHealthTimer = setInterval(() => {
                void reconcileConnectionHealth();
            }, 120_000);
        }, CAMPAIGN_RESUME_GRACE_MS);
    }
    testConnection();

    // Reconcilia jobs BullMQ ANTES de iniciar o worker para evitar race condition:
    // sem o await, campaignPendingJobs começa do zero enquanto o Redis ainda tem
    // jobs ativos — finishCampaignJob dispararia campaign-finished ao primeiro job,
    // fazendo a 2ª+ etapa nunca disparar e a campanha ser marcada COMPLETED prematuramente.
    void (async () => {
        await reconcilePendingJobsFromRedis();
        await waitForCampaignResumeGrace();
        await reconcileRunningCampaignsFromPostgres();
        ensureCampaignWorker();
    })();
}

async function waitForCampaignResumeGrace(): Promise<void> {
    const remaining = CAMPAIGN_RESUME_GRACE_MS - processUptimeMs();
    if (remaining <= 0) return;
    log('info', `Pós-deploy: aguardando ${Math.round(remaining / 1000)}s antes de retomar campanhas RUNNING`, {
        graceMinutes: Math.round(CAMPAIGN_RESUME_GRACE_MS / 60_000),
    });
    await sleep(remaining);
}

/** Campanhas RUNNING no Postgres sem runtime/jobs após restart — reidrata ou reenfileira. */
async function reconcileRunningCampaignsFromPostgres(): Promise<void> {
    try {
        const { listRunningCampaigns } = await import('./repositories/campaignsRepository.js');
        const { isZapmassPostgresConfigured } = await import('./db/postgres.js');
        if (!isZapmassPostgresConfigured()) return;

        const rows = await listRunningCampaigns(30);
        for (const row of rows) {
            const campaignId = String(row.id || '').trim();
            const tenantId = String(row.tenant_id || '').trim();
            if (!campaignId || !tenantId) continue;

            if (!campaignsById.has(campaignId)) {
                await ensureCampaignRuntimeInMemory(campaignId, tenantId);
            }
            const state = campaignsById.get(campaignId);
            if (state) {
                syncPausedCampaignFromRuntime(campaignId, state);
                if (!state.startedAt) state.startedAt = Date.now();
            }

            const pendingMem = campaignPendingJobs.get(campaignId) || 0;
            if (pendingMem > 0) continue;

            const queue = getCampaignQueue();
            let pendingQueue = 0;
            if (queue) {
                const jobs = await queue.getJobs(['active', 'waiting', 'delayed'], 0, 200);
                pendingQueue = jobs.filter((j) => j.data?.campaignId === campaignId).length;
            }
            if (pendingQueue > 0) {
                campaignPendingJobs.set(campaignId, pendingQueue);
                continue;
            }

            log('warn', `[reconcile] Campanha RUNNING ${campaignId} sem jobs — retomando do snapshot`, {
                tenantId,
            });
            await redispatchCampaign(tenantId, campaignId, { mode: 'resume', skipFrequencyCap: true });
        }
    } catch (e: unknown) {
        log('warn', '[reconcile] Falha ao reconciliar campanhas RUNNING do Postgres', {
            error: (e as Error)?.message,
        });
    }
}

/** Restaura campaignPendingJobs E campaignsById para campanhas com jobs ativos no Redis. */
async function reconcilePendingJobsFromRedis() {
    const queue = getCampaignQueue();
    if (!queue) return;
    try {
        const jobs = await queue.getJobs(['active', 'waiting', 'delayed']);
        // Agrupa: counts + ownerUid por campaignId
        const counts = new Map<string, number>();
        const ownerByC = new Map<string, string>();
        for (const j of jobs) {
            const cid = j.data?.campaignId;
            if (!cid) continue;
            counts.set(cid, (counts.get(cid) || 0) + 1);
            const uid = j.data?.ownerUid || j.data?.replyFlowOpen?.ownerUid;
            if (uid && !ownerByC.has(cid)) ownerByC.set(cid, uid);
        }

        for (const [cid, count] of counts) {
            if (!campaignPendingJobs.has(cid)) {
                campaignPendingJobs.set(cid, count);
                log('info', `[reconcile] Campanha ${cid}: ${count} jobs pendentes restaurados.`);
            }
            // Restaura campaignsById para que finishCampaignJob emita campaign-finished corretamente.
            if (!campaignsById.has(cid)) {
                await ensureCampaignRuntimeInMemory(cid, ownerByC.get(cid));
            }
            const restored = campaignsById.get(cid);
            if (restored) {
                syncPausedCampaignFromRuntime(cid, restored);
                if (!restored.startedAt) {
                    restored.startedAt = Date.now();
                }
            }
        }
    } catch (e: any) {
        log('warn', '[reconcile] Não foi possível reconciliar jobs do Redis:', { error: e?.message });
    }
}

const CAMPAIGN_STALL_MS = 120_000;
const campaignStallNotified = new Set<string>();

/**
 * Detecta campanhas RUNNING com 0 envios por >2 min e corrige ou pausa com motivo claro.
 */
export async function tickCampaignStallWatchdog(): Promise<void> {
    ensureCampaignWorker();
    const queue = getCampaignQueue();
    const now = Date.now();

    for (const [campaignId, state] of campaignsById.entries()) {
        if (!state.isRunning || state.processed > 0) continue;
        if (pausedCampaigns.has(campaignId) || state.protectionPaused) continue;

        const startedAt = state.startedAt ?? 0;
        if (startedAt > 0 && now - startedAt < CAMPAIGN_STALL_MS) continue;

        const pendingMem = campaignPendingJobs.get(campaignId) || 0;
        let pendingQueue = 0;
        if (queue) {
            try {
                const jobs = await queue.getJobs(['active', 'waiting', 'delayed'], 0, 400);
                pendingQueue = jobs.filter((j) => j.data?.campaignId === campaignId).length;
            } catch {
                pendingQueue = pendingMem;
            }
        }

        const pending = Math.max(pendingMem, pendingQueue);

        if (pending <= 0 && state.ownerUid) {
            if (campaignStallNotified.has(`${campaignId}:reenqueue`)) continue;
            campaignStallNotified.add(`${campaignId}:reenqueue`);
            log('warn', `[stall-watchdog] Campanha ${campaignId} sem jobs na fila — tentando retomar`, {
                ownerUid: state.ownerUid,
            });
            const result = await redispatchCampaign(state.ownerUid, campaignId, {
                mode: 'resume',
                skipFrequencyCap: true,
            });
            if (result.ok) {
                emitCampaignLog(
                    'INFO',
                    `Disparo retomado automaticamente (${result.enqueued} mensagem(ns) reenfileirada(s)).`,
                    { campaignId, enqueued: result.enqueued },
                    state.ownerUid
                );
                publishOwnerEvent(state.ownerUid, 'campaign-resumed', {
                    campaignId,
                    autoRecovery: true,
                    enqueued: result.enqueued,
                });
            } else {
                emitCampaignLog(
                    'WARN',
                    `Campanha sem progresso: ${result.error || 'falha ao reenfileirar'}. Pause e inicie de novo.`,
                    { campaignId },
                    state.ownerUid
                );
            }
            continue;
        }

        const connIds =
            state.connectionIds?.filter(Boolean) ||
            (pendingQueue > 0 ? [] : []);
        const usable = connIds.filter((id) => isCampaignChannelUsable(id));
        if (connIds.length > 0 && usable.length === 0) {
            const notifyKey = `${campaignId}:offline`;
            if (campaignStallNotified.has(notifyKey)) continue;
            campaignStallNotified.add(notifyKey);
            const stallMsg =
                'Campanha pausada: chip offline ou indisponível no servidor. Abra Conexões, reconecte o WhatsApp e clique em Retomar.';
            emitCampaignLog('WARN', stallMsg, { campaignId, connectionIds: connIds }, state.ownerUid);
            pauseCampaign(campaignId, state.ownerUid);
            publishOwnerEvent(state.ownerUid, 'campaign-stall-paused', {
                campaignId,
                reason: 'chip_offline',
                message: stallMsg,
            });
        }
    }
}

/**
 * Testa conectividade com Evolution API
 */
async function testConnection() {
    try {
        const response = await api.get('/instance/fetchInstances');
        log('info', '✅ Conectado à Evolution API', {
            instances: response.data?.length || 0,
        });
    } catch (error: any) {
        log('error', '❌ Erro ao conectar com Evolution API', {
            url: evolutionConfig.apiUrl,
            error: error.message,
        });
        log('error', '⚠️ CERTIFIQUE-SE de que Evolution API está rodando!');
    }
}

/**
 * Handler de webhooks (para receber eventos da Evolution API)
 */
const WEBHOOK_PROCESSING_TIMEOUT_MS = 10_000;

/** Enfileira webhook (BullMQ) ou processa na thread HTTP se Redis indisponível. */
export async function dispatchWebhook(event: unknown): Promise<{
  queued: boolean;
  processedSync?: boolean;
  reason?: string;
}> {
  const normalized = normalizeEvolutionGoWebhookIfNeeded(event, resolveGoWebhookConnectionId);
  return dispatchEvolutionWebhook(normalized);
}

/** Pipeline compartilhado: opt-out, fluxo por resposta, nutrição e lead quente. */
async function processInboundAutomationMessage(params: InboundProcessParams): Promise<void> {
    const {
        connectionId: instance,
        phoneDigits,
        bodyText,
        nonTextReply,
        incomingConvId,
        messageOwnerUid,
        dedupeKey,
        source,
    } = params;

    if (dedupeKey && (await isInboundAutomationProcessed(dedupeKey))) {
        return;
    }

    if (bodyText && messageOwnerUid) {
        const optedOut = await handleInboundOptOut({
            tenantId: messageOwnerUid,
            connectionId: instance,
            phoneDigits,
            bodyText,
            incomingConvId,
            sendText: async (convId, text) => {
                await sendMessage(convId, text);
            },
            cancelJobs: async (tenantId, phone) => {
                const queue = getCampaignQueue();
                if (!queue) return 0;
                return cancelCampaignJobsForPhone(
                    queue,
                    tenantId,
                    phone,
                    (campaignId) => campaignsById.get(campaignId)?.ownerUid
                );
            },
            onComplete: (payload) => {
                log('info', '[OptOut] Contato descadastrado via inbound', {
                    ...payload,
                    source,
                });
            },
        });
        if (optedOut) {
            if (dedupeKey) await markInboundAutomationProcessed(dedupeKey);
            return;
        }
    }

    ensureReplyFlowEngine();
    await tryRestoreReplyFlowSession(instance, phoneDigits);
    await replyFlowEngine.handleIncoming({
        connectionId: instance,
        phoneDigits,
        bodyText,
        nonTextReply,
        incomingConvId,
    });

    const ownerUidForBot = messageOwnerUid || resolveOwnerUid(instance);
    if (ownerUidForBot && incomingConvId) {
        const inboundGuard = await checkInboundAutomationAllowed(ownerUidForBot, instance);
        if (!inboundGuard.allowed) {
            log('info', `[inboundGuard] Automação bloqueada tenant=${ownerUidForBot}`, {
                reason: 'reason' in inboundGuard ? inboundGuard.reason : undefined,
                source,
            });
            if (dedupeKey) await markInboundAutomationProcessed(dedupeKey);
            return;
        }

        ensureNurtureEnqueue();
        const nurtureHandled = await handleNurtureIncoming({
            tenantId: ownerUidForBot,
            connectionId: instance,
            phoneDigits,
            bodyText,
            incomingConvId,
            hasReplyFlowSession: replyFlowEngine.hasSession(instance, phoneDigits),
            sendText: async (convId, text) => {
                await sendMessage(convId, text);
            },
        });
        if (!nurtureHandled) {
            const hasRecentCampaign = chatStore.hasRecentCampaignActivity(phoneDigits);
            if (!hasRecentCampaign) {
                void handleSupportBotIncoming({
                    tenantId: ownerUidForBot,
                    connectionId: instance,
                    phoneDigits,
                    bodyText,
                    incomingConvId,
                    hasReplyFlowSession: replyFlowEngine.hasSession(instance, phoneDigits),
                    sendText: async (convId, text) => {
                        await sendMessage(convId, text);
                    },
                });
            }
        }
    }

    const ownerUidForReply = messageOwnerUid || resolveOwnerUid(instance);
    if (ownerUidForReply && bodyText) {
        void onContactReply({
            tenantId: ownerUidForReply,
            contactId: phoneDigits,
            replyText: bodyText,
            stageConfigsResolver: (cid) => campaignStageConfigsById.get(cid),
            connectionId: instance,
            ownerUid: ownerUidForReply,
            callbacks: {
                enqueue: async (p) => {
                    await enqueueCampaignItem(
                        {
                            connectionId: p.connectionId,
                            to: phoneDigits,
                            message: p.message,
                            campaignId: p.campaignId,
                            ownerUid: p.ownerUid,
                            stageIndex: p.stepIndex,
                            rotationIndex: campaignRotationIndexFromPhone(phoneDigits),
                            sendAsMedia: campaignMediaById.has(p.campaignId),
                            multiStepContact: { contactId: p.contactId, stepIndex: p.stepIndex },
                        },
                        p.delayMs
                    );
                },
                onLog: (msg, payload) => emitCampaignLog('INFO', msg, payload, ownerUidForReply),
                resolveConnectionId: () => instance,
                resolveVars: () => ({}),
                applyVars: (template, cid, vars) => applyMessageVars(template, cid, vars),
                getDispatchDelayMs: () => getTenantDispatchSettings(ownerUidForReply).minDelayMs,
                publishEvent: (uid, event, data) => publishOwnerEvent(uid, event, data),
            },
        });
    }

    const replyResolved = resolveLatestCampaignForReply(instance, phoneDigits);
    const replyCampaignId =
        replyFlowEngine?.resolveCampaignIdForIncoming(instance, phoneDigits, incomingConvId) ||
        replyResolved.campaignId;
    const replyOwnerUid = messageOwnerUid || replyResolved.ownerUid;

    evolutionTrackIncomingReply(instance, phoneDigits, {
        campaignId: replyCampaignId,
        ownerUid: replyOwnerUid,
    });
    if (replyOwnerUid) {
        void tryAutoEnrollHotLead({
            tenantId: replyOwnerUid,
            phoneDigits,
            connectionId: instance,
            conversationId: incomingConvId,
            treatReplyAsHot: true,
        });
    }
    const replyPreview =
        String(bodyText || '').slice(0, 80) ||
        (nonTextReply ? '[resposta sem texto legível — mídia/botão/etc.]' : '');
    if (replyPreview) {
        logCampaignContactReply(instance, phoneDigits, replyPreview, replyCampaignId, replyOwnerUid);
    }

    if (dedupeKey) await markInboundAutomationProcessed(dedupeKey);
}

export async function handleWebhook(event: any) {
    // Garante que nenhum webhook trava o event loop indefinidamente (ex: Redis lento).
    const timeoutId = setTimeout(() => {
        log('warn', '[webhook] Timeout de 10s atingido — processamento cancelado', {
            event: String(event?.event || '').toUpperCase(),
            instance: event?.instance ?? event?.instanceName,
        });
    }, WEBHOOK_PROCESSING_TIMEOUT_MS);
    try {
        const instance = resolveInstanceName(event?.instance ?? event?.instanceName);
        const data = event?.data ?? event;
        const eventName = String(event?.event || '').toUpperCase().replace(/\./g, '_');

        switch (eventName) {
            case 'QRCODE_UPDATED': {
                const extracted = extractEvolutionQr({ qrcode: data }) || extractEvolutionQr(data);
                if (extracted && instance) {
                    log('info', `QR recebido via webhook para ${instance}`);
                    emitQrToFrontend(instance, extracted);
                } else {
                    log('warn', `QRCODE_UPDATED sem QR parseável`, { instance, hasData: Boolean(data) });
                }
                break;
            }

            case 'CONNECTION_UPDATE': {
                const rawState = parseConnectionStateFromData(data);
                applyConnectionStateUpdate(
                    instance,
                    rawState,
                    data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined
                );
                break;
            }

            case 'MESSAGES_UPSERT': {
                const messageOwnerUid = resolveOwnerUid(instance);
                if (!messageOwnerUid) {
                    log('warn', 'MESSAGES_UPSERT descartado — canal sem ownerUid', { instance });
                    break;
                }
                if (!connections.has(instance) && !connectionsSettingsCache[instance]) {
                    log('warn', 'MESSAGES_UPSERT descartado — instancia ausente neste container', {
                        instance,
                    });
                    break;
                }
                chatStore.handleWebhookMessage(instance, data);

                const items = normalizeEvolutionWebhookMessages(data);
                for (const msg of items) {
                    if (!msg?.key) continue;
                    const isFromMe = Boolean(msg.key.fromMe);
                    const remoteJid = String(msg.key.remoteJid || '');
                    const messageId = msg.key.id;

                    if (messageOwnerUid) {
                        publishOwnerEvent(messageOwnerUid, 'message-received', {
                        connectionId: instance,
                            message: msg,
                        });
                    } else if (!isFromMe) {
                        log('warn', 'message-received recebido para canal orfao - evento descartado', {
                            instance,
                    });
                }

                if (isFromMe && messageId) {
                        const msgRow = msg as Record<string, unknown>;
                        const rawStatus =
                            msgRow.status ??
                            (msgRow.update as Record<string, unknown> | undefined)?.status;
                        const evolutionStatus = parseEvolutionMessageStatus(rawStatus);
                        if (evolutionStatus != null) {
                            evolutionTrackMessageAck(String(messageId), evolutionStatus);
                            chatStore.updateMessageStatus(String(messageId), evolutionStatus);
                        }
                    metrics.totalSent++;
                        const sentOwnerUid = messageOwnerUid || resolveOwnerUid(instance);
                        publishOwnerEvent(sentOwnerUid, 'campaign-progress', {
                        successCount: metrics.totalSent,
                        connectionId: instance,
                    });
                        continue;
                    }

                    if (isFromMe || !remoteJid || remoteJid.endsWith('@g.us')) continue;

                    const phoneDigits = resolvePhoneDigitsFromEvolutionMessage(msg, chatStore, instance);
                    if (phoneDigits.length < 8) {
                        log('warn', 'Resposta recebida sem telefone resolvivel (LID?) — reply flow ignorado', {
                            instance,
                            remoteJid,
                            hasAlt: Boolean(msg.key.remoteJidAlt || msg.key.senderPn),
                        });
                        continue;
                    }

                    const payload = (msg.message || msg.messageContent || {}) as Record<string, unknown>;
                    const { bodyText, nonTextReply } = extractEvolutionMessageBody(payload);
                    const incomingConvId = buildEvolutionIncomingConvId(instance, remoteJid, phoneDigits);
                    const dedupeKey = buildInboundAutomationDedupeKey({
                        connectionId: instance,
                        messageId: messageId ? String(messageId) : undefined,
                        phoneDigits,
                        timestampMs: Number(msg.messageTimestamp) || Date.now(),
                        bodyText: bodyText || (nonTextReply ? '[non-text]' : ''),
                    });

                    void processInboundAutomationMessage({
                        connectionId: instance,
                        phoneDigits,
                        bodyText,
                        nonTextReply,
                        incomingConvId,
                        messageOwnerUid,
                        dedupeKey,
                        source: 'webhook',
                    });
                }
                break;
            }

            case 'MESSAGES_UPDATE': {
                for (const { messageId, status } of extractEvolutionMessageUpdates(data)) {
                    const evolutionStatus = parseEvolutionMessageStatus(status);
                    if (evolutionStatus == null) continue;
                    evolutionTrackMessageAck(messageId, evolutionStatus);
                    chatStore.updateMessageStatus(messageId, evolutionStatus);
                }
                break;
            }

            case 'PRESENCE_UPDATE': {
                chatStore.handlePresenceUpdate(
                    instance,
                    data,
                    typeof event?.date_time === 'string' ? event.date_time : undefined
                );
                break;
            }
        }

    } catch (error: any) {
        log('error', 'Erro ao processar webhook', { error: error.message });
    } finally {
        clearTimeout(timeoutId);
    }
}

// ================== GETTERS (compatibilidade com server.ts) ==================

export function getConnections(): WhatsAppConnection[] {
    const result: WhatsAppConnection[] = [];
    let seededConnectedSince = false;
    for (const [id, conn] of connections.entries()) {
        let status = ConnectionStatus.DISCONNECTED;
        if (conn.status === 'open') status = ConnectionStatus.CONNECTED;
        else if (conn.qrCode?.trim()) status = ConnectionStatus.QR_READY;
        else if (conn.status === 'connecting') status = ConnectionStatus.CONNECTING;
        else if (conn.status === 'created') status = ConnectionStatus.QR_READY;

        const banInfo = getConnectionBanInfo(id);
        const ownerUidForConn = resolveOwnerUid(id);
        const circuitState = circuitStateByConnection.get(id);
        const reconnectLongTail = Boolean(autoReconnectState.get(id)?.longTail);
        // Chip online sem timestamp (boot antigo / hydrate): inicia o relógio agora e persiste.
        if (status === ConnectionStatus.CONNECTED && !conn.lastOpenAt) {
            conn.lastOpenAt = Date.now();
            mergeConnectionSettingsCache(id, { connectedSince: conn.lastOpenAt });
            connections.set(id, conn);
            seededConnectedSince = true;
        }
        result.push({
            id,
            name: resolveDisplayFriendlyName(id, conn),
            ownerUid: resolveOwnerUid(id),
            phoneNumber: conn.phoneNumber || null,
            status,
            lastActivity: new Date().toLocaleString(),
            queueSize: connectionQueueSizes.get(id) || 0,
            messagesSentToday: conn.messagesSentToday || 0,
            signalStrength: 'STRONG',
            profilePicUrl: conn.profilePicUrl,
            batteryLevel: 100,
            banCount: banInfo.banCount,
            lastBannedAt: banInfo.lastBannedAt,
            lastBanReason: banInfo.lastBanReason,
            quarantineUntil: banInfo.quarantineUntil,
            ...(status === ConnectionStatus.CONNECTED && conn.lastOpenAt
                ? { connectedSince: conn.lastOpenAt }
                : {}),
            ...(conn.qrCode ? { qrCode: conn.qrCode } : {}),
            ...(conn.proxy?.host
                ? {
                      proxy: {
                          enabled: true,
                          host: conn.proxy.host,
                          port: String(conn.proxy.port),
                          protocol: conn.proxy.protocol || 'http',
                      },
                  }
                : {}),
            dailyLimit: conn.dailyLimit,
            growthRate: conn.growthRate,
            growthType: conn.growthType || 'fixed',
            limitAction: conn.limitAction || 'ask',
            limitExceededApproved: conn.limitExceededApproved || false,
            ...(circuitState && circuitState !== 'CLOSED' ? { circuitState } : {}),
            ...(reconnectLongTail ? { reconnectLongTail: true } : {}),
            ...(ownerUidForConn
                ? (() => {
                      const storm = getReconnectStormProgress(ownerUidForConn);
                      return storm.count >= 2 ? { reconnectStormProgress: storm } : {};
                  })()
                : {}),
        });
    }
    if (seededConnectedSince) saveConnectionsSettings();
    return result;
}

export function isMassCampaignEngineIdle(): boolean {
    for (const state of campaignsById.values()) {
        if (state.isRunning) return false;
    }
    let total = 0;
    for (const n of connectionQueueSizes.values()) total += n;
    return total === 0;
}

/**
 * Conta campanhas ativas (isRunning === true) do dono.
 * Campanhas pausadas não ocupam slot — permitem iniciar outra no plano Starter.
 */
export function countActiveCampaignsForOwner(ownerUid: string): number {
    return listActiveBlockingCampaignIdsForOwner(ownerUid).length;
}

/** IDs de campanhas que bloqueiam novo disparo (em execução, não pausadas). */
export function listActiveBlockingCampaignIdsForOwner(ownerUid: string): string[] {
    if (!ownerUid) return [];
    const ids: string[] = [];
    for (const [campaignId, state] of campaignsById.entries()) {
        if (!state.isRunning || state.ownerUid !== ownerUid) continue;
        if (pausedCampaigns.has(campaignId)) continue;
        ids.push(campaignId);
    }
    return ids;
}

export function getMetrics(): DashboardMetrics {
    return { ...metrics };
}

export function getConversations(): Conversation[] {
    return chatStore.getConversations();
}

export async function syncAllOpenChats(): Promise<void> {
    if (isGoWebhookInboxMode()) return;
    const tasks: Promise<number>[] = [];
    for (const [id, conn] of connections.entries()) {
        if (conn.status === 'open') {
            tasks.push(chatStore.syncChatsForConnection(id));
        }
    }
    await Promise.all(tasks);
    emitScopedConversationsUpdate();
}

/** Órfãos não são mais auto-vinculados no login — ver tryClaimUnownedLegacyConnection (só create). */
function claimOrphanConnectionsForOwner(_ownerUid: string): string[] {
    return [];
}

/** findChats só dos canais `open` do tenant — evita sync global e pipeline vazio por escopo. */
export async function syncOpenChatsForOwner(ownerUid: string): Promise<{
    syncedChats: string[];
    skippedNotOpen: string[];
    skippedNotOwned: string[];
    claimed: string[];
    conversationCounts: Record<string, number>;
}> {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') {
        await syncAllOpenChats();
        return { syncedChats: [], skippedNotOpen: [], skippedNotOwned: [], claimed: [], conversationCounts: {} };
    }

    await hydrateInstancesFromEvolution();
    const claimed = claimOrphanConnectionsForOwner(uid);
    const syncedChats: string[] = [];
    const skippedNotOpen: string[] = [];
    const skippedNotOwned: string[] = [];
    const conversationCounts: Record<string, number> = {};
    const tasks: Promise<void>[] = [];

    for (const [id] of connections.entries()) {
        if (!tenantOwnsConnection(uid, id)) {
            skippedNotOwned.push(id);
            continue;
        }
        if (!(await isConnectionOpen(id))) {
            skippedNotOpen.push(id);
            continue;
        }
        setupWebhook(id).catch((err) => {
            log('warn', 'setupWebhook falhou em syncOpenChatsForOwner', {
                connectionId: id,
                error: err?.message,
            });
        });
        syncedChats.push(id);
        if (!isGoWebhookInboxMode()) {
            tasks.push(
                chatStore.syncChatsForConnection(id).then((n) => {
                    conversationCounts[id] = n;
                })
            );
        }
    }

    if (tasks.length > 0) {
        await Promise.all(tasks);
    }
    const { socketConversationsPayload } = await import('./conversationsEmit.js');
    publishOwnerEvent(
        uid,
        'conversations-update',
        await socketConversationsPayload(uid, uid, chatStore.getConversations(), resolveConnectionOwnerUid)
    );

    if (syncedChats.length === 0 || Object.values(conversationCounts).every((n) => n === 0)) {
        log('warn', 'syncOpenChatsForOwner: nenhuma conversa 1:1 importada', {
            ownerUid: uid,
            syncedChats,
            skippedNotOpen,
            skippedNotOwned: skippedNotOwned.slice(0, 8),
            claimed,
            conversationCounts,
        });
    } else {
        log('info', 'syncOpenChatsForOwner: conversas importadas', {
            ownerUid: uid,
            syncedChats,
            claimed: claimed.length ? claimed : undefined,
            conversationCounts,
        });
    }

    return { syncedChats, skippedNotOpen, skippedNotOwned, claimed, conversationCounts };
}

export async function hydrateFirestoreChatArchiveForConversation(
    conversationId: string,
    historyLimit = 400
): Promise<{ ok: boolean; total: number; error?: string }> {
    return chatStore.hydrateChatArchiveForConversation(conversationId, historyLimit);
}

export async function loadChatHistory(
    conversationId: string,
    limit = 500,
    skipMedia = true
): Promise<{ ok: boolean; total: number; error?: string; messages?: ChatMessage[] }> {
    return chatStore.loadChatHistory(conversationId, limit, skipMedia);
}

export async function loadMessageMedia(
    conversationId: string,
    messageId: string
): Promise<{ ok: boolean; mediaUrl?: string; error?: string }> {
    return chatStore.loadMessageMedia(conversationId, messageId);
}

export async function markAsRead(conversationId: string): Promise<void> {
    await chatStore.markAsRead(conversationId);
}

export async function fetchConversationPicture(conversationId: string): Promise<string | null> {
    return chatStore.fetchConversationPicture(conversationId);
}

export function resolveConversationIdForPhone(connectionId: string, phoneDigits: string): string {
    return chatStore.resolveConversationIdForPhone(connectionId, phoneDigits);
}

/** Primeiro chip `open` do tenant (ou o preferido) para buscar foto por telefone. */
export function pickOpenConnectionForTenant(
    tenantUid: string,
    preferredConnectionId?: string
): string | null {
    const uid = String(tenantUid || '').trim();
    if (!uid) return null;
    const scoped = filterByConnectionScope(uid, getConnections());
    const open = scoped.filter((c) => c.status === ConnectionStatus.CONNECTED);
    if (preferredConnectionId && open.some((c) => c.id === preferredConnectionId)) {
        return preferredConnectionId;
    }
    return open[0]?.id ?? null;
}

export async function fetchProfilePictureForPhone(
    tenantUid: string,
    phoneDigits: string,
    preferredConnectionId?: string
): Promise<string | null> {
    const digits = String(phoneDigits || '').replace(/\D/g, '');
    if (digits.length < 10) return null;
    const connId = pickOpenConnectionForTenant(tenantUid, preferredConnectionId);
    if (!connId) return null;
    const conversationId = resolveConversationIdForPhone(connId, digits);
    return fetchConversationPicture(conversationId);
}

/** Carrega índice de nomes da agenda Evolution (findContacts paginado). */
export async function loadPhonebookNameIndexForConnection(
    connectionId: string
): Promise<PhonebookNameIndex> {
    const id = String(connectionId || '').trim();
    const index = createPhonebookNameIndex();
    if (!id) return index;
    const inst = evoInst(id);
    const tryExtract = (raw: unknown): unknown[] => extractEvolutionList(raw);
    for (let page = 1; page <= EVO_FIND_MAX_PAGES; page++) {
        try {
            const response = await api.post(
                `/chat/findContacts/${inst}`,
                evolutionFindPageQuery(page, EVO_FIND_PAGE_SIZE),
                { timeout: 60_000 }
            );
            const list = tryExtract(response.data);
            if (list.length === 0) break;
            for (const ct of list) {
                if (ct && typeof ct === 'object') {
                    indexPhonebookRow(index, ct as Record<string, unknown>);
                }
            }
            if (list.length < EVO_FIND_PAGE_SIZE) break;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Evolution] findContacts phonebook ${id} p${page}:`, msg);
            break;
        }
    }
    return index;
}

function findConversationDisplayName(connectionId: string, phoneDigits: string): string | undefined {
    const digits = normalizePhoneDigits(phoneDigits);
    if (digits.length < 10) return undefined;
    const keys = new Set(buildPhoneDigitLookupKeys(digits));
    keys.add(digits);
    for (const c of getConversations()) {
        if (c.connectionId && c.connectionId !== connectionId) continue;
        const phone = normalizePhoneDigits(c.contactPhone || '');
        if (phone.length >= 10) {
            const hit = [...buildPhoneDigitLookupKeys(phone)].some((k) => keys.has(k));
            if (hit) {
                const name =
                    filterEvolutionContactLabel((c as { waContactName?: string }).waContactName) ||
                    filterEvolutionContactLabel(c.contactName);
                if (name) return name;
            }
        }
        const fromId = String(c.id || '').split(':').slice(1).join(':');
        const jidDigits = normalizePhoneDigits(fromId.split('@')[0] || '');
        if (jidDigits.length >= 10 && jidDigits.length <= 13) {
            if ([...buildPhoneDigitLookupKeys(jidDigits)].some((k) => keys.has(k))) {
                const name =
                    filterEvolutionContactLabel((c as { waContactName?: string }).waContactName) ||
                    filterEvolutionContactLabel(c.contactName);
                if (name) return name;
            }
        }
    }
    return undefined;
}

async function fetchProfileDisplayName(connectionId: string, phoneDigits: string): Promise<string | undefined> {
    const digits = normalizePhoneDigits(phoneDigits);
    if (digits.length < 10) return undefined;
    const inst = evoInst(connectionId);
    const candidates = [`${digits}@s.whatsapp.net`, digits];
    for (const number of candidates) {
        try {
            const response = await api.post(`/chat/fetchProfile/${inst}`, { number }, { timeout: 12_000 });
            const data = response?.data;
            const row =
                data && typeof data === 'object'
                    ? ((data as { data?: unknown }).data && typeof (data as { data?: unknown }).data === 'object'
                          ? ((data as { data: Record<string, unknown> }).data)
                          : (data as Record<string, unknown>))
                    : null;
            const name = evolutionContactDisplayName(row);
            if (name) return name;
        } catch {
            /* tenta próximo formato */
        }
    }
    return undefined;
}

/**
 * Resolve nome de exibição WA para um telefone:
 * agenda do chip → conversas em memória → fetchProfile.
 */
export async function resolveWaDisplayNameForPhone(
    tenantUid: string,
    phoneDigits: string,
    opts?: {
        connectionId?: string;
        phonebookIndex?: PhonebookNameIndex | null;
        /** Lote grande: não chama fetchProfile (lento e derruba a API). */
        skipProfile?: boolean;
    }
): Promise<{ name: string | null; source: 'phonebook' | 'conversation' | 'profile' | null }> {
    const digits = normalizePhoneDigits(phoneDigits);
    if (digits.length < 10) return { name: null, source: null };
    const connId = pickOpenConnectionForTenant(tenantUid, opts?.connectionId);
    if (!connId) return { name: null, source: null };

    const index = opts?.phonebookIndex ?? null;
    if (index) {
        const book = resolvePhonebookName(index, {
            remoteJid: `${digits}@s.whatsapp.net`,
            contactPhone: digits,
        });
        if (book) return { name: book, source: 'phonebook' };
    } else {
        // Lookup pontual por JID (mais barato que varrer a agenda inteira)
        try {
            const response = await api.post(`/chat/findContacts/${evoInst(connId)}`, {
                where: { id: `${digits}@s.whatsapp.net` },
                page: 1,
                limit: 5,
            });
            const list = Array.isArray(response.data)
                ? response.data
                : Array.isArray(response.data?.contacts)
                  ? response.data.contacts
                  : Array.isArray(response.data?.data)
                    ? response.data.data
                    : [];
            for (const row of list) {
                if (!row || typeof row !== 'object') continue;
                const name = evolutionContactDisplayName(row as Record<string, unknown>);
                if (name) return { name, source: 'phonebook' };
            }
        } catch {
            /* segue para conversa/profile */
        }
    }

    const fromConv = findConversationDisplayName(connId, digits);
    if (fromConv) return { name: fromConv, source: 'conversation' };

    if (opts?.skipProfile !== false) {
        return { name: null, source: null };
    }

    const fromProfile = await fetchProfileDisplayName(connId, digits);
    if (fromProfile) return { name: fromProfile, source: 'profile' };

    return { name: null, source: null };
}

/** Indica se o número já parece existir na agenda Evolution do chip. */
async function chipPhonebookHasNumber(connectionId: string, numberDigits: string): Promise<boolean> {
    const digits = String(numberDigits || '').replace(/\D/g, '');
    if (digits.length < 10) return false;
    const inst = evoInst(connectionId);
    const jid = `${digits}@s.whatsapp.net`;
    try {
        const response = await api.post(`/chat/findContacts/${inst}`, {
            where: { id: jid },
            page: 1,
            limit: 5
        });
        const list = Array.isArray(response.data)
            ? response.data
            : Array.isArray(response.data?.contacts)
              ? response.data.contacts
              : Array.isArray(response.data?.data)
                ? response.data.data
                : [];
        if (list.length > 0) return true;
    } catch {
        /* fallback abaixo */
    }
    try {
        const response = await api.post(`/chat/findContacts/${inst}`, {
            where: {},
            page: 1,
            limit: 2000
        });
        const list = Array.isArray(response.data)
            ? response.data
            : Array.isArray(response.data?.contacts)
              ? response.data.contacts
              : Array.isArray(response.data?.data)
                ? response.data.data
                : [];
        const keys = new Set(buildOutboundPhoneVariants(digits));
        keys.add(digits);
        for (const row of list) {
            if (!row || typeof row !== 'object') continue;
            const r = row as Record<string, unknown>;
            const candidates = [r.id, r.remoteJid, r.jid, r.number, r.phoneNumber]
                .map((x) => String(x || '').split('@')[0].replace(/\D/g, ''))
                .filter((d) => d.length >= 10);
            if (candidates.some((d) => keys.has(d) || d === digits || digits.endsWith(d) || d.endsWith(digits))) {
                return true;
            }
        }
    } catch {
        return false;
    }
    return false;
}

/**
 * Grava nome+número na agenda do celular do chip (Baileys chatModify via Evolution).
 * Se o número já existir, atualiza o nome (não duplica).
 */
export async function saveContactOnChipPhonebook(
    connectionId: string,
    numberDigits: string,
    name: string
): Promise<{ saved: true; action: 'added' | 'updated'; number: string; name: string }> {
    const number = normalizeOutboundNumber(numberDigits);
    const fullName = String(name || '').trim().slice(0, 80);
    if (number.length < 12) throw new Error('Telefone inválido.');
    if (!fullName) throw new Error('Nome vazio.');

    const existed = await chipPhonebookHasNumber(connectionId, number);
    await postEvolutionSaveContact(connectionId, number, fullName);
    return {
        saved: true,
        action: existed ? 'updated' : 'added',
        number,
        name: fullName
    };
}

/** Verifica se a Evolution desta VPS expõe rota de gravar contato na agenda. */
export async function probeSaveContactSupport(
    connectionId: string
): Promise<{ ok: boolean; error?: string; path?: string }> {
    const id = String(connectionId || '').trim();
    if (!id) return { ok: false, error: 'Canal inválido.' };
    const inst = evoInst(id);
    // Probe leve: número fictício só para ver se a rota existe (404 vs 4xx validação / 5xx baileys).
    const probeBody = { number: '5500000000000', name: 'ZapMassProbe', saveOnDevice: true };
    const paths = evolutionSaveContactPaths(inst);
    let sawNotFound = 0;
    for (const path of paths) {
        try {
            await api.post(path, probeBody, { timeout: 12_000 });
            return { ok: true, path };
        } catch (err: unknown) {
            const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
            const status = Number(ax.response?.status) || 0;
            if (status === 404 || status === 405 || status === 501) {
                sawNotFound += 1;
                continue;
            }
            // Rota existe, mas falhou validação/WhatsApp — ainda assim suporte API está presente.
            if (status >= 400 && status < 600) {
                return { ok: true, path };
            }
            // Rede / timeout: assume tentativa possível
            if (!status) {
                return { ok: true, path };
            }
        }
    }
    if (sawNotFound === paths.length) {
        return {
            ok: false,
            error:
                'Esta Evolution API ainda não permite gravar na agenda do celular. Atualize a imagem Evolution ou contacte o suporte.'
        };
    }
    return {
        ok: false,
        error: 'Não foi possível verificar o suporte a agenda no chip.'
    };
}

function evolutionSaveContactPaths(inst: string): string[] {
    return [
        `/contact/save/${inst}`,
        `/chat/saveContact/${inst}`,
        `/chat/save-contact/${inst}`,
        `/contact/saveContact/${inst}`
    ];
}

async function postEvolutionSaveContact(connectionId: string, number: string, fullName: string): Promise<void> {
    const inst = evoInst(connectionId);
    const body = {
        number,
        name: fullName,
        saveOnDevice: true
    };
    const paths = evolutionSaveContactPaths(inst);
    let lastStatus = 0;
    let lastMsg = '';

    for (const path of paths) {
        try {
            await api.post(path, body, { timeout: 25_000 });
            return;
        } catch (err: unknown) {
            const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
            lastStatus = Number(ax.response?.status) || 0;
            const data = ax.response?.data;
            lastMsg =
                typeof data === 'string'
                    ? data
                    : data && typeof data === 'object'
                      ? JSON.stringify(data).slice(0, 200)
                      : ax.message || '';
            if (lastStatus === 404 || lastStatus === 405 || lastStatus === 501) continue;
            const detail = lastMsg || `HTTP ${lastStatus || '?'}`;
            throw new Error(`Falha ao gravar na agenda: ${detail}`.slice(0, 280));
        }
    }

    if (lastStatus === 404 || lastStatus === 405 || lastStatus === 501 || !lastStatus) {
        throw new Error('SAVE_CONTACT_UNSUPPORTED');
    }
    throw new Error(`Falha ao gravar na agenda: ${lastMsg || `HTTP ${lastStatus}`}`.slice(0, 280));
}

export function deleteLocalConversations(conversationIds: string[]): number {
    return chatStore.deleteLocalConversations(conversationIds);
}

export async function fetchRawInstances(): Promise<any> {
    const response = await api.get('/instance/fetchInstances');
    return response.data;
}

export function getWarmupState() {
    return {
        pending: [...warmupQueue],
        warmedCount: warmedNumbers.size,
    };
}

export async function markWarmupReady(numbers: string[]) {
    const normalized = numbers.map((n) => n.replace(/[^0-9]/g, ''));
    normalized.forEach((num) => warmedNumbers.add(num));

    ensureCampaignWorker();

    const ready = warmupQueue.filter((item) =>
        normalized.includes(item.to.replace(/[^0-9]/g, ''))
    );
    for (const item of ready) {
        await enqueueCampaignItem({
            connectionId: item.connectionId,
            to: item.to,
            message: item.message,
            campaignId: item.campaignId,
        });
    }

    const remaining = warmupQueue.filter(
        (item) => !normalized.includes(item.to.replace(/[^0-9]/g, ''))
    );
    warmupQueue.length = 0;
    warmupQueue.push(...remaining);

    if (io) {
        io.emit('warmup-update', getWarmupState());
    }
}

// ================== ADAPTADORES (compatibilidade server.ts) ==================

// createConnection compatível com server.ts (recebe name como string)
export async function createConnection(
    name: string,
    proxy?: ConnectionProxyConfig,
    ownerUid?: string
): Promise<void> {
    const uid = ownerUid && ownerUid !== 'anonymous' ? ownerUid.trim() : '';
    if (!uid) {
        throw new Error('Faça login para criar um canal WhatsApp.');
    }
    const id = generateId(uid);
        publishOwnerEvent(uid, 'connection-created', { connectionId: id, name });
    const result = await createConnectionInternal(id, name, proxy, uid);
    if (result.error) {
        stopQrWatch(id);
        throw new Error(result.error);
    }
}

export async function setConnectionProxy(id: string, proxy: ConnectionProxyConfig | null): Promise<void> {
    const conn = connections.get(id);
    if (!conn) throw new Error('Conexão não encontrada');

    if (proxy?.host && proxy.port) {
        conn.proxy = proxy;
        connections.set(id, conn);
        await applyProxyToInstance(id, proxy);
    } else {
        delete conn.proxy;
        connections.set(id, conn);
        try {
            await api.post(`/proxy/set/${evoInst(id)}`, { enabled: false });
        } catch {
            /* instância pode não ter proxy configurado */
        }
    }

    // Antes: io.emit global vazava host de proxy para outros tenants.
    // Agora envia apenas para o dono da conexao.
    const proxyOwnerUid = resolveOwnerUid(id);
    if (proxyOwnerUid) {
        publishOwnerEvent(proxyOwnerUid, 'connection-update', {
            id,
            proxy: conn.proxy ? { enabled: true, host: conn.proxy.host } : null,
        });
    }
}

// startCampaign exportado acima com assinatura completa

/** Conta envio 1:1 (parabéns / bate-papo) no teto do chip e no funil do painel. */
function recordManualOutboundSend(conversationId: string): void {
    const sep = String(conversationId || '').indexOf(':');
    if (sep <= 0) {
        log('warn', 'recordManualOutboundSend: conversationId sem connectionId', { conversationId });
        return;
    }
    const connectionId = conversationId.slice(0, sep).trim();
    const phoneDigits = normalizePhoneKey(conversationId.slice(sep + 1));
    if (!connectionId) return;

    let mapKey = connectionId;
    let conn = connections.get(connectionId);
    if (!conn) {
        // Fallback: alguns boots usam chave com capitalização/alias diferente.
        for (const [id, c] of connections.entries()) {
            if (id.toLowerCase() === connectionId.toLowerCase()) {
                conn = c;
                mapKey = id;
                break;
            }
        }
    }
    if (!conn) {
        log('warn', 'recordManualOutboundSend: chip não encontrado no mapa', {
            connectionId,
            known: Array.from(connections.keys()).slice(0, 20),
        });
        return;
    }

    checkAndResetDailyLimits(conn);
    conn.messagesSentToday = (conn.messagesSentToday || 0) + 1;
    recordConnectionDispatch(mapKey);
    mergeConnectionSettingsCache(mapKey, {
        dailyLimit: conn.dailyLimit,
        growthRate: conn.growthRate,
        growthType: conn.growthType,
        limitAction: conn.limitAction,
        messagesSentToday: conn.messagesSentToday,
        limitExceededApproved: conn.limitExceededApproved,
        lastLimitResetDate: conn.lastLimitResetDate,
        ownerUid: conn.ownerUid,
        friendlyName: conn.friendlyName,
    });
    saveConnectionsSettings();
    const ownerUid = resolveOwnerUid(mapKey);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'connections-update', filterByConnectionScope(ownerUid, getConnections()));
    } else {
        warnUnscopedConnectionEvent(mapKey, 'connections-update');
        // Ainda emite no socket global se existir — melhor UI desatualizada do que zero eterno.
        try {
            io?.emit('connections-update', getConnections());
        } catch {
            /* ignore */
        }
    }

    evolutionTrackManualMessageSent(undefined, mapKey, phoneDigits, ownerUid);
}

// sendMessage compatível com server.ts (conversationId, text)
export async function sendMessage(conversationId: string, text: string): Promise<boolean> {
    await chatStore.sendMessage(conversationId, text);
    recordManualOutboundSend(conversationId);
    return true;
}

export async function sendMedia(
    conversationId: string,
    payload: {
        dataBase64: string;
        mimeType: string;
        fileName: string;
        caption?: string;
        sendMediaAsDocument?: boolean;
    }
): Promise<void> {
    await chatStore.sendMedia(conversationId, payload);
    recordManualOutboundSend(conversationId);
}

/**
 * Renomeia um canal localmente (salva em connectionsSettingsCache).
 * A Evolution API não tem endpoint de rename; o nome é persistido em disco
 * e refletido imediatamente em getConnections().
 */
export function renameConnection(connectionId: string, newName: string): boolean {
    const conn = connections.get(connectionId);
    if (!conn) return false;
    conn.friendlyName = newName;
    mergeConnectionSettingsCache(connectionId, {
        friendlyName: newName,
        ownerUid: conn.ownerUid,
        createdByUid: connectionsSettingsCache[connectionId]?.createdByUid ?? conn.ownerUid,
    });
    saveConnectionsSettings();
    const ownerUid = resolveOwnerUid(connectionId);
    publishOwnerEvent(ownerUid, 'connections-update', filterByConnectionScope(ownerUid || '', getConnections()));
    return true;
}

/** Resolve dono da campanha para emitir eventos socket (RAM, registo geo ou parâmetro explícito). */
function resolveCampaignOwnerUid(campaignId: string, explicitOwnerUid?: string): string | undefined {
    const explicit = String(explicitOwnerUid || '').trim();
    if (explicit && explicit !== 'anonymous') return explicit;
    const state = campaignsById.get(campaignId);
    if (state?.ownerUid) return state.ownerUid;
    return getCampaignGeoOwner(campaignId);
}

export function pauseCampaign(campaignId: string, ownerUid?: string) {
    pausedCampaigns.add(campaignId);
    const ou = resolveCampaignOwnerUid(campaignId, ownerUid);
    const state = campaignsById.get(campaignId);
    log('info', `⏸️ Campanha pausada: ${campaignId}`, { ownerUid: ou });
    if (ou) {
        void persistCampaignProgressToFirestore(
            ou,
            campaignId,
            state?.successCount ?? 0,
            state?.failCount ?? 0,
            state?.processed ?? 0,
            'PAUSED'
        );
    }
    publishOwnerEvent(ou, 'campaign-paused', { campaignId });
}

export function resumeCampaign(campaignId: string, ownerUid?: string) {
    const stateBefore = campaignsById.get(campaignId);
    const wasProtection = Boolean(stateBefore?.protectionPaused);

    pausedCampaigns.delete(campaignId);
    const ou = resolveCampaignOwnerUid(campaignId, ownerUid) || ownerUid;
    const state = campaignsById.get(campaignId);
    if (state) {
        state.protectionPaused = false;
        state.protectionPauseReason = undefined;
        state.protectionPauseUntil = undefined;
        state.protectionPauseMessage = undefined;
    }
    if (wasProtection) {
        const queue = getCampaignQueue();
        if (queue) {
            void spreadCampaignJobsOnResume(queue, campaignId).catch(() => undefined);
        }
    }
    log('info', `▶️ Campanha retomada: ${campaignId}`, { ownerUid: ou });
    // Se o estado não estiver em RAM (ex: após restart), tenta restaurar do Redis.
    if (!campaignsById.has(campaignId)) {
        void ensureCampaignRuntimeInMemory(campaignId, ou);
    }
    // Garante status RUNNING no Firestore ao retomar (corrige campanhas presas em DRAFT/PENDENTE).
    const stateAfter = campaignsById.get(campaignId);
    if (ou) {
        void persistCampaignProgressToFirestore(
            ou, campaignId,
            stateAfter?.successCount ?? 0,
            stateAfter?.failCount ?? 0,
            stateAfter?.processed ?? 0,
            'RUNNING'
        );
    }
    publishOwnerEvent(ou, 'campaign-resumed', { campaignId });
    ensureCampaignWorker();
}

/** Carrega instâncias Evolution na RAM (sem sync de chats). */
export async function ensureConnectionsHydrated(): Promise<void> {
    await hydrateInstancesFromEvolution();
}

/**
 * Reconcilia ownerUid errado (ex.: canal da Patrícia na conta Gabriel) com base no Postgres.
 */
export async function autoReconcileConnectionOwners(opts?: { dryRun?: boolean }): Promise<{
    ok: boolean;
    dryRun: boolean;
    actions: import('./reconcileConnectionOwners.js').ReconcileAction[];
    applied: string[];
    removed: string[];
    migrated: Array<{ connId: string; threads: number; messages: number }>;
    errors: Array<{ connId: string; error: string }>;
}> {
    const { planConnectionOwnerReconciliation, fetchEvolutionConnectionLabels, refreshTenantUsersCache } =
        await import('./reconcileConnectionOwners.js');
    await refreshTenantUsersCache();
    const evolutionLabels = await fetchEvolutionConnectionLabels();
    const ramLabels: Record<string, string> = {};
    for (const [id, conn] of connections.entries()) {
        const n = conn.friendlyName?.trim();
        if (n && n !== id) ramLabels[id] = n;
    }
    const mergedLabels = { ...evolutionLabels, ...ramLabels };
    const actions = await planConnectionOwnerReconciliation(connectionsSettingsCache, {
        evolutionLabels: mergedLabels
    });
    const empty = {
        ok: true,
        dryRun: Boolean(opts?.dryRun),
        actions,
        applied: [] as string[],
        removed: [] as string[],
        migrated: [] as Array<{ connId: string; threads: number; messages: number }>,
        errors: [] as Array<{ connId: string; error: string }>,
    };
    if (opts?.dryRun || actions.length === 0) {
        return empty;
    }

    const applied: string[] = [];
    const removed: string[] = [];
    const migrated: Array<{ connId: string; threads: number; messages: number }> = [];
    const errors: Array<{ connId: string; error: string }> = [];

    for (const action of actions) {
        if (action.kind === 'remove') {
            delete connectionsSettingsCache[action.connId];
            connections.delete(action.connId);
            removed.push(action.connId);
            continue;
        }

        const prior = action.fromOwnerUid || undefined;
        const result = await reassignConnectionOwnerAdmin(action.connId, action.toOwnerUid, {
            priorOwnerUid: prior,
        });
        if (result.ok) {
            applied.push(action.connId);
        } else {
            errors.push({ connId: action.connId, error: result.error || 'reassign falhou' });
        }
    }

    if (removed.length > 0) {
        saveConnectionsSettings();
    }

    return { ok: errors.length === 0, dryRun: false, actions, applied, removed, migrated, errors };
}

/**
 * Corrige ownerUid de canal legado `conn_*` (admin / reparo pós vazamento entre tenants).
 * Hidrata Evolution, atualiza RAM + connections_settings.json e notifica donos afetados.
 */
export async function reassignConnectionOwnerAdmin(
    connectionId: string,
    newOwnerUid: string,
    opts?: { priorOwnerUid?: string }
): Promise<{ ok: boolean; error?: string; priorOwnerUid?: string; newOwnerUid?: string }> {
    const id = String(connectionId || '').trim();
    const uid = String(newOwnerUid || '').trim();
    if (!id || !uid || uid === 'anonymous') {
        return { ok: false, error: 'connectionId e ownerUid válidos são obrigatórios.' };
    }

    await hydrateInstancesFromEvolution();
    const prior = resolveOwnerUid(id);

    if (prior && prior !== uid) {
        try {
            const { migrateChatForConnection } = await import('./reconcileConnectionOwners.js');
            const migrated = await migrateChatForConnection(prior, uid, id);
            if (migrated.threads > 0) {
                log('info', 'Chats migrados na reassign de canal', {
                    connectionId: id,
                    priorOwnerUid: prior,
                    newOwnerUid: uid,
                    ...migrated,
                });
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            log('warn', 'Falha ao migrar chats na reassign', { connectionId: id, error: msg });
        }
    }

    if (
        opts?.priorOwnerUid?.trim() &&
        prior &&
        !tenantScopeUidsMatch(prior, opts.priorOwnerUid.trim())
    ) {
        return {
            ok: false,
            error: `ownerUid atual (${prior}) não confere com priorOwnerUid informado.`,
            priorOwnerUid: prior,
        };
    }

    const conn = connections.get(id);
    if (conn) {
        const ok = assignConnectionOwner(
            id,
            uid,
            prior && prior !== uid ? { replacePriorOwner: prior } : undefined
        );
        if (!ok) {
            return {
                ok: false,
                error: 'Não foi possível reatribuir (canal em RAM com dono diferente ou bloqueado).',
                priorOwnerUid: prior,
            };
        }
    } else {
        if (
            prior &&
            !tenantScopeUidsMatch(prior, uid) &&
            opts?.priorOwnerUid?.trim() &&
            !tenantScopeUidsMatch(prior, opts.priorOwnerUid.trim())
        ) {
            return { ok: false, error: 'Canal ausente na RAM e priorOwnerUid não confere.', priorOwnerUid: prior };
        }
        if (!connectionsSettingsCache[id]) {
            connectionsSettingsCache[id] = {};
        }
        connectionsSettingsCache[id].ownerUid = uid;
        connectionsSettingsCache[id].createdByUid = uid;
        saveConnectionsSettings();
    }

    if (prior && prior !== uid) {
        publishOwnerEvent(prior, 'connections-update', filterByConnectionScope(prior, getConnections()));
        if (io) {
            io.to(`user:${prior}`).emit(
                'connections-update',
                filterByConnectionScope(prior, getConnections())
            );
        }
    }
    publishOwnerEvent(uid, 'connections-update', filterByConnectionScope(uid, getConnections()));
    if (io) {
        io.to(`user:${uid}`).emit('connections-update', filterByConnectionScope(uid, getConnections()));
    }

    log('warn', 'Admin reassign connection owner', { connectionId: id, priorOwnerUid: prior, newOwnerUid: uid });
    return { ok: true, priorOwnerUid: prior, newOwnerUid: uid };
}

// ─── Funções auxiliares exportadas para routes ────────────────────────────────

/** Retorna as conexões pertencentes a um tenant (por ownerUid). */
export function getConnectionsForTenant(tenantId: string): Array<{ id: string; instanceName: string }> {
    const result: Array<{ id: string; instanceName: string }> = [];
    for (const [id] of connections.entries()) {
        const owner = resolveOwnerUid(id);
        if (owner === tenantId) {
            result.push({ id, instanceName: id });
        }
    }
    return result;
}

/** Retorna o status público de uma conexão (para pré-voo de disparo). */
export async function getConnectionStatePublic(instanceName: string): Promise<{ status: string; isOpen: boolean }> {
    const mem = connections.get(instanceName);
    if (mem?.status === 'open') return { status: 'open', isOpen: true };
    const raw = await getConnectionState(instanceName, {
        timeoutMs: 4_000,
        skipCache: false,
        maxCacheAgeMs: 20_000,
    });
    const lower = raw.toLowerCase();
    const isOpen = lower === 'open' || lower === 'connected';
    return { status: lower, isOpen };
}

/** Envia mensagem de teste para validar chip antes do disparo em massa. */
export async function sendTestMessage(
    connectionId: string,
    toNumber: string,
    message: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
        const result = await sendMessageInternal(connectionId, toNumber, message);
        return result.ok
            ? { ok: true, messageId: result.messageId }
            : { ok: false, error: result.errorDetail || 'Evolution API não confirmou entrega (possível chip offline)' };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }
}

/** Reprocessa respostas recebidas enquanto o chip estava offline (manual ou pós-deploy). */
export async function triggerInboundReplayForConnection(connectionId: string): Promise<{
    scanned: number;
    replayed: number;
    skipped: number;
}> {
    const ownerUid = resolveOwnerUid(connectionId);
    const { replayMissedInboundForConnection } = await import('./inboundMissedReplay.js');
    await recoverStuckReplyFlowSessions();
    const result = await replayMissedInboundForConnection(connectionId, ownerUid, {
        getConversations: () => chatStore.getConversations(),
        loadChatHistory: (conversationId, limit) =>
            chatStore.loadChatHistory(conversationId, limit, true),
        getLastClosedAt: (id) => connectionsSettingsCache[id]?.lastClosedAt,
        processInbound: processInboundAutomationMessage,
        log: (message, payload) => log('info', message, payload),
    });
    void syncHotLeadsAfterInboundReplay(ownerUid, connectionId);
    return result;
}

async function syncHotLeadsAfterInboundReplay(
    ownerUid: string | undefined,
    connectionId: string
): Promise<void> {
    if (!ownerUid) return;
    try {
        const { syncHotLeadEnrollments } = await import('./nurture/nurtureHotLeads.js');
        let offset = 0;
        let totalEnrolled = 0;
        for (let page = 0; page < 8; page++) {
            const batch = await syncHotLeadEnrollments(ownerUid, {
                offset,
                limit: 400,
                dryRun: false,
                connectionId,
            });
            totalEnrolled += batch.enrolled;
            offset = batch.nextOffset;
            if (!batch.hasMore) break;
        }
        if (totalEnrolled > 0) {
            log('info', '[nurture] Leads quentes inscritos após replay inbound', {
                ownerUid,
                connectionId,
                totalEnrolled,
            });
        }
    } catch (e) {
        log('warn', '[nurture] sync hot leads pós-replay falhou', {
            error: (e as Error)?.message,
            connectionId,
        });
    }
}

/** Retorna últimos N jobs falhos da fila BullMQ de campanhas com seus erros. */
export async function getFailedCampaignJobs(limit = 20): Promise<Array<{
    jobId: string;
    campaignId: string;
    connectionId: string;
    to: string;
    failedReason: string;
    attemptsMade: number;
    failedAt?: string;
}>> {
    const queue = getCampaignQueue();
    if (!queue) return [];
    try {
        const failed = await queue.getFailed(0, limit - 1);
        return failed.map((j) => {
            const d = (j.data || {}) as Partial<MessageQueueItem>;
            return {
                jobId: String(j.id || ''),
                campaignId: String(d.campaignId || ''),
                connectionId: String(d.connectionId || ''),
                to: String(d.to || ''),
                failedReason: j.failedReason || 'desconhecido',
                attemptsMade: j.attemptsMade ?? 0,
                failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : undefined,
            };
        });
    } catch {
        return [];
    }
}

// Export default
export default {
    init,
    createConnection,
    setConnectionProxy,
    deleteConnection,
    disconnectConnection,
    forceQr,
    reconnectConnection,
    sendMessage,
    sendMedia,
    startCampaign,
    isMassCampaignEngineIdle,
    canControlCampaign,
    renameConnection,
    pauseCampaign,
    resumeCampaign,
    applySettings,
    getConnectionState,
    handleWebhook,
    dispatchWebhook,
    getConnections,
    getMetrics,
    getConversations,
    syncAllOpenChats,
    syncOpenChatsForOwner,
    syncConnectionsForOwner,
    ensureConnectionsHydratedForOwner,
    reemitConversationsForOwner,
    getInboxPageForOwner,
    assignConnectionOwner,
    reassignConnectionOwnerAdmin,
    autoReconcileConnectionOwners,
    healAllOrphanConnectionOwners,
    healAllGenericConnectionFriendlyNames,
    listOrphanOpenConnectionIds,
    loadChatHistory,
    loadMessageMedia,
    markAsRead,
    fetchConversationPicture,
    deleteLocalConversations,
    getWarmupState,
    markWarmupReady,
    fetchRawInstances,
    getConnectionsForTenant,
    getConnectionStatePublic,
    sendTestMessage,
};
