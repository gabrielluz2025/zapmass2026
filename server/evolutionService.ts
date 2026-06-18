/**
 * Evolution API Service
 * Substitui whatsapp-web.js por Evolution API (99% estável)
 * 
 * @version 2.3.0
 * @date 2026-01-24
 */

import axios, { AxiosInstance } from 'axios';
import { Queue, Worker, Job, DelayedError } from 'bullmq';
import IORedis from 'ioredis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evolutionConfig } from './evolutionConfig.js';
import { saveMediaFromBase64 } from './mediaStorage.js';
import {
    ReplyFlowEngine,
    applyMessageVars,
    buildRecipientVarsMap,
    extractEvolutionReplyBody,
    normalizePhoneKey,
    pickWeightedChannel,
    sanitizeReplyFlowSteps,
    type CampaignRecipient,
    type ReplyFlowSession,
} from './replyFlowEngine.js';
import { campaignMediaStorageKey } from '../src/utils/campaignMediaKeys.js';
import { persistCampaignLogToFirestore, persistCampaignProgressToFirestore } from './campaignPersistence.js';
import { buildCampaignReportSnapshot, persistCampaignReportSnapshot } from './campaignReportSnapshot.js';
import {
    getTenantDispatchSettings,
    resolveCampaignDispatchSettings,
    saveTenantSettings,
    type TenantSettingsClientPayload,
} from './tenantSettings.js';
import {
    evolutionRegisterCampaign,
    evolutionTrackIncomingReply,
    evolutionTrackMessageAck,
    evolutionTrackMessageSent,
    logCampaignContactReply,
    resolveLatestCampaignForReply,
    getCampaignGeoOwner,
    publishOwnerEvent,
    recordConnectionDispatch,
} from './whatsappService.js';
import { createEvolutionChat, type EvolutionChatStore } from './evolutionChat.js';
import {
    buildEvolutionIncomingConvId,
    extractEvolutionMessageBody,
    normalizeEvolutionWebhookMessages,
    resolvePhoneDigitsFromEvolutionMessage,
} from './evolutionWebhookMessages.js';
import { handleSupportBotIncoming } from './supportBot/supportBotEngine.js';
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
import type { CampaignStageConfig } from '../src/types.js';
import {
    initMultiStepContactStates,
    onContactReply,
    onStepCompleted,
    updateContactStateOnFailure,
} from './campaignMultiStepEngine.js';
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
    lastLimitResetDate?: string; // Data no formato YYYY-MM-DD da última verificação/reinício do limite diário
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
    const base = value.includes('@') ? value.split('@')[0] : value;
    const digits = base.replace(/\D/g, '');
    return digits.length >= 10 ? digits : undefined;
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

/**
 * Normaliza numero para envio via Evolution.
 * - Remove caracteres nao-digitos
 * - Se tem 10 ou 11 digitos (BR sem DDI), prefixa "55"
 * - Caso contrario mantem (assume DDI ja presente)
 *
 * Sem isso, Evolution recebe "48996460175" (sem DDI) e a entrega falha
 * silenciosamente — campanha "rodando" sem mensagem chegar.
 */
