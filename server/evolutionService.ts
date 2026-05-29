/**
 * Evolution API Service
 * Substitui whatsapp-web.js por Evolution API (99% estável)
 * 
 * @version 2.3.0
 * @date 2026-01-24
 */

import axios, { AxiosInstance } from 'axios';
import { Queue, Worker, Job } from 'bullmq';
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
} from './replyFlowEngine.js';
import { persistCampaignLogToFirestore, persistCampaignProgressToFirestore } from './campaignPersistence.js';
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
    publishOwnerEvent,
} from './whatsappService.js';
import { createEvolutionChat, type EvolutionChatStore } from './evolutionChat.js';
import {
    filterByConnectionScope,
    isLegacyConnectionId,
    ownsConnectionForUid
} from '../src/utils/connectionScope.js';
import {
    canReconcileLegacyCampaignOwner,
    resolveCampaignTenantOwner
} from './campaignTenantScope.js';
import type { Server as SocketIOServer } from 'socket.io';

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

/** Evolution v2 alterna `open` e `connected` para sessão ativa. */
function isEvolutionOpenState(raw: unknown): boolean {
    const state = String(raw || '').toLowerCase();
    return state === 'open' || state === 'connected';
}

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
            if (typeof row.profileName === 'string' && row.profileName && !conn.profileName) {
                conn.profileName = row.profileName;
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
        } else if (io) {
            io.emit('connections-update', getConnections());
        }
    }
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
    } else if (io) {
        io.emit('connection-progress', payload);
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
    if (io) io.emit(event, payload);
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
 * Vincula canal legado `conn_*` sem dono ao tenant (ex.: antes do sync no socket terminar).
 * Não sobrescreve ownerUid já gravado (outra conta).
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

    const prior = meta;
    if (
        prior &&
        prior !== uid &&
        uid &&
        uid !== 'anonymous' &&
        isLegacyConnectionId(id) &&
        workspaceMemberUids?.has(prior)
    ) {
        assignConnectionOwner(id, uid, { replacePriorOwner: prior });
        meta = resolveOwnerUid(id);
        if (ownsConnectionForUid(uid, id, meta)) return true;
    }

    if (!meta && uid && uid !== 'anonymous' && isLegacyConnectionId(id)) {
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
    if (conn.ownerUid && conn.ownerUid !== uid) {
        const prior = opts?.replacePriorOwner?.trim();
        if (!prior || conn.ownerUid !== prior) return false;
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
    saveConnectionsSettings();

    publishOwnerEvent(uid, 'connections-update', filterByConnectionScope(uid, getConnections()));
    return true;
}

/** Remove instâncias Evolution zumbis (`created` órfãs) — nunca `connecting` nem `close` (sessão recuperável). */
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
            // Não apagar `connecting` nem `close`: sync pós-QR / queda transitória — logout+delete mata sessão pareada.
            if (state !== 'created') continue;
            if (connectionWatchTimers.has(instanceName) || qrWatchTimers.has(instanceName)) continue;

            try {
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
    const pruned = await pruneConnectingZombiesForOwner(uid);
    if (pruned.deleted.length > 0) {
        log('info', `syncConnectionsForOwner: zumbis removidos=${pruned.deleted.join(',')}`);
    }

    const claimed: string[] = [];
    for (const orphanId of listOrphanOpenConnectionIds()) {
        if (
            assignConnectionOwner(orphanId, uid) ||
            tryClaimUnownedLegacyConnection(orphanId, uid)
        ) {
            claimed.push(orphanId);
        }
    }

    const admin = (await import('./firebaseAdmin.js')).getFirebaseAdmin();
    const { isUidMemberOfTenant } = await import('./inboxAssignments.js');
    const { isLegacyConnectionId } = await import('../src/utils/connectionScope.js');
    if (admin) {
        for (const [id] of connections.entries()) {
            if (!isLegacyConnectionId(id)) continue;
            const prior = resolveOwnerUid(id);
            if (!prior || prior === uid) continue;
            if (!(await isUidMemberOfTenant(admin, uid, prior))) continue;
            if (assignConnectionOwner(id, uid, { replacePriorOwner: prior })) claimed.push(id);
        }
    }

    const syncedChats: string[] = [];
    for (const [id] of connections.entries()) {
        if (resolveOwnerUid(id) !== uid) continue;
        if (!(await isConnectionOpen(id))) continue;
        const n = await chatStore.syncChatsForConnection(id);
        syncedChats.push(id);
        if (n === 0) {
            log('warn', `syncConnectionsForOwner: findChats retornou 0 conversas 1:1`, { connectionId: id, ownerUid: uid });
        }
    }

    const { conversationsPayloadForViewer } = await import('./conversationsEmit.js');
    const scoped = filterByConnectionScope(uid, getConnections());
    publishOwnerEvent(uid, 'connections-update', scoped);
    publishOwnerEvent(
        uid,
        'conversations-update',
        conversationsPayloadForViewer(uid, uid, chatStore.getConversations(), resolveConnectionOwnerUid)
    );

    log('info', `syncConnectionsForOwner: ${scoped.length} canal(is), claimed=${claimed.join(',') || '-'}`);

    return { connections: scoped, claimed, syncedChats };
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

/** Estado aberto: memória da API + Evolution (evita disparo/pipeline bloqueados por polling atrasado). */
export async function anySelectedConnectionsOpen(connectionIds: string[]): Promise<boolean> {
    for (const id of connectionIds) {
        if (await isConnectionOpen(id)) return true;
    }
    return false;
}

async function isConnectionOpen(instanceName: string): Promise<boolean> {
    const mem = connections.get(instanceName);
    if (mem?.status === 'open') return true;
    const apiState = (await getConnectionState(instanceName)).toLowerCase();
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
        const { conversationsPayloadForViewer } = await import('./conversationsEmit.js');
        const all = chatStore.getConversations();
        const owners = new Set<string>();
        for (const c of all) {
            const ou = resolveOwnerUid(c.connectionId);
            if (ou) owners.add(ou);
        }
        for (const uid of owners) {
            publishOwnerEvent(
                uid,
                'conversations-update',
                conversationsPayloadForViewer(uid, uid, all, resolveConnectionOwnerUid)
            );
        }
        if (owners.size === 0 && io) {
            io.emit('conversations-update', all);
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
    } else if (io) {
        io.emit('connection-init-failure', payload);
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
            void deleteConnection(connectionId).catch(() => undefined);
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
    } else if (io) {
        io.emit('connection-update', updatePayload);
        io.emit('connections-update', getConnections());
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
                const { conversationsPayloadForViewer } = await import('./conversationsEmit.js');
                publishOwnerEvent(
                    ou,
                    'conversations-update',
                    conversationsPayloadForViewer(ou, ou, chatStore.getConversations(), resolveConnectionOwnerUid)
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
        if (state === 'open') {
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
    } else if (io) {
        io.emit('qr-code', payload);
        io.emit('connections-update', getConnections());
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
                const verified = (await getConnectionState(instanceName)).toLowerCase();
                if (isEvolutionOpenState(verified)) mappedState = 'open';
            }
            const phoneFromApi = phoneFromEvolutionRow(row);
            const instanceObj: EvolutionInstance = {
                instanceName,
                friendlyName: existing?.friendlyName || String(row.profileName || instanceName),
                status: mappedState,
                ownerUid: existing?.ownerUid || ownerUidFromConnectionId(instanceName),
                profilePicUrl: typeof row.profilePicUrl === 'string' ? row.profilePicUrl : existing?.profilePicUrl,
                profileName: typeof row.profileName === 'string' ? row.profileName : existing?.profileName,
                phoneNumber: phoneFromApi || existing?.phoneNumber,
                qrCode: existing?.qrCode,
                proxy: existing?.proxy,
            };
            applySettingsToInstance(instanceObj);

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
}

interface MessageQueueItem {
    connectionId: string;
    to: string;
    message: string;
    campaignId?: string;
    media?: CampaignMediaPayload;
    sendAsMedia?: boolean;
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
    if (!redisConnection) {
        redisConnection = new IORedis(url, { maxRetriesPerRequest: null });
    }
    return redisConnection;
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
}

let connectionsSettingsCache: Record<string, ConnectionSettingsPayload> = {};

function loadConnectionsSettings() {
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        if (fs.existsSync(connectionsSettingsFile)) {
            const raw = fs.readFileSync(connectionsSettingsFile, 'utf8');
            connectionsSettingsCache = JSON.parse(raw);
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
        if (cached.ownerUid && !conn.ownerUid) {
            conn.ownerUid = cached.ownerUid;
        }
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

function checkAndResetDailyLimits(conn: EvolutionInstance) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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
        
        // Atualiza cache e persiste no disco
        connectionsSettingsCache[conn.instanceName] = {
            dailyLimit: conn.dailyLimit,
            growthRate: conn.growthRate,
            growthType: conn.growthType,
            limitAction: conn.limitAction,
            messagesSentToday: conn.messagesSentToday,
            limitExceededApproved: conn.limitExceededApproved,
            lastLimitResetDate: conn.lastLimitResetDate,
            ownerUid: conn.ownerUid
        };
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

    connectionsSettingsCache[id] = {
        dailyLimit: conn.dailyLimit,
        growthRate: conn.growthRate,
        growthType: conn.growthType,
        limitAction: conn.limitAction,
        messagesSentToday: conn.messagesSentToday,
        limitExceededApproved: conn.limitExceededApproved,
        lastLimitResetDate: conn.lastLimitResetDate,
        ownerUid: conn.ownerUid
    };
    saveConnectionsSettings();

    const ownerUid = resolveOwnerUid(id);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'connections-update', filterByConnectionScope(ownerUid, getConnections()));
    } else if (io) {
        io.emit('connections-update', getConnections());
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
const campaignMediaById = new Map<string, CampaignMediaPayload>();

interface CampaignRuntimeState {
    ownerUid?: string;
    total: number;
    processed: number;
    successCount: number;
    failCount: number;
    lastLoggedProcessed: number;
    isRunning: boolean;
}

const campaignsById = new Map<string, CampaignRuntimeState>();
const campaignPendingJobs = new Map<string, number>();

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

const chatStore: EvolutionChatStore = createEvolutionChat(api);

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
        if (level === 'ERROR' || (level === 'INFO' && message === 'Mensagem enviada')) {
            void persistCampaignLogToFirestore(uid, campaignId, level, message, payload);
        }
    }
}

function bumpCampaignProgress(campaignId: string | undefined, success: boolean) {
    if (!campaignId) return;
    const state = campaignsById.get(campaignId);
    if (!state) return;

    state.processed += 1;
    if (success) state.successCount += 1;
    else state.failCount += 1;

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
}

function finishCampaignJob(campaignId: string | undefined, success: boolean) {
    if (!campaignId) return;
    bumpCampaignProgress(campaignId, success);

    const pending = Math.max(0, (campaignPendingJobs.get(campaignId) || 0) - 1);
    if (pending <= 0) {
        campaignPendingJobs.delete(campaignId);
        const state = campaignsById.get(campaignId);
        if (state?.isRunning) {
            state.isRunning = false;
            campaignMediaById.delete(campaignId);
            if (state.ownerUid) {
                void persistCampaignProgressToFirestore(
                    state.ownerUid,
                    campaignId,
                    state.successCount,
                    state.failCount,
                    state.processed,
                    'COMPLETED'
                );
                publishOwnerEvent(state.ownerUid, 'campaign-finished', {
                    campaignId,
                    successCount: state.successCount,
                    failCount: state.failCount,
                    total: state.total,
                });
            }
        }
    } else {
        campaignPendingJobs.set(campaignId, pending);
    }
}

/** Campanha ativa pertence ao tenant; reconcilia ownerUid de membro da equipa. */
export function ensureTenantOwnsCampaign(
    tenantUid: string,
    campaignId: string,
    workspaceMemberUids?: ReadonlySet<string>,
    actingAuthUid?: string
): boolean {
    const cid = String(campaignId || '').trim();
    if (!cid) return false;
    const state = campaignsById.get(cid);
    if (!state?.isRunning) return false;

    let resolved = resolveCampaignTenantOwner(
        tenantUid,
        state.ownerUid,
        workspaceMemberUids,
        actingAuthUid
    );
    if (!resolved && canReconcileLegacyCampaignOwner(tenantUid, state.ownerUid, workspaceMemberUids)) {
        resolved = tenantUid;
    }
    if (!resolved) return false;
    if (state.ownerUid !== resolved) {
        state.ownerUid = resolved;
        evolutionRegisterCampaign(cid, resolved);
    }
    return true;
}

export function canControlCampaign(
    uid: string,
    campaignId: string,
    workspaceMemberUids?: ReadonlySet<string>,
    actingAuthUid?: string
): boolean {
    return ensureTenantOwnsCampaign(uid, campaignId, workspaceMemberUids, actingAuthUid);
}

function ensureReplyFlowEngine() {
    if (replyFlowEngine) return;
    replyFlowEngine = new ReplyFlowEngine({
        enqueue: (item) => {
            void enqueueCampaignItem({
                connectionId: item.connectionId,
                to: item.to,
                message: item.message,
                campaignId: item.campaignId,
                replyFlowAfterSend: item.replyFlowAfterSend,
            });
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
        isCampaignPaused: (campaignId) => pausedCampaigns.has(campaignId),
    });
}

async function filterActiveConnections(connectionIds: string[]): Promise<string[]> {
    const active: string[] = [];
    for (const connId of connectionIds) {
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
    
    if (io) {
        io.emit('campaign:' + level, {
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

        if (instance.ownerUid) {
            if (!connectionsSettingsCache[id]) {
                connectionsSettingsCache[id] = {};
            }
            connectionsSettingsCache[id].ownerUid = instance.ownerUid;
            saveConnectionsSettings();
        }

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
        const url = evolutionConfig.webhookUrl;
        const events = [
            'QRCODE_UPDATED',
            'CONNECTION_UPDATE',
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'SEND_MESSAGE',
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
export async function getConnectionState(instanceName: string): Promise<string> {
    try {
        const response = await api.get(`/instance/connectionState/${evoInst(instanceName)}`);
        return parseConnectionStatePayload(response.data);
    } catch (error: any) {
        const status = error?.response?.status;
        if (status === 404) return 'close';
        const mem = connections.get(instanceName)?.status;
        if (mem) return mem;
        return 'close';
    }
}

/**
 * Força novo QR Code
 */
export async function forceQr(id: string): Promise<{ qrCode?: string; error?: string }> {
    log('info', `Forçando novo QR para: ${id}`);
    const conn = connections.get(id);
    if (!conn) {
        await hydrateInstancesFromEvolution();
    }
    if (!connections.has(id)) {
        throw new Error('Canal não encontrado. Atualize a página ou crie um canal novo.');
    }

    try {
        await api.delete(`/instance/logout/${evoInst(id)}`);
    } catch {
        /* instância pode já estar deslogada */
    }

    let extracted = await fetchConnectQr(id);
    if (!extracted) {
        extracted = await pollConnectQr(id, 10, 2500);
    }
    if (!extracted) {
        ensureQrDelivered(id, 25, 2000);
        log('info', `forceQr: polling QR para ${id}`);
        return {};
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

        const live = (await getConnectionState(id)).toLowerCase();
        if (isEvolutionOpenState(live)) {
            applyConnectionStateUpdate(id, 'open', {});
            log('info', `Instância já aberta: ${id}`);
            return;
        }

        const conn = connections.get(id);
        if (conn?.phoneNumber?.trim() && (live === 'close' || live === 'connecting')) {
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
            const ou = resolveOwnerUid(id);
            const payload = { id, status: 'CONNECTING' as const };
            if (ou) {
                publishOwnerEvent(ou, 'connection-update', payload);
            } else if (io) {
                io.emit('connection-update', payload);
            }
        }

        log('info', `Instância reconectada: ${id}`);

    } catch (error: any) {
        log('error', `Erro ao reconectar ${id}`, { error: error.message });
    }
}

/**
 * Deleta uma instância
 */
export async function deleteConnection(id: string): Promise<void> {
    log('info', `Deletando instância: ${id}`);
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
    const removedChats = chatStore.purgeConversationsForConnection(id);

    if (ownerUid) {
        const scoped = filterByConnectionScope(ownerUid, getConnections());
        publishOwnerEvent(ownerUid, 'connection-deleted', { id });
        publishOwnerEvent(ownerUid, 'connections-update', scoped);
        const { conversationsPayloadForViewer } = await import('./conversationsEmit.js');
        publishOwnerEvent(
            ownerUid,
            'conversations-update',
            conversationsPayloadForViewer(ownerUid, ownerUid, chatStore.getConversations(), resolveConnectionOwnerUid)
        );
    } else if (io) {
        io.emit('connection-deleted', { id });
        io.emit('connections-update', getConnections());
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
        const number = to.replace(/[^0-9]/g, '');
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
): Promise<{ ok: boolean; messageId?: string }> {
    try {
        const number = to.replace(/[^0-9]/g, '');

        log('info', `Enviando mensagem via ${connectionId}`, { to: number });

        const response = await api.post(`/message/sendText/${evoInst(connectionId)}`, {
            number,
            text: message,
            delay: 1200,
        });

        const messageId = response.data?.key?.id || response.data?.key?._serialized;
        if (response.data?.key) {
            log('info', `✅ Mensagem enviada com sucesso`, { to: number, messageId });
            return { ok: true, messageId: messageId ? String(messageId) : undefined };
        }

        return { ok: false };
    } catch (error: any) {
        log('error', `Erro ao enviar mensagem`, {
            connectionId,
            to,
            error: error.message,
            response: error.response?.data,
        });
        return { ok: false };
    }
}

async function enqueueCampaignItem(item: MessageQueueItem, delayMs = 0) {
    const queue = getCampaignQueue();
    if (!queue) {
        log('warn', 'Redis indisponível — job de campanha ignorado (defina REDIS_URL)', {
            connectionId: item.connectionId,
            to: item.to,
        });
        return;
    }
    bumpQueueSize(item.connectionId, 1);
    if (item.campaignId) {
        campaignPendingJobs.set(item.campaignId, (campaignPendingJobs.get(item.campaignId) || 0) + 1);
    }
    await queue.add('send', item, {
        jobId: `${item.campaignId || 'direct'}:${item.connectionId}:${item.to}:${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        delay: Math.max(0, delayMs),
        removeOnComplete: 1000,
        removeOnFail: 5000,
    });
}

async function processCampaignJob(job: Job<MessageQueueItem>) {
    const item = job.data;

    if (item.campaignId && pausedCampaigns.has(item.campaignId)) {
        await job.moveToDelayed(Date.now() + 3000);
        return;
    }

    const campaignState = item.campaignId ? campaignsById.get(item.campaignId) : undefined;
    const dispatchSettings = getTenantDispatchSettings(campaignState?.ownerUid);

    if (dispatchSettings.sleepMode) {
        const hour = new Date().getHours();
        if (hour >= 20 || hour < 8) {
            log('info', '😴 Sleep mode ativo - adiando envio', { ownerUid: campaignState?.ownerUid });
            await job.moveToDelayed(Date.now() + 60_000);
            return;
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
                    await job.updateProgress({ redirectedTo: altConn.instanceName });
                    await job.moveToDelayed(Date.now() + 2000);
                    return;
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

            await job.moveToDelayed(Date.now() + 15000);
            return;
        }
    }

    if (!(await isConnectionOpen(item.connectionId))) {
        const state = await getConnectionState(item.connectionId);
        throw new Error(`Canal ${item.connectionId} não conectado (${state})`);
    }

    log('info', 'Tentando envio', { to: item.to, connectionId: item.connectionId, campaignId: item.campaignId });

    let mediaToSend = item.media;
    if (item.sendAsMedia && item.campaignId && campaignMediaById.has(item.campaignId)) {
        mediaToSend = campaignMediaById.get(item.campaignId);
    }

    let sendResult: { ok: boolean; messageId?: string } = { ok: false };
    if (mediaToSend?.base64 || mediaToSend?.url) {
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
        throw new Error('Falha no envio');
    }

    if (conn) {
        conn.messagesSentToday = (conn.messagesSentToday || 0) + 1;
        connectionsSettingsCache[item.connectionId] = {
            dailyLimit: conn.dailyLimit,
            growthRate: conn.growthRate,
            growthType: conn.growthType,
            limitAction: conn.limitAction,
            messagesSentToday: conn.messagesSentToday,
            limitExceededApproved: conn.limitExceededApproved,
            lastLimitResetDate: conn.lastLimitResetDate
        };
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
    }

    emitCampaignLog(
        'INFO',
        'Mensagem enviada',
        { campaignId: item.campaignId, to: phoneDigits, connectionId: item.connectionId },
        campaignState?.ownerUid
    );

    ensureReplyFlowEngine();
    if (item.replyFlowOpen?.campaignId) {
        replyFlowEngine.openSession({
            connectionId: item.connectionId,
            phoneDigits: item.replyFlowOpen.phoneDigits,
            campaignId: item.replyFlowOpen.campaignId,
            ownerUid: item.replyFlowOpen.ownerUid,
            vars: item.replyFlowOpen.vars,
            toRaw: item.to,
            convKey: `${item.connectionId}:${item.replyFlowOpen.phoneDigits}`,
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
    finishCampaignJob(item.campaignId, true);

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
        const number = to.replace(/[^0-9]/g, '');
        let type = 'document';
        if (mimeType.startsWith('image/')) type = 'image';
        else if (mimeType.startsWith('video/')) type = 'video';
        else if (mimeType.startsWith('audio/')) type = 'audio';

        // Evolution API v2: campos na raiz (SendMediaDto extends Metadata), sem wrapper mediaMessage
        const response = await api.post(`/message/sendMedia/${evoInst(connectionId)}`, {
            number,
            delay: 1200,
            mediatype: type,
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

    campaignWorker = new Worker<MessageQueueItem>('campaign-messages', processCampaignJob, {
        connection: conn.duplicate(),
        concurrency: 1,
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
            finishCampaignJob(item.campaignId, false);
            const campaignState = item.campaignId ? campaignsById.get(item.campaignId) : undefined;
            publishOwnerEvent(campaignState?.ownerUid, 'campaign:message-sent', {
                campaignId: item.campaignId,
                to: item.to,
                success: false,
                error: err.message,
            });
            emitCampaignLog(
                'ERROR',
                'Falha no envio da campanha',
                { campaignId: item.campaignId, to: item.to, connectionId: item.connectionId, error: err.message },
                campaignState?.ownerUid
            );
        }
    });

    campaignWorker.on('completed', () => {
        /* contadores já ajustados no processCampaignJob */
    });

    log('info', 'Worker BullMQ de campanhas iniciado');
}

/**
 * Inicia campanha com suporte a multi-etapas, reply flow e channelWeights.
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
    delaySeconds?: number
): Promise<boolean> {
    if (connectionIds.length === 0 || numbers.length === 0) return false;

    const cid = campaignId || `campaign_${Date.now()}`;

    if (media?.base64 || media?.url) {
        campaignMediaById.set(cid, media);
    }

    const sanitizedReplySteps =
        Boolean(replyFlow?.enabled && Array.isArray(replyFlow?.steps) && replyFlow.steps.length >= 1)
            ? sanitizeReplyFlowSteps(replyFlow.steps)
            : [];
    const useReplyFlow = sanitizedReplySteps.length >= 1;

    const templates = messageTemplates.map((t) => String(t || '').trim()).filter((t) => t.length > 0);
    if (!useReplyFlow && templates.length === 0) return false;

    ensureReplyFlowEngine();
    ensureCampaignWorker();

    if (useReplyFlow) {
        replyFlowEngine.registerDef(cid, sanitizedReplySteps);
    }

    const activeConnectionIds = await filterActiveConnections(connectionIds);
    if (activeConnectionIds.length === 0) {
        emitCampaignLog('ERROR', 'Nenhum canal respondeu após verificação.', { campaignId: cid });
        return false;
    }

    const stageCount = useReplyFlow ? sanitizedReplySteps.length : templates.length;
    const totalJobs = numbers.length * (useReplyFlow ? 1 : stageCount);
    const recipientVars = buildRecipientVarsMap(recipients);
    const hasMedia = campaignMediaById.has(cid);

    const useWeights =
        !useReplyFlow &&
        channelWeights &&
        typeof channelWeights === 'object' &&
        Object.keys(channelWeights).length > 0;

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

    campaignsById.set(cid, {
        ownerUid,
        total: totalJobs,
        processed: 0,
        successCount: 0,
        failCount: 0,
        lastLoggedProcessed: 0,
        isRunning: true,
    });
    evolutionRegisterCampaign(cid, ownerUid);
    publishOwnerEvent(ownerUid, 'campaign-started', { total: totalJobs, campaignId: cid });

    const dispatchSettings = resolveCampaignDispatchSettings(ownerUid, delaySeconds);

    for (let i = 0; i < numbers.length; i++) {
        const num = numbers[i];
        const cleanPhone = normalizePhoneKey(num);
        const vars = recipientVars.get(cleanPhone) || {};
        const assignedConnectionId = useWeights
            ? pickWeightedChannel(activeConnectionIds, channelWeights, i)
            : activeConnectionIds[i % activeConnectionIds.length];
        const staggerDelay = i * dispatchSettings.minDelayMs;

        if (useReplyFlow) {
            const personalizedMessage = applyMessageVars(sanitizedReplySteps[0].body, cleanPhone, vars);
            await enqueueCampaignItem(
                {
                    connectionId: assignedConnectionId,
                    to: num,
                    message: personalizedMessage,
                    campaignId: cid,
                    sendAsMedia: hasMedia,
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
                const personalizedMessage = applyMessageVars(templates[stageIndex], cleanPhone, vars);
                const stageDelay = staggerDelay + stageIndex * dispatchSettings.minDelayMs;
                await enqueueCampaignItem(
                    {
                        connectionId: assignedConnectionId,
                        to: num,
                        message: personalizedMessage,
                        campaignId: cid,
                        sendAsMedia: hasMedia && stageIndex === 0,
                    },
                    stageDelay
                );
            }
        }
    }

    return true;
}

/**
 * Inicialização do serviço
 */
async function reconcileConnectionHealth() {
    for (const [id, conn] of connections.entries()) {
        if (connectionWatchTimers.has(id) || qrWatchTimers.has(id)) continue;
        const apiState = (await getConnectionState(id)).toLowerCase();
        const memState = conn.status;
        const paired = Boolean(conn.phoneNumber?.trim());

        if (isEvolutionOpenState(apiState) && memState !== 'open') {
            applyConnectionStateUpdate(id, 'open', {});
            continue;
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
            continue;
        }

        if (memState === 'open' && !isEvolutionOpenState(apiState)) {
            log('info', `Health reconcile ${id}: mem=open api=${apiState}`);
            applyConnectionStateUpdate(id, apiState === 'connecting' ? 'connecting' : 'close', {});
            continue;
        }

        if (paired && memState === 'close' && !isEvolutionOpenState(apiState) && !autoReconnectState.has(id)) {
            scheduleEvolutionAutoReconnect(id);
        }
    }
}

export function init(socketIO: SocketIOServer) {
    io = socketIO;
    chatStore.init(socketIO, { notifyConversationsChanged: emitScopedConversationsUpdate });
    ensureReplyFlowEngine();
    ensureCampaignWorker();
        log('info', 'Evolution API Service Initialized', {
        apiUrl: evolutionConfig.apiUrl,
        webhookUrl: evolutionConfig.webhookUrl,
    });

    void hydrateInstancesFromEvolution().then(() => reconcileConnectionHealth());
    if (!connectionHealthTimer) {
        connectionHealthTimer = setInterval(() => {
            void reconcileConnectionHealth();
        }, 30_000);
    }
    testConnection();
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
export function handleWebhook(event: any) {
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
                const msg = data.messages?.[0];
                const isFromMe = msg?.key?.fromMe;
                const remoteJid = msg?.key?.remoteJid;
                const messageId = msg?.key?.id;

                chatStore.handleWebhookMessage(instance, data);

                if (io) {
                    io.emit('message-received', {
                        connectionId: instance,
                        message: data,
                    });
                }

                if (isFromMe && messageId) {
                    metrics.totalSent++;
                    publishOwnerEvent(undefined, 'campaign-progress', {
                        successCount: metrics.totalSent,
                        connectionId: instance,
                    });
                } else if (!isFromMe && remoteJid) {
                    const jid = String(remoteJid);
                    if (!jid.endsWith('@g.us')) {
                        const phoneDigits = jid.split('@')[0].replace(/\D/g, '');
                        const { bodyText, nonTextReply } = extractEvolutionReplyBody(msg?.message);
                        ensureReplyFlowEngine();
                        void replyFlowEngine.handleIncoming({
                            connectionId: instance,
                            phoneDigits,
                            bodyText,
                            nonTextReply,
                            incomingConvId: `${instance}:${phoneDigits}`,
                        });
                        evolutionTrackIncomingReply(instance, phoneDigits);
                    }
                }
                break;
            }

            case 'MESSAGES_UPDATE': {
                const updates = Array.isArray(data) ? data : data ? [data] : [];
                for (const upd of updates) {
                    const messageId = upd?.key?.id || upd?.keyId;
                    const updateStatus = upd?.update?.status ?? upd?.status;
                    if (messageId != null && updateStatus != null) {
                        evolutionTrackMessageAck(String(messageId), Number(updateStatus));
                        chatStore.updateMessageStatus(String(messageId), Number(updateStatus));
                    }
                }
                break;
            }
        }

    } catch (error: any) {
        log('error', 'Erro ao processar webhook', { error: error.message });
    }
}

// ================== GETTERS (compatibilidade com server.ts) ==================

export function getConnections(): WhatsAppConnection[] {
    const result: WhatsAppConnection[] = [];
    for (const [id, conn] of connections.entries()) {
        let status = ConnectionStatus.DISCONNECTED;
        if (conn.status === 'open') status = ConnectionStatus.CONNECTED;
        else if (conn.status === 'connecting') status = ConnectionStatus.CONNECTING;
        else if (conn.status === 'created') status = ConnectionStatus.QR_READY;

        result.push({
            id,
            name: conn.friendlyName || id,
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

/** Vincula `conn_*` órfãos antes do findChats (request-conversations-sync não passava pelo sync completo). */
function claimOrphanConnectionsForOwner(ownerUid: string): string[] {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') return [];
    const claimed: string[] = [];
    for (const orphanId of listOrphanOpenConnectionIds()) {
        if (
            assignConnectionOwner(orphanId, uid) ||
            tryClaimUnownedLegacyConnection(orphanId, uid)
        ) {
            claimed.push(orphanId);
        }
    }
    return claimed;
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

    const claimed = claimOrphanConnectionsForOwner(uid);
    const syncedChats: string[] = [];
    const skippedNotOpen: string[] = [];
    const skippedNotOwned: string[] = [];
    const conversationCounts: Record<string, number> = {};
    const tasks: Promise<void>[] = [];

    for (const [id] of connections.entries()) {
        if (resolveOwnerUid(id) !== uid) {
            skippedNotOwned.push(id);
            continue;
        }
        if (!(await isConnectionOpen(id))) {
            skippedNotOpen.push(id);
            continue;
        }
        syncedChats.push(id);
        tasks.push(
            chatStore.syncChatsForConnection(id).then((n) => {
                conversationCounts[id] = n;
            })
        );
    }

    if (tasks.length > 0) {
        await Promise.all(tasks);
        emitScopedConversationsUpdate();
    }

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

export function deleteLocalConversations(conversationIds: string[]): number {
    return chatStore.deleteLocalConversations(conversationIds);
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
    const uid = ownerUid && ownerUid !== 'anonymous' ? ownerUid : undefined;
    if (uid) {
        await pruneConnectingZombiesForOwner(uid);
    }
    const id = generateId(ownerUid);
    if (uid) {
        publishOwnerEvent(uid, 'connection-created', { connectionId: id, name });
    } else if (io) {
        io.emit('connection-created', { connectionId: id, name });
    }
    const result = await createConnectionInternal(id, name, proxy, ownerUid);
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

    if (io) {
        io.emit('connection-update', { id, proxy: conn.proxy ? { enabled: true, host: conn.proxy.host } : null });
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

export function pauseCampaign(campaignId: string) {
    pausedCampaigns.add(campaignId);
    const state = campaignsById.get(campaignId);
    log('info', `⏸️ Campanha pausada: ${campaignId}`);
    publishOwnerEvent(state?.ownerUid, 'campaign-paused', { campaignId });
}

export function resumeCampaign(campaignId: string) {
    pausedCampaigns.delete(campaignId);
    const state = campaignsById.get(campaignId);
    log('info', `▶️ Campanha retomada: ${campaignId}`);
    publishOwnerEvent(state?.ownerUid, 'campaign-resumed', { campaignId });
    ensureCampaignWorker();
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
    pauseCampaign,
    resumeCampaign,
    applySettings,
    getConnectionState,
    handleWebhook,
    getConnections,
    getMetrics,
    getConversations,
    syncAllOpenChats,
    syncOpenChatsForOwner,
    syncConnectionsForOwner,
    assignConnectionOwner,
    listOrphanOpenConnectionIds,
    loadChatHistory,
    loadMessageMedia,
    markAsRead,
    fetchConversationPicture,
    deleteLocalConversations,
    getWarmupState,
    markWarmupReady,
};
