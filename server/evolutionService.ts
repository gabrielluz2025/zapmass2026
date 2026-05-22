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
    profilePicUrl?: string;
    profileName?: string;
    phoneNumber?: string;
    proxy?: ConnectionProxyConfig;
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

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const campaignQueue = new Queue<MessageQueueItem>('campaign-messages', { connection });
const connectionQueueSizes = new Map<string, number>();
let campaignWorker: Worker<MessageQueueItem> | null = null;

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

// Gerador de IDs únicos
let idCounter = 0;
const generateId = () => `conn_${Date.now()}_${++idCounter}`;

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
        await api.post(`/proxy/set/${instanceName}`, {
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

export function canControlCampaign(uid: string, campaignId: string): boolean {
    if (!uid || !campaignId) return false;
    const state = campaignsById.get(campaignId);
    return Boolean(state?.isRunning && state.ownerUid === uid);
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
        const state = await getConnectionState(connId);
        if (state === 'open') active.push(connId);
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
    proxy?: ConnectionProxyConfig
): Promise<{ qrCode?: string; error?: string }> {
    try {
        log('info', `Criando instância: ${name} (${id})`);

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

        const response = await api.post('/instance/create', createPayload);

        const instance: EvolutionInstance = {
            instanceName: id,
            friendlyName: name,
            status: 'created',
            ...(proxy?.host && proxy.port ? { proxy } : {}),
        };

        connections.set(id, instance);

        if (proxy?.host && proxy.port) {
            await applyProxyToInstance(id, proxy);
        }

        // Obter QR Code
        const qrCode = response.data?.qrcode?.base64 || response.data?.qrcode?.code;

        log('info', `Instância criada: ${name}`, { instanceName: id });

        // Configurar webhook para receber eventos
        await setupWebhook(id);

        // Emitir evento para frontend
        if (io) {
            io.emit('qr-code', { connectionId: id, qrCode });
            io.emit('connection-update', {
                id,
                name,
                status: 'QR_READY',
                qrCode,
            });
        }

        return { qrCode };

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
        await api.post(`/webhook/set/${instanceName}`, {
            url: evolutionConfig.webhookUrl,
            webhook_by_events: true,
            events: [
                'QRCODE_UPDATED',
                'CONNECTION_UPDATE',
                'MESSAGES_UPSERT',
                'MESSAGES_UPDATE',
                'SEND_MESSAGE',
            ],
        });
        log('info', `Webhook configurado para ${instanceName}`);
    } catch (error: any) {
        log('warn', `Erro ao configurar webhook para ${instanceName}`, { error: error.message });
    }
}

/**
 * Obtém status da conexão
 */
export async function getConnectionState(instanceName: string): Promise<string> {
    try {
        const response = await api.get(`/instance/connectionState/${instanceName}`);
        return response.data?.state || 'close';
    } catch (error) {
        return 'close';
    }
}

/**
 * Força novo QR Code
 */
export async function forceQr(id: string): Promise<{ qrCode?: string; error?: string }> {
    try {
        log('info', `Forçando novo QR para: ${id}`);

        // Desconectar instância atual
        await api.delete(`/instance/logout/${id}`);

        // Reconectar para gerar novo QR
        const response = await api.get(`/instance/connect/${id}`);
        const qrCode = response.data?.qrcode?.base64 || response.data?.qrcode?.code;

        if (io) {
            io.emit('qr-code', { connectionId: id, qrCode });
            io.emit('connection-update', {
                id,
                status: 'QR_READY',
                qrCode,
            });
        }

        log('info', `Novo QR gerado para: ${id}`);
        return { qrCode };

    } catch (error: any) {
        log('error', `Erro ao forçar QR para ${id}`, { error: error.message });
        return { error: error.message };
    }
}

/**
 * Reconecta uma instância
 */
export async function reconnectConnection(id: string) {
    try {
        log('info', `Reconectando instância: ${id}`);

        const response = await api.get(`/instance/connect/${id}`);
        
        if (io) {
            io.emit('connection-update', {
                id,
                status: 'CONNECTING',
            });
        }

        log('info', `Instância reconectada: ${id}`);

    } catch (error: any) {
        log('error', `Erro ao reconectar ${id}`, { error: error.message });
    }
}

/**
 * Deleta uma instância
 */
export async function deleteConnection(id: string) {
    try {
        log('info', `Deletando instância: ${id}`);

        await api.delete(`/instance/delete/${id}`);
        connections.delete(id);

        if (io) {
            io.emit('connection-deleted', { id });
        }

        log('info', `Instância deletada: ${id}`);

    } catch (error: any) {
        log('error', `Erro ao deletar ${id}`, { error: error.message });
    }
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

        const endpoint = `/message/sendMedia/${connectionId}`;
        const payload = {
            number,
            options: {
                delay: 1200,
                presence: 'composing',
            },
            mediaMessage: {
                mediatype: type,
                caption: caption || '',
                media: url,
                fileName,
            },
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

        const response = await api.post(`/message/sendText/${connectionId}`, {
            number,
            text: message,
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
    bumpQueueSize(item.connectionId, 1);
    if (item.campaignId) {
        campaignPendingJobs.set(item.campaignId, (campaignPendingJobs.get(item.campaignId) || 0) + 1);
    }
    await campaignQueue.add('send', item, {
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

    const state = await getConnectionState(item.connectionId);
    if (state !== 'open') {
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

        const response = await api.post(`/message/sendMedia/${connectionId}`, {
            number,
            options: { delay: 1200, presence: 'composing' },
            mediaMessage: {
                mediatype: type,
                caption: caption || '',
                media: mediaUrl,
                fileName,
            },
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
    if (campaignWorker) return;

    campaignWorker = new Worker<MessageQueueItem>('campaign-messages', processCampaignJob, {
        connection: connection.duplicate(),
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
export function init(socketIO: SocketIOServer) {
    io = socketIO;
    chatStore.init(socketIO);
    ensureReplyFlowEngine();
    ensureCampaignWorker();
    log('info', 'Evolution API Service Initialized', {
        apiUrl: evolutionConfig.apiUrl,
        webhookUrl: evolutionConfig.webhookUrl,
    });

    // Testar conectividade com Evolution API
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
        const { instance, data } = event;

        switch (event.event) {
            case 'QRCODE_UPDATED':
                if (io) {
                    io.emit('qr-code', {
                        connectionId: instance,
                        qrCode: data.qrcode,
                    });
                }
                break;

            case 'CONNECTION_UPDATE':
                const status = data.state === 'open' ? 'ONLINE' : 
                               data.state === 'connecting' ? 'CONNECTING' : 'OFFLINE';

                if (io) {
                    io.emit('connection-update', {
                        id: instance,
                        status,
                        profilePicUrl: data.profilePicUrl,
                        profileName: data.profileName,
                    });
                }

                log('info', `Status atualizado: ${instance} → ${status}`);

                if (data.state === 'open') {
                    void chatStore.syncChatsForConnection(instance);
                }
                break;

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
            phoneNumber: conn.phoneNumber || null,
            status,
            lastActivity: new Date().toLocaleString(),
            queueSize: connectionQueueSizes.get(id) || 0,
            messagesSentToday: 0,
            signalStrength: 'STRONG',
            profilePicUrl: conn.profilePicUrl,
            batteryLevel: 100,
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
export async function createConnection(name: string, proxy?: ConnectionProxyConfig): Promise<void> {
    const id = generateId();
    await createConnectionInternal(id, name, proxy);
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
            await api.post(`/proxy/set/${id}`, { enabled: false });
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
    loadChatHistory,
    loadMessageMedia,
    markAsRead,
    fetchConversationPicture,
    deleteLocalConversations,
    getWarmupState,
    markWarmupReady,
};