function normalizeOutboundNumber(raw: string): string {
    const digits = String(raw || '').replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.startsWith('55')) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
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
        if (trimmed.startsWith('data:image/')) {
            return { displayValue: trimmed, kind: 'image' };
        }
        return { displayValue: `data:image/png;base64,${trimmed}`, kind: 'image' };
    }

    const code = qrcode.code ?? qrcode.pairingCode;
    if (typeof code === 'string' && code.trim()) {
        return { displayValue: code.trim(), kind: 'code' };
    }

    const rootBase64 = root.base64;
    if (typeof rootBase64 === 'string' && rootBase64.trim()) {
        const trimmed = rootBase64.trim();
        return {
            displayValue: trimmed.startsWith('data:image/') ? trimmed : `data:image/png;base64,${trimmed}`,
            kind: 'image',
        };
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

/** Evolution → memória → dono → chats (painel + pipeline). */
export async function syncConnectionsForOwner(ownerUid: string): Promise<{
    connections: WhatsAppConnection[];
    claimed: string[];
    syncedChats: string[];
}> {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') {
        return { connections: [], claimed: [], syncedChats: [] };
    }

    await hydrateInstancesFromEvolution();
    const restored = ensureCachedConnectionsInRamForOwner(uid);
    if (restored.length > 0) {
        log('info', `syncConnectionsForOwner: canais restaurados do cache=${restored.join(',')}`);
    }

    const claimed: string[] = [];

    const syncedChats: string[] = [];
    const syncTasks: Promise<void>[] = [];

    for (const [id] of connections.entries()) {
        if (!tenantOwnsConnection(uid, id)) continue;
        syncTasks.push(
            (async () => {
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
                const n = await chatStore.syncChatsForConnection(id, { deferEmit: true });
                syncedChats.push(id);
                if (n === 0) {
                    log('warn', `syncConnectionsForOwner: findChats retornou 0 conversas 1:1`, {
                        connectionId: id,
                        ownerUid: uid,
                    });
                }
            })()
        );
    }

    if (syncTasks.length > 0) {
        await Promise.all(syncTasks);
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
    if (isInboxPaginationEnabled()) {
        const page = await getInboxPageForOwner(uid, uid, { reset: true });
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
    for (const key of ['state', 'connectionStatus', 'status'] as const) {
        const v = row[key];
        if (typeof v === 'string' && v.trim()) return v;
    }
    const nested = row.instance;
    if (nested && typeof nested === 'object') {
        const inst = nested as Record<string, unknown>;
        for (const key of ['state', 'connectionStatus', 'status'] as const) {
            const v = inst[key];
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

async function isConnectionOpen(instanceName: string): Promise<boolean> {
    const mem = connections.get(instanceName);
    if (mem?.status === 'open') return true;
    const apiState = (await getConnectionState(instanceName, { timeoutMs: CONNECTION_STATE_PROBE_TIMEOUT_MS }))
        .toLowerCase();
    if (isEvolutionOpenState(apiState)) {
        if (mem) {
            applyConnectionStateUpdate(instanceName, 'open', {});
        }
        return true;
    }
    return false;
}

function parseConnectionStateFromData(data: unknown): string {
    return parseConnectionStatePayload(data);
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

const connectionWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const qrWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Evita tratar close transitório do Baileys durante pairing como desconexão real. */
const pairingStartedAt = new Map<string, number>();
const autoReconnectState = new Map<
    string,
    { attempts: number; timer?: ReturnType<typeof setTimeout>; inFlight?: boolean }
>();
let connectionHealthTimer: ReturnType<typeof setInterval> | null = null;

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

    const prev = autoReconnectState.get(connectionId) ?? { attempts: 0 };
    if (prev.inFlight) return;
    if (prev.attempts >= 6) {
        log('warn', `Auto-reconnect esgotado para ${connectionId}`);
        emitConnectionInitFailure(
            connectionId,
            'Canal desconectou várias vezes. Use "Reconectar" ou "Forçar QR" se não voltar sozinho.'
        );
        return;
    }

    const attempt = prev.attempts + 1;
    const delayMs = options?.immediate
        ? 0
        : Math.min(120_000, 5_000 * Math.pow(2, attempt - 1));
    if (prev.timer) clearTimeout(prev.timer);

    const timer = setTimeout(() => {
        void (async () => {
            const st = autoReconnectState.get(connectionId);
            if (!st || st.inFlight) return;
            st.inFlight = true;
            autoReconnectState.set(connectionId, st);
            log('info', `Auto-reconnect Evolution: ${connectionId} (tentativa ${attempt})`);
            try {
                try {
                    await api.put(`/instance/restart/${evoInst(connectionId)}`, {});
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
        })();
    }, delayMs);

    autoReconnectState.set(connectionId, { attempts: attempt, timer, inFlight: false });
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
            const phone = phoneFromWebhookData(data);
            if (phone) conn.phoneNumber = phone;
        } else if (state === 'connecting' || state === 'created') {
            if (!pairingStartedAt.has(instance)) {
                pairingStartedAt.set(instance, Date.now());
            }
        } else if (state === 'close') {
            stopQrWatch(instance);
            stopWatchingConnection(instance);
            pairingStartedAt.delete(instance);
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
            await chatStore.syncChatsForConnection(instance);
            const ou = resolveOwnerUid(instance);
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
        const state = (await getConnectionState(connectionId)).toLowerCase();
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
        await api.put(`/instance/restart/${evoInst(instanceName)}`, {});
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

        let sawCountZero = false;

        try {
            const getResp = await api.get(`/instance/connect/${evoInst(instanceName)}`);
            const parsed = tryParse(getResp.data, 'GET');
            if (parsed.extracted) return parsed.extracted;
            if (parsed.countZero) sawCountZero = true;
        } catch (error: any) {
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
            };
            applySettingsToInstance(instanceObj);
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
    /** Idempotência: definido após envio bem-sucedido para evitar reenvio em retry do BullMQ. */
    _sentOk?: boolean;
    /** Evita contabilizar processed/success duas vezes se o job for reprocessado após falha tardia. */
    _progressAccounted?: boolean;
    /** Conta quantas vezes o job foi adiado por limite diário — falha definitiva após 3 dias. */
    _limitDelayCount?: number;
    /** Motor multi-etapas lazy: identifica contactId e stepIndex desta entrega. */
    multiStepContact?: {
        contactId: string;
        stepIndex: number;
    };
    /** Reenvio manual: ignora limite de 24 h entre campanhas. */
    skipFrequencyCap?: boolean;
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
    const url = process.env.REDIS_URL?.trim();
    return url || null;
}

let redisConnection: IORedis | null = null;
let campaignQueue: Queue<MessageQueueItem> | null = null;

function getRedisConnection(): IORedis | null {
    const url = getRedisUrl();
    if (!url) return null;

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
        redisConnection = new IORedis(url, {
            maxRetriesPerRequest: null,
            enableOfflineQueue: false,
            connectTimeout: 8_000,
            commandTimeout: 12_000,
            // Sem limite de retries: reconecta indefinidamente com backoff até 10s.
            // Isso evita que a conexão morra permanentemente quando o Redis reinicia na VPS.
            retryStrategy: (times) => Math.min(times * 500, 10_000),
            reconnectOnError: () => true,
        });
        redisConnection.on('error', (err) => {
            console.warn('[campaign-queue] redis error:', err?.message || err);
        });
        // Quando a conexão se recupera, garantir que o worker está ativo.
        redisConnection.on('connect', () => {
            console.info('[campaign-queue] Redis reconectado — verificando worker…');
            ensureCampaignWorker();
        });
    }
    return redisConnection;
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
    campaignQueue = null;
    if (campaignWorker) {
        campaignWorker.close().catch(() => {});
        campaignWorker = null;
    }
    console.info('[campaign-queue] Conexão Redis resetada manualmente');
}

/** Verifica se o Redis está acessível abrindo uma conexão independente (não interfere no BullMQ). */
async function pingRedisHealthy(): Promise<boolean> {
    const url = getRedisUrl();
    if (!url) return false;
    // Cria conexão isolada para o ping (não usa a conexão BullMQ que tem enableOfflineQueue:false).
    const { redisPing } = await import('./redisPing.js');
    const result = await redisPing(url);
    return result.ok;
}

function getCampaignQueue(): Queue<MessageQueueItem> | null {
    const conn = getRedisConnection();
    if (!conn) return null;
    if (!campaignQueue) {
        campaignQueue = new Queue<MessageQueueItem>('campaign-messages', { connection: conn });
    }
    return campaignQueue;
}
const connectionQueueSizes = new Map<string, number>();
let campaignWorker: Worker<MessageQueueItem> | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.resolve(projectRoot, process.env.DATA_DIR || 'data');
const connectionsSettingsFile = path.join(dataDir, 'connections_settings.json');

interface ConnectionSettingsPayload {
    dailyLimit?: number;
    growthRate?: number;
    growthType?: 'percent' | 'fixed';
    limitAction?: 'ask' | 'redirect';
    messagesSentToday?: number;
    limitExceededApproved?: boolean;
    lastLimitResetDate?: string;
    ownerUid?: string; // Mantém o proprietário do canal de forma persistente
    /** Dono original — nunca apagado por updates de limite/envio; usado para curar órfãos. */
    createdByUid?: string;
    friendlyName?: string;
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
        if (fs.existsSync(connectionsSettingsFile)) {
            const raw = fs.readFileSync(connectionsSettingsFile, 'utf8');
            connectionsSettingsCache = JSON.parse(raw);
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
    const results: FrequencyCapContactResult[] = [];
    for (const phone of phones) {
        const digits = String(phone || '').replace(/\D/g, '');
        const phoneKey = digits.slice(-11);
        if (phoneKey.length < 8 || seen.has(phoneKey)) continue;
        seen.add(phoneKey);
        const info = await getFrequencyCapInfo(ownerUid, digits);
        results.push({
            phone: digits,
            phoneKey,
            capped: info.capped,
            ...(info.lastSentAt ? { lastSentAt: new Date(info.lastSentAt).toISOString() } : {}),
        });
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
    lastLoggedProcessed: number;
    isRunning: boolean;
    /** Janela deslizante dos últimos 20 resultados para auto-pausa por taxa de erro. */
    recentOutcomes: boolean[];
    /** Evita emitir múltiplos alertas de auto-pausa seguidos. */
    autoPauseEmitted?: boolean;
    /** Variáveis de personalização por destinatário — usadas em etapas lazy/multi-step. */
    _recipientVars?: Map<string, Record<string, string>>;
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

// Cliente HTTP configurado
const api: AxiosInstance = axios.create({
    baseURL: evolutionConfig.apiUrl,
    timeout: evolutionConfig.timeout,
    headers: {
        'apikey': evolutionConfig.apiKey,
        'Content-Type': 'application/json',
    },
});

const chatStore: EvolutionChatStore = createEvolutionChat(api, {
    resolveConnectionOwnerUid,
    ownerUidFromConnectionId
});

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

    const shouldLog = state.processed === state.total || state.processed - state.lastLoggedProcessed >= 5;
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

// ──── Persistência de Runtime de Campanha no Redis ────────────────────────────
const CAMPAIGN_RUNTIME_TTL_SECS = 24 * 3600; // 24h

interface CampaignRuntimeRedis extends CampaignRuntimeState {
    campaignId: string;
    savedAt: number;
}

async function saveCampaignRuntimeToRedis(campaignId: string): Promise<void> {
    const conn = getRedisConnection();
    if (!conn || !campaignId) return;
    const state = campaignsById.get(campaignId);
    if (!state) return;
    try {
        const payload: CampaignRuntimeRedis = { ...state, campaignId, savedAt: Date.now() };
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
        return {
            ownerUid: parsed.ownerUid,
            total: parsed.total,
            processed: parsed.processed || 0,
            successCount: parsed.successCount || 0,
            failCount: parsed.failCount || 0,
            lastLoggedProcessed: parsed.lastLoggedProcessed || 0,
            isRunning: parsed.isRunning !== false,
            recentOutcomes: [],
        };
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
            }, replyDelay);
        },
        onMarketingConsent: (ownerUid, campaignId, effect, phoneDigits, replyText) => {
            publishOwnerEvent(ownerUid, 'contact-marketing-consent', {
                campaignId,
                phoneDigits,
                effect,
                replyText: String(replyText || '').slice(0, 500),
                at: new Date().toISOString(),
            });
        },
        onLog: (message, payload) =>
            emitCampaignLog('INFO', message, payload, payload?.ownerUid as string | undefined),
        onInboundReply: ({ campaignId, connectionId, phoneDigits, ownerUid }) => {
            evolutionTrackIncomingReply(connectionId, phoneDigits, { campaignId, ownerUid });
        },
        isCampaignPaused: (campaignId) => pausedCampaigns.has(campaignId),
        onSessionSave: (connectionId, phoneDigits, session) => {
            void saveReplyFlowSessionToRedis(connectionId, phoneDigits, session);
        },
        onSessionDisposed: (connectionId, phoneDigits) => {
            void deleteReplyFlowSessionFromRedis(connectionId, phoneDigits);
        },
        // Quando todas as sessões de reply flow de uma campanha fecham, verifica se a
        // campanha pode agora ser marcada como concluída (pending já era 0).
        onAllSessionsClosed: (campaignId) => {
            campaignPendingJobs.delete(campaignId);
            void tryFinalizeOrHoldCampaign(campaignId);
        },
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
async function setupWebhook(instanceName: string) {
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
            'SEND_MESSAGE',
            'PRESENCE_UPDATE',
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
        writeConnectionStateCache(instanceName, state);
        return state;
    } catch (error: any) {
        const status = error?.response?.status;
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
 * Força novo QR Code
 */
export async function forceQr(id: string): Promise<{ qrCode?: string; error?: string }> {
    log('info', `Forçando novo QR para: ${id}`);
    stopWatchingConnection(id);
    stopQrWatch(id);
    clearAutoReconnect(id);
    pairingStartedAt.delete(id);

    const conn = connections.get(id);
    if (!conn) {
        await hydrateInstancesFromEvolution();
    }
    if (!connections.has(id)) {
        throw new Error('Canal não encontrado. Atualize a página ou crie um canal novo.');
    }

    const active = connections.get(id)!;
    active.phoneNumber = '';
    active.qrCode = undefined;
    active.status = 'connecting';
    connections.set(id, active);
    pairingStartedAt.set(id, Date.now());
    emitConnectionProgress(id, 'loading-whatsapp-web');
    emitConnectionsUpdateForConnection(id);

    try {
        await api.delete(`/instance/logout/${evoInst(id)}`);
    } catch {
        /* instância pode já estar deslogada */
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
        return { error: 'QR ainda não disponível. Aguarde alguns segundos.' };
    }

    emitQrToFrontend(id, extracted);
    log('info', `Novo QR gerado para: ${id}`);
    return { qrCode: extracted.displayValue };
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
        if (status !== 404) {
            const msg =
                error?.response?.data?.message ||
                error?.response?.data?.error ||
                error?.message ||
                'Falha ao remover canal na Evolution';
            log('error', `Erro ao deletar ${id}`, { error: msg, status });
            throw new Error(String(msg));
        }
    }

    connections.delete(id);
    connectionQueueSizes.delete(id);
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
): Promise<{ ok: boolean; messageId?: string }> {
    try {
        const number = normalizeOutboundNumber(to);
        log('info', `Enviando media via ${connectionId}`, { to: number, mimeType, fileName });

        let type = 'document';
        if (mimeType.startsWith('image/')) type = 'image';
        else if (mimeType.startsWith('video/')) type = 'video';
        else if (mimeType.startsWith('audio/')) type = 'audio';

        const { url } = await saveMediaFromBase64(base64, mimeType, fileName);

        // Evolution API v2: campos na raiz (SendMediaDto extends Metadata), sem wrapper mediaMessage
        const endpoint = `/message/sendMedia/${evoInst(connectionId)}`;
        const payload = {
            number,
            delay: 1200,
            mediatype: type,
            mimetype: mimeType,
            caption: caption || '',
            media: url,
            fileName,
        };
        const response = await api.post(endpoint, payload);
        const messageId = response.data?.key?.id || response.data?.key?._serialized;

        if (response.data?.key) {
            log('info', `✅ Media enviada com sucesso`, { to: number, messageId, url });
            return { ok: true, messageId: messageId ? String(messageId) : undefined };
        }

        return { ok: false };
    } catch (error: any) {
        log('error', `Erro ao enviar media`, {
            connectionId,
            to,
            error: error.message,
            response: error.response?.data,
        });
        return { ok: false };
    }
}

/**
 * Envia uma mensagem - FUNÇÃO INTERNA (3 argumentos)
 */
async function sendMessageInternal(
    connectionId: string,
    to: string,
    message: string
): Promise<{ ok: boolean; messageId?: string; errorDetail?: string }> {
    try {
        const number = normalizeOutboundNumber(to);

        if (!number) {
            log('warn', `Número inválido após normalização — envio ignorado`, { to, connectionId });
            return { ok: false, errorDetail: `Número inválido: ${to}` };
        }

        // Log explícito do número normalizado para facilitar diagnóstico de entrega
        log('info', `Enviando mensagem via ${connectionId}`, { toNormalized: number, toOriginal: to });

        // Formato compatível com Evolution API v1 e v2.x:
        //  - v1: aceita { number, text, delay }
        //  - v2: aceita { number, options: { delay }, textMessage: { text } }
        // Enviamos ambos os campos para máxima compatibilidade.
        const response = await api.post(`/message/sendText/${evoInst(connectionId)}`, {
            number,
            options: { delay: 1200, presence: 'composing' },
            textMessage: { text: message },
            // Campos legados v1 — mantidos para compatibilidade retroativa
            text: message,
            delay: 1200,
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

        // Fallback: algumas versões da Evolution respondem sem campo 'key'
        if (responseData?.message === 'Message Sent' || responseData?.id) {
            const altId = String(responseData?.id || '');
            log('info', `✅ Mensagem aceita (formato alternativo)`, { toNormalized: number, altId });
            return { ok: true, messageId: altId || undefined };
        }

        // Evolution v2: campo 'messageId' direto na raiz
        if (responseData?.messageId) {
            log('info', `✅ Mensagem aceita (Evolution v2 — campo messageId)`, { toNormalized: number, messageId: responseData.messageId });
            return { ok: true, messageId: String(responseData.messageId) };
        }

        // Evolution v2: resposta com 'status' indicando sucesso, sem 'key'
        const statusOk = typeof responseData?.status === 'string' &&
            ['PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED', 'sent', 'delivered'].includes(responseData.status);
        if (statusOk) {
            log('info', `✅ Mensagem aceita (Evolution — status ${responseData.status})`, { toNormalized: number });
            return { ok: true };
        }

        // Qualquer outra resposta 2xx que não seja um erro explícito — assumir sucesso
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

        // Evolution retornou 2xx mas com indicação de erro
        const errMsg2xx = String(responseData?.error || responseData?.message || 'Evolution retornou resposta sem confirmação');
        log('warn', `Evolution respondeu com possível falha de entrega`, {
            toNormalized: number,
            toOriginal: to,
            connectionId,
            responseSnippet: JSON.stringify(responseData).slice(0, 400),
        });
        return { ok: false, errorDetail: errMsg2xx };
    } catch (error: any) {
        const httpStatus: number | undefined = error.response?.status;
        const respBody = error.response?.data;
        const respMsg = typeof respBody === 'object'
            ? (respBody?.message || respBody?.error || JSON.stringify(respBody).slice(0, 200))
            : String(respBody || '').slice(0, 200);
        const detail = httpStatus
            ? `HTTP ${httpStatus}: ${respMsg || error.message}`
            : error.message;
        log('error', `Erro HTTP ao enviar mensagem`, {
            connectionId,
            toOriginal: to,
            toNormalized: normalizeOutboundNumber(to),
            error: error.message,
            httpStatus,
            responseBody: JSON.stringify(respBody || {}).slice(0, 500),
        });
        return { ok: false, errorDetail: detail };
    }
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
    bumpQueueSize(item.connectionId, 1);
    if (item.campaignId) {
        campaignPendingJobs.set(item.campaignId, (campaignPendingJobs.get(item.campaignId) || 0) + 1);
    }
    // jobId estável: inclui stageIndex para evitar colisão entre etapas do mesmo contato.
    // O sufixo Date.now() permanece para evitar duplicação ao reenfileirar após pausa/retry.
    const stageTag = item.stageIndex != null ? `s${item.stageIndex}` : 's0';
    const addPromise = queue.add('send', item, {
        jobId: `${item.campaignId || 'direct'}__${item.connectionId}__${item.to}__${stageTag}__${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        delay: Math.max(0, delayMs),
        removeOnComplete: 1000,
        removeOnFail: 5000,
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
    if (item.campaignId && pausedCampaigns.has(item.campaignId)) {
        await job.moveToDelayed(Date.now() + 3000, token);
        throw new DelayedError();
    }

    // Garante estado em RAM para esta campanha — restaura do Redis se necessário (ex: após restart).
    if (item.campaignId && !campaignsById.has(item.campaignId)) {
        const fallback = item.ownerUid || item.replyFlowOpen?.ownerUid;
        await ensureCampaignRuntimeInMemory(item.campaignId, fallback);
    }
    const campaignState = item.campaignId ? campaignsById.get(item.campaignId) : undefined;
    const dispatchSettings = getTenantDispatchSettings(campaignState?.ownerUid);

    if (dispatchSettings.sleepMode) {
        const hour = new Date().getHours();
        if (hour >= 20 || hour < 8) {
            log('info', '😴 Sleep mode ativo - adiando envio', { ownerUid: campaignState?.ownerUid });
            await job.moveToDelayed(Date.now() + 60_000, token);
            throw new DelayedError();
        }
    }

    const conn = connections.get(item.connectionId);
    if (conn) {
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
        const state = await getConnectionState(item.connectionId);
        throw new Error(`Canal ${item.connectionId} não conectado (${state})`);
    }

    const normalizedDest = normalizeOutboundNumber(item.to);

    // ── Limite de frequência: não reenviar para o mesmo contato em 24 h ───────
    if (item.campaignId && !item.skipFrequencyCap && (await checkFrequencyCap(campaignState?.ownerUid, item.to))) {
        log('info', `[freq-cap] Contato ${normalizedDest} já recebeu mensagem nas últimas 24 h — pulando`, {
            campaignId: item.campaignId, to: normalizedDest,
        });
        emitCampaignLog(
            'WARN',
            `Contato ${normalizedDest} ignorado: já recebeu mensagem nas últimas 24 h`,
            { campaignId: item.campaignId, to: normalizedDest },
            campaignState?.ownerUid
        );
        bumpQueueSize(item.connectionId, -1);
        await accountCampaignJobOnce(job, item, false);
        return;
    }
    // ──────────────────────────────────────────────────────────────────────────

    log('info', 'Tentando envio', {
        toNormalized: normalizedDest,
        toOriginal: item.to,
        connectionId: item.connectionId,
        campaignId: item.campaignId,
    });
    emitCampaignLog(
        'INFO',
        `Enviando para ${normalizedDest}`,
        { campaignId: item.campaignId, to: normalizedDest, connectionId: item.connectionId },
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
                item.to,
                mediaToSend.url,
                mediaToSend.mimeType,
                mediaToSend.fileName,
                mediaToSend.caption || item.message
            );
        } else if (mediaToSend.base64) {
            sendResult = await sendMediaInternal(
                item.connectionId,
                item.to,
                mediaToSend.base64,
                mediaToSend.mimeType,
                mediaToSend.fileName,
                mediaToSend.caption || item.message
            );
        }
    } else {
        sendResult = await sendMessageInternal(item.connectionId, item.to, item.message);
    }

    if (!sendResult.ok) {
        const errDetail = sendResult.errorDetail || 'Evolution API não confirmou entrega';
        emitCampaignLog(
            'ERROR',
            `Falha ao enviar para ${normalizedDest}`,
            {
                campaignId: item.campaignId,
                to: normalizedDest,
                connectionId: item.connectionId,
                error: errDetail,
            },
            campaignState?.ownerUid
        );
        throw new Error(`Falha no envio para ${normalizedDest} — ${errDetail}`);
    }

    // Marca envio OK antes de qualquer lógica pós-envio: se o processo cair aqui,
    // o retry do BullMQ detecta _sentOk=true e não reenvia (idempotência).
    item._sentOk = true;
    await job.updateData(item).catch(() => {});

    // Registra timestamp de envio para o limitador de frequência (24 h).
    await recordFrequencyCap(campaignState?.ownerUid, item.to);

    if (conn) {
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
    if (item.campaignId && sendResult.messageId) {
        evolutionTrackMessageSent(
            sendResult.messageId,
            item.connectionId,
            phoneDigits,
            item.campaignId,
            campaignState?.ownerUid || item.replyFlowOpen?.ownerUid
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
    }

    bumpQueueSize(item.connectionId, -1);

    // Motor multi-etapas lazy: agenda próxima etapa se houver stageConfigs.
    if (item.multiStepContact && item.campaignId) {
        const { contactId, stepIndex } = item.multiStepContact;
        const stageConfigs = campaignStageConfigsById.get(item.campaignId);
        if (stageConfigs && stageConfigs.length > 0) {
            void onStepCompleted({
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
): Promise<{ ok: boolean; messageId?: string }> {
    try {
        const number = normalizeOutboundNumber(to);
        let type = 'document';
        if (mimeType.startsWith('image/')) type = 'image';
        else if (mimeType.startsWith('video/')) type = 'video';
        else if (mimeType.startsWith('audio/')) type = 'audio';

        // Evolution API v2: campos na raiz (SendMediaDto extends Metadata), sem wrapper mediaMessage
        const response = await api.post(`/message/sendMedia/${evoInst(connectionId)}`, {
            number,
            delay: 1200,
            mediatype: type,
            mimetype: mimeType,
            caption: caption || '',
            media: mediaUrl,
            fileName,
        });
        const messageId = response.data?.key?.id || response.data?.key?._serialized;
        return { ok: Boolean(response.data?.key), messageId: messageId ? String(messageId) : undefined };
    } catch (error: any) {
        log('error', 'Erro ao enviar media por URL', {
            connectionId,
            to,
            mediaUrl,
            error: error.message,
        });
        return { ok: false };
    }
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

    campaignWorker.on('failed', (job, err) => {
        const item = job?.data;
        log('error', 'Job de campanha falhou', {
            to: item?.to,
            connectionId: item?.connectionId,
            campaignId: item?.campaignId,
            error: err.message,
            attemptsMade: job?.attemptsMade,
        });

        if (item && job && job.attemptsMade >= (job.opts.attempts || 1)) {
            bumpQueueSize(item.connectionId, -1);
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

    const pendingJobs = campaignPendingJobs.get(campaignId) || 0;
    const memState = campaignsById.get(campaignId);
    if (pendingJobs > 0 && memState?.isRunning) {
        return { ok: false, enqueued: 0, error: 'Campanha ainda em execução. Aguarde ou pause antes de reenviar.' };
    }

    pausedCampaigns.delete(campaignId);

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
            phone: String(r.phone || '').replace(/\D/g, ''),
            stepIndex: typeof options.stepIndex === 'number' ? options.stepIndex : 0,
        }));
    }

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

    const replyFlow = campaign.replyFlow;
    const sanitizedReplySteps =
        replyFlow?.enabled && Array.isArray(replyFlow.steps) && replyFlow.steps.length >= 1
            ? sanitizeReplyFlowSteps(replyFlow.steps)
            : [];
    const useReplyFlow = sanitizedReplySteps.length >= 1;
    if (useReplyFlow) {
        ensureReplyFlowEngine();
        replyFlowEngine.registerDef(campaignId, sanitizedReplySteps);
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
    skipFrequencyCap?: boolean
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
        replyFlowEngine.registerDef(cid, sanitizedReplySteps);
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

    const useWeights =
        !useReplyFlow &&
        channelWeights &&
        typeof channelWeights === 'object' &&
        Object.keys(channelWeights).length > 0;

    campaignsById.set(cid, {
        ownerUid,
        total: totalJobs,
        processed: 0,
        successCount: 0,
        failCount: 0,
        lastLoggedProcessed: 0,
        isRunning: true,
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

    const dispatchSettings = resolveCampaignDispatchSettings(ownerUid, delaySeconds);

    try {
        for (let i = 0; i < numbers.length; i++) {
            const num = numbers[i];
            const cleanPhone = normalizePhoneKey(num);
            const vars = recipientVars.get(cleanPhone) || {};
            const assignedConnectionId = useWeights
                ? pickWeightedChannel(activeConnectionIds, channelWeights, i)
                : activeConnectionIds[i % activeConnectionIds.length];
            const staggerDelay = i * dispatchSettings.minDelayMs;

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
                        sendAsMedia: hasMedia,
                        multiStepContact: { contactId: cleanPhone, stepIndex: 0 },
                        skipFrequencyCap: skipFrequencyCap === true,
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
                        sendAsMedia: hasMedia,
                        skipFrequencyCap: skipFrequencyCap === true,
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
                            sendAsMedia: hasMedia && stageIndex === 0,
                            skipFrequencyCap: skipFrequencyCap === true,
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
                scheduleEvolutionAutoReconnect(id);
            }
        })
    );
}

export function init(socketIO: SocketIOServer) {
    io = socketIO;
    chatStore.init(socketIO, { notifyConversationsChanged: emitScopedConversationsUpdate });
    ensureReplyFlowEngine();
    initEvolutionWebhookQueue(handleWebhook);
    log('info', 'Evolution API Service Initialized', {
        apiUrl: evolutionConfig.apiUrl,
        webhookUrl: evolutionConfig.webhookUrl,
    });

    void normalizeConnectionOwnersInSettings().then(async () => {
        healAllOrphanConnectionOwners();
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
        connectionHealthTimer = setInterval(() => {
            void reconcileConnectionHealth();
        }, 30_000);
    }
    testConnection();

    // Reconcilia jobs BullMQ ANTES de iniciar o worker para evitar race condition:
    // sem o await, campaignPendingJobs começa do zero enquanto o Redis ainda tem
    // jobs ativos — finishCampaignJob dispararia campaign-finished ao primeiro job,
    // fazendo a 2ª+ etapa nunca disparar e a campanha ser marcada COMPLETED prematuramente.
    void (async () => {
        await reconcilePendingJobsFromRedis();
        ensureCampaignWorker();
    })();
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
        }
    } catch (e: any) {
        log('warn', '[reconcile] Não foi possível reconciliar jobs do Redis:', { error: e?.message });
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
  return dispatchEvolutionWebhook(event);
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
                chatStore.handleWebhookMessage(instance, data);

                const items = normalizeEvolutionWebhookMessages(data);
                for (const msg of items) {
                    if (!msg?.key) continue;
                    const isFromMe = Boolean(msg.key.fromMe);
                    const remoteJid = String(msg.key.remoteJid || '');
                    const messageId = msg.key.id;

                    const messageOwnerUid = resolveOwnerUid(instance);
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

                    ensureReplyFlowEngine();
                    // Restaura sessão do Redis se foi perdida (restart do servidor)
                    await tryRestoreReplyFlowSession(instance, phoneDigits);
                    void replyFlowEngine.handleIncoming({
                        connectionId: instance,
                        phoneDigits,
                        bodyText,
                        nonTextReply,
                        incomingConvId,
                    });

                    const ownerUidForBot = messageOwnerUid || resolveOwnerUid(instance);
                    if (ownerUidForBot && incomingConvId) {
                        void handleSupportBotIncoming({
                            tenantId: ownerUidForBot,
                            connectionId: instance,
                            phoneDigits,
                            bodyText,
                            incomingConvId,
                            hasReplyFlowSession: replyFlowEngine.hasSession(instance, phoneDigits),
                            sendText: async (convId, text) => {
                                await sendMessage(convId, text);
                            }
                        });
                    }

                    // Motor multi-etapas lazy: verifica se contato aguarda resposta
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
                                            sendAsMedia: campaignMediaById.has(p.campaignId),
                                            multiStepContact: { contactId: p.contactId, stepIndex: p.stepIndex },
                                        },
                                        p.delayMs
                                    );
                                    // NÃO incrementar campaignPendingJobs aqui — enqueueCampaignItem já incrementa.
                                },
                                onLog: (msg, payload) =>
                                    emitCampaignLog('INFO', msg, payload, ownerUidForReply),
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
                        replyFlowEngine?.resolveCampaignIdForIncoming(
                            instance,
                            phoneDigits,
                            incomingConvId
                        ) || replyResolved.campaignId;
                    const replyOwnerUid = messageOwnerUid || replyResolved.ownerUid;

                    evolutionTrackIncomingReply(instance, phoneDigits, {
                        campaignId: replyCampaignId,
                        ownerUid: replyOwnerUid
                    });
                    const replyPreview =
                        String(bodyText || '').slice(0, 80) ||
                        (nonTextReply ? '[resposta sem texto legível — mídia/botão/etc.]' : '');
                    if (replyPreview) {
                        logCampaignContactReply(
                            instance,
                            phoneDigits,
                            replyPreview,
                            replyCampaignId,
                            replyOwnerUid
                        );
                    }
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
    for (const [id, conn] of connections.entries()) {
        let status = ConnectionStatus.DISCONNECTED;
        if (conn.status === 'open') status = ConnectionStatus.CONNECTED;
        else if (conn.qrCode?.trim()) status = ConnectionStatus.QR_READY;
        else if (conn.status === 'connecting') status = ConnectionStatus.CONNECTING;
        else if (conn.status === 'created') status = ConnectionStatus.QR_READY;

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
        });
    }
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

export function getMetrics(): DashboardMetrics {
    return { ...metrics };
}

export function getConversations(): Conversation[] {
    return chatStore.getConversations();
}

export async function syncAllOpenChats(): Promise<void> {
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
        tasks.push(
            chatStore.syncChatsForConnection(id).then((n) => {
                conversationCounts[id] = n;
            })
        );
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
): Promise<{ ok: boolean; total: number; error?: string }> {
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

// sendMessage compatível com server.ts (conversationId, text)
export async function sendMessage(conversationId: string, text: string): Promise<boolean> {
    await chatStore.sendMessage(conversationId, text);
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
    log('info', `⏸️ Campanha pausada: ${campaignId}`, { ownerUid: ou });
    publishOwnerEvent(ou, 'campaign-paused', { campaignId });
}

export function resumeCampaign(campaignId: string, ownerUid?: string) {
    pausedCampaigns.delete(campaignId);
    const ou = resolveCampaignOwnerUid(campaignId, ownerUid) || ownerUid;
    log('info', `▶️ Campanha retomada: ${campaignId}`, { ownerUid: ou });
    // Se o estado não estiver em RAM (ex: após restart), tenta restaurar do Redis.
    if (!campaignsById.has(campaignId)) {
        void ensureCampaignRuntimeInMemory(campaignId, ou);
    }
    // Garante status RUNNING no Firestore ao retomar (corrige campanhas presas em DRAFT/PENDENTE).
    const state = campaignsById.get(campaignId);
    if (ou) {
        void persistCampaignProgressToFirestore(
            ou, campaignId,
            state?.successCount ?? 0,
            state?.failCount ?? 0,
            state?.processed ?? 0,
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
    const raw = await getConnectionState(instanceName, { timeoutMs: 6_000, skipCache: true });
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
