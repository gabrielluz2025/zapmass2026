/**
 * Evolution API Service
 * Substitui whatsapp-web.js por Evolution API (99% estável)
 * 
 * @version 2.3.0
 * @date 2026-01-24
 */

import axios, { AxiosInstance } from 'axios';
import { evolutionConfig } from './evolutionConfig.js';
import type { Server as SocketIOServer } from 'socket.io';

// ================== INTERFACES ==================

import { WhatsAppConnection, ConnectionStatus, DashboardMetrics, Conversation, ChatMessage } from './types.js';

interface EvolutionInstance {
    instanceName: string;
    friendlyName: string;
    status: 'created' | 'connecting' | 'open' | 'close';
    profilePicUrl?: string;
    profileName?: string;
    phoneNumber?: string;
}

interface MessageQueueItem {
    connectionId: string;
    to: string;
    message: string;
    campaignId?: string;
    attempts: number;
    totalAttempts: number;
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

const connections: Map<string, EvolutionInstance> = new Map();
const messageQueue: MessageQueueItem[] = [];
let io: SocketIOServer | null = null;
let isProcessing = false;

// Métricas e conversas
let metrics: DashboardMetrics = {
    totalSent: 0,
    totalDelivered: 0,
    totalRead: 0,
    totalReplied: 0,
};
let conversations: Conversation[] = [];
const warmupQueue: WarmupItem[] = [];
const warmedNumbers = new Set<string>();

// Gerador de IDs únicos
let idCounter = 0;
const generateId = () => `conn_${Date.now()}_${++idCounter}`;

// Configurações dinâmicas (enviadas pelo frontend via Settings)
let dynamicSettings = {
    minDelay: 15000,   // 15s
    maxDelay: 45000,   // 45s
    dailyLimit: 1000,
    sleepMode: true,
};

// Controle de pausa por campanha
const pausedCampaigns = new Set<string>();

export function applySettings(settings: { minDelay?: number; maxDelay?: number; dailyLimit?: number; sleepMode?: boolean }) {
    if (settings.minDelay !== undefined) dynamicSettings.minDelay = settings.minDelay * 1000;
    if (settings.maxDelay !== undefined) dynamicSettings.maxDelay = settings.maxDelay * 1000;
    if (settings.dailyLimit !== undefined) dynamicSettings.dailyLimit = settings.dailyLimit;
    if (settings.sleepMode !== undefined) dynamicSettings.sleepMode = settings.sleepMode;
    log('info', '⚙️ Configurações atualizadas', dynamicSettings);
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

// ================== FUNÇÕES AUXILIARES ==================

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
async function createConnectionInternal(id: string, name: string): Promise<{ qrCode?: string; error?: string }> {
    try {
        log('info', `Criando instância: ${name} (${id})`);

        const response = await api.post('/instance/create', {
            instanceName: id,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
        });

        const instance: EvolutionInstance = {
            instanceName: id,
            friendlyName: name,
            status: 'created',
        };

        connections.set(id, instance);

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
 * Envia uma mensagem - FUNÇÃO INTERNA (3 argumentos)
 */
async function sendMessageInternal(connectionId: string, to: string, message: string): Promise<boolean> {
    try {
        // Formatar número (remover caracteres especiais)
        const number = to.replace(/[^0-9]/g, '');

        log('info', `Enviando mensagem via ${connectionId}`, { to: number });

        const response = await api.post(`/message/sendText/${connectionId}`, {
            number,
            text: message,
        });

        if (response.data?.key) {
            log('info', `✅ Mensagem enviada com sucesso`, { to: number, messageId: response.data.key.id });
            return true;
        }

        return false;

    } catch (error: any) {
        log('error', `Erro ao enviar mensagem`, {
            connectionId,
            to,
            error: error.message,
            response: error.response?.data,
        });
        return false;
    }
}

/**
 * Inicia uma campanha - VERSÃO INTERNA (recebe objeto)
 */
async function startCampaignInternal(data: {
    campaignId: string;
    numbers: string[];
    message: string;
    connectionIds: string[];
}) {
    const { campaignId, numbers, message, connectionIds } = data;

    log('info', 'Campanha iniciada', {
        campaignId,
        total: numbers.length,
        channels: connectionIds.length,
    });

    // Adicionar mensagens à fila
    for (let i = 0; i < numbers.length; i++) {
        const connectionId = connectionIds[i % connectionIds.length];
        messageQueue.push({
            connectionId,
            to: numbers[i],
            message,
            campaignId,
            attempts: 0,
            totalAttempts: 0,
        });
    }

    // Processar fila
    if (!isProcessing) {
        processQueue();
    }
}

/**
 * Processa fila de mensagens
 */
async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;

    isProcessing = true;

    while (messageQueue.length > 0) {
        const item = messageQueue.shift()!;

        try {
            // Verificar se instância está conectada
            const state = await getConnectionState(item.connectionId);

            if (state !== 'open') {
                log('warn', `Canal ${item.connectionId} não está conectado (${state})`, {
                    to: item.to,
                });

                // Recolocar na fila se ainda tiver tentativas
                if (item.attempts < 3) {
                    item.attempts++;
                    messageQueue.push(item);
                    await new Promise(r => setTimeout(r, 5000)); // Aguardar 5s
                }
                continue;
            }

            // Enviar mensagem
            log('info', 'Tentando envio', { to: item.to, connectionId: item.connectionId });

            const success = await sendMessageInternal(item.connectionId, item.to, item.message);

            if (success) {
                // Sucesso
                if (io && item.campaignId) {
                    io.emit('campaign:message-sent', {
                        campaignId: item.campaignId,
                        to: item.to,
                        success: true,
                    });
                }
            } else {
                // Falha - retentar
                if (item.attempts < 3) {
                    item.attempts++;
                    messageQueue.push(item);
                } else {
                    // Falha definitiva
                    log('error', 'Excedido limite de tentativas', { to: item.to });

                    if (io && item.campaignId) {
                        io.emit('campaign:message-sent', {
                            campaignId: item.campaignId,
                            to: item.to,
                            success: false,
                            error: 'Excedido limite de tentativas',
                        });
                    }
                }
            }

            // Sleep mode: pausa fora do horário comercial (20h-8h)
            if (dynamicSettings.sleepMode) {
                const hour = new Date().getHours();
                if (hour >= 20 || hour < 8) {
                    log('info', '😴 Sleep mode ativo - aguardando horário comercial');
                    await new Promise(r => setTimeout(r, 60000));
                    continue;
                }
            }

            // Verificar se campanha está pausada
            if (item.campaignId && pausedCampaigns.has(item.campaignId)) {
                messageQueue.unshift(item); // Devolver ao início
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }

            // Delay dinâmico entre mensagens (anti-ban)
            const delay = dynamicSettings.minDelay + Math.random() * (dynamicSettings.maxDelay - dynamicSettings.minDelay);
            await new Promise(r => setTimeout(r, delay));

        } catch (error: any) {
            log('error', 'Erro ao processar item da fila', {
                to: item.to,
                error: error.message,
            });
        }
    }

    isProcessing = false;
    log('info', 'Fila processada completamente');
}

/**
 * Inicialização do serviço
 */
export function init(socketIO: SocketIOServer) {
    io = socketIO;
    log('info', 'Evolution API Service Initialized');
    log('info', `API URL: ${evolutionConfig.apiUrl}`);

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
                break;

            case 'MESSAGES_UPSERT':
                // Mensagem recebida (para aba de chat)
                if (io) {
                    io.emit('message-received', {
                        connectionId: instance,
                        message: data,
                    });
                }
                break;
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
            queueSize: messageQueue.filter(m => m.connectionId === id).length,
            messagesSentToday: 0,
            signalStrength: 'STRONG',
            profilePicUrl: conn.profilePicUrl,
            batteryLevel: 100,
        });
    }
    return result;
}

export function getMetrics(): DashboardMetrics {
    return { ...metrics };
}

export function getConversations(): Conversation[] {
    return [...conversations];
}

export function getWarmupState() {
    return {
        pending: [...warmupQueue],
        warmedCount: warmedNumbers.size,
    };
}

export async function markWarmupReady(numbers: string[]) {
    const normalized = numbers.map(n => n.replace(/[^0-9]/g, ''));
    normalized.forEach(num => warmedNumbers.add(num));

    // Mover itens da warmup queue para message queue
    const ready = warmupQueue.filter(item => normalized.includes(item.to.replace(/[^0-9]/g, '')));
    for (const item of ready) {
        messageQueue.push({
            connectionId: item.connectionId,
            to: item.to,
            message: item.message,
            campaignId: item.campaignId,
            attempts: 0,
            totalAttempts: 0,
        });
    }

    // Remover da warmup queue
    const remaining = warmupQueue.filter(item => !normalized.includes(item.to.replace(/[^0-9]/g, '')));
    warmupQueue.length = 0;
    warmupQueue.push(...remaining);

    if (io) {
        io.emit('warmup-update', getWarmupState());
    }

    // Iniciar processamento se necessário
    if (!isProcessing && messageQueue.length > 0) {
        processQueue();
    }
}

// ================== ADAPTADORES (compatibilidade server.ts) ==================

// createConnection compatível com server.ts (recebe name como string)
export async function createConnection(name: string): Promise<void> {
    const id = generateId();
    await createConnectionInternal(id, name);
}

// startCampaign compatível com server.ts (4 argumentos)
export async function startCampaign(
    numbers: string[],
    message: string,
    connectionIds: string[],
    campaignId?: string
): Promise<void> {
    await startCampaignInternal({
        campaignId: campaignId || `campaign_${Date.now()}`,
        numbers,
        message,
        connectionIds,
    });
}

// sendMessage compatível com server.ts (conversationId, text)
// conversationId formato: "connectionId:chatId" ou só número
export async function sendMessage(conversationId: string, text: string): Promise<boolean> {
    // Extrair connectionId e número do conversationId
    const parts = conversationId.split(':');
    let connectionId: string;
    let to: string;

    if (parts.length >= 2) {
        connectionId = parts[0];
        to = parts[parts.length - 1];
    } else {
        // Tentar usar primeira conexão disponível
        const firstConn = connections.keys().next().value;
        if (!firstConn) return false;
        connectionId = firstConn;
        to = conversationId;
    }

    return sendMessageInternal(connectionId, to, text);
}

export function pauseCampaign(campaignId: string) {
    pausedCampaigns.add(campaignId);
    log('info', `⏸️ Campanha pausada: ${campaignId}`);
    if (io) io.emit('campaign-paused', { campaignId });
}

export function resumeCampaign(campaignId: string) {
    pausedCampaigns.delete(campaignId);
    log('info', `▶️ Campanha retomada: ${campaignId}`);
    if (io) io.emit('campaign-resumed', { campaignId });
    if (!isProcessing && messageQueue.length > 0) processQueue();
}

// Export default
export default {
    init,
    createConnection,
    deleteConnection,
    forceQr,
    reconnectConnection,
    sendMessage,
    startCampaign,
    pauseCampaign,
    resumeCampaign,
    applySettings,
    getConnectionState,
    handleWebhook,
    getConnections,
    getMetrics,
    getConversations,
    getWarmupState,
    markWarmupReady,
};
