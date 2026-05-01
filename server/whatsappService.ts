
// --- whatsapp-web.js ---
import whatsapp from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = whatsapp;
type WhatsAppClient = InstanceType<typeof Client>;

import { Server as SocketIOServer, type Socket } from 'socket.io';
import { WhatsAppConnection, ConnectionStatus, DashboardMetrics, Conversation, ChatMessage } from './types.js';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import * as advancedFeatures from './advancedFeatures.js';
import { filterByConnectionScope, isLegacyConnectionId } from '../src/utils/connectionScope.js';
import { GEO_UNKNOWN_UF, phoneDigitsToUf } from '../src/utils/brazilPhoneGeo.js';
import { persistUserNotification } from './userNotificationsFirestore.js';

import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.resolve(projectRoot, process.env.DATA_DIR || 'data');
const connectionsFile = path.join(dataDir, 'connections.json');
/** Cópia de segurança: evita perder `name`/metadados se `connections.json` corromper ou ficar []. */
const connectionsBackupFile = path.join(dataDir, 'connections.backup.json');
const queueFile = path.join(dataDir, 'message_queue.json');
const dlqFile = path.join(dataDir, 'dead_letter_queue.json');
const warmupQueueFile = path.join(dataDir, 'warmup_queue.json');
const warmedNumbersFile = path.join(dataDir, 'warmed_numbers.json');
const authDir = path.resolve(projectRoot, process.env.AUTH_DIR || 'data/.wwebjs_auth');
const webCacheDir = path.join(dataDir, '.wwebjs_cache');

/** Gravado dentro da pasta session-* para reconstruir connections.json após desastre quando o slug ≠ id lógico. */
const ZAPMASS_LOGICAL_ID_MARKER = '.zapmass_connection_id';
/** Regex do whatsapp-web.js LocalAuth (constructor) — outros caracteres geram "Invalid clientId". */
const WA_LOCALAUTH_CLIENT_ID_RE = /^[-_\w]+$/i;

/**
 * clientId / nome da pasta session-* no disco. O id da conexão na API continua sendo o `logicalConnectionId`.
 */
export const whatsappSessionSlugForLogicalId = (logicalConnectionId: string): string => {
    const s = String(logicalConnectionId || '').trim();
    if (!s) return 'empty';
    if (WA_LOCALAUTH_CLIENT_ID_RE.test(s)) return s;
    return `w${crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 47)}`;
};

const waSessionDirPair = (
    logicalId: string
): { slug: string; sessionPath: string; backupPath: string } => {
    const slug = whatsappSessionSlugForLogicalId(logicalId);
    return {
        slug,
        sessionPath: path.join(authDir, `session-${slug}`),
        backupPath: path.join(authDir, `session-${slug}.backup`)
    };
};

async function migrateLegacyWaSessionFolders(logicalId: string): Promise<void> {
    const { slug, sessionPath: targetMain, backupPath: targetBak } = waSessionDirPair(logicalId);
    if (logicalId === slug) return;

    try {
        const hasTarget = await fs.promises.access(targetMain).then(() => true).catch(() => false);
        if (!hasTarget) {
            const legacyMain = path.join(authDir, `session-${logicalId}`);
            const legacyExists = await fs.promises.access(legacyMain).then(() => true).catch(() => false);
            if (legacyExists) {
                await fs.promises.rename(legacyMain, targetMain);
                console.log('[SessionSlug] Pasta da sessao renomeada para clientId compativel com LocalAuth.');
            }
        }
    } catch (e: unknown) {
        console.warn('[SessionSlug] Migracao session principal:', (e as Error)?.message || e);
    }

    try {
        const hasBk = await fs.promises.access(targetBak).then(() => true).catch(() => false);
        if (!hasBk) {
            const legacyBak = path.join(authDir, `session-${logicalId}.backup`);
            const le = await fs.promises.access(legacyBak).then(() => true).catch(() => false);
            if (le) {
                await fs.promises.rename(legacyBak, targetBak);
            }
        }
    } catch (e: unknown) {
        console.warn('[SessionSlug] Migracao backup:', (e as Error)?.message || e);
    }
}

async function writeLogicalIdMarkerToSessionDir(logicalId: string, sessionDir: string): Promise<void> {
    try {
        await fs.promises.writeFile(path.join(sessionDir, ZAPMASS_LOGICAL_ID_MARKER), logicalId, 'utf8');
    } catch {
        /* ignore */
    }
}

// Rate limiting: mensagens por hora
const RATE_LIMIT_PER_HOUR = 100;
const rateLimitTracking = new Map<string, number[]>(); // connectionId -> timestamps[]

// Circuit Breaker: protege contra sobrecarga de tentativas em canal problemático
const circuitBreakers = new Map<string, {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failures: number;
    lastFailureTime: number;
    openUntil?: number;
}>();
const CIRCUIT_BREAKER_THRESHOLD = 5; // falhas
const CIRCUIT_BREAKER_TIMEOUT = 5 * 60 * 1000; // 5 minutos
const CIRCUIT_BREAKER_WINDOW = 60 * 1000; // 1 minuto

// Backoff Exponencial: delays crescentes para retries
const calculateBackoffDelay = (attempts: number): number => {
    // 1s → 2s → 4s → 8s → 16s (máx 16s)
    const baseDelay = 1000;
    const maxDelay = 16000;
    const delay = Math.min(baseDelay * Math.pow(2, attempts - 1), maxDelay);
    return delay;
};

// Proteção contra loop infinito de markedUnread
const markedUnreadRestarts = new Map<string, number[]>();
const MAX_MARKED_UNREAD_RESTARTS = 3; // Máximo 3 restarts por minuto
const MARKED_UNREAD_WINDOW = 60 * 1000; // 1 minuto

// Dynamic settings (updated via applySettings socket event)
const pausedCampaigns = new Set<string>();
const dynamicSettings = { minDelay: 2000, maxDelay: 5000, dailyLimit: 500, sleepMode: false, webhookUrl: '', emailNotif: false };

const canRestartForMarkedUnread = (connectionId: string): boolean => {
    const now = Date.now();
    let restarts = markedUnreadRestarts.get(connectionId) || [];
    
    // Limpar restarts antigos (fora da janela de 1min)
    restarts = restarts.filter(timestamp => now - timestamp < MARKED_UNREAD_WINDOW);
    
    if (restarts.length >= MAX_MARKED_UNREAD_RESTARTS) {
        console.error(`[markedUnread] 🔴 Canal ${connectionId} excedeu limite de ${MAX_MARKED_UNREAD_RESTARTS} restarts/min. Parando.`);
        return false;
    }
    
    restarts.push(now);
    markedUnreadRestarts.set(connectionId, restarts);
    return true;
};

// Cache de contatos: evita consultar getNumberId() repetidamente
const contactCache = new Map<string, { numberId: string; timestamp: number }>();
const CONTACT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

const getCachedNumberId = (phoneNumber: string): string | null => {
    const cached = contactCache.get(phoneNumber);
    if (cached && (Date.now() - cached.timestamp) < CONTACT_CACHE_TTL) {
        return cached.numberId;
    }
    return null;
};

const setCachedNumberId = (phoneNumber: string, numberId: string) => {
    contactCache.set(phoneNumber, { numberId, timestamp: Date.now() });
};

const invalidateCachedNumber = (phoneNumber: string) => {
    contactCache.delete(phoneNumber);
};

// Limpar todo o cache de um canal
const clearCacheForConnection = (connectionId: string) => {
    let cleared = 0;
    for (const [phone, cached] of contactCache.entries()) {
        // Se o cache pertence a este canal, limpar
        contactCache.delete(phone);
        cleared++;
    }
    if (cleared > 0) {
        console.log(`[ContactCache] 🧹 Limpou ${cleared} entradas (canal ${connectionId} reiniciado)`);
    }
};

/** Remove pasta Chromium + backup — necessário ao apagar canal (senão reinício recria entrada vinda de sessão em disco). */
const removeSessionDir = async (connectionId: string) => {
    const { sessionPath, backupPath } = waSessionDirPair(connectionId);
    const legacyMain = path.join(authDir, `session-${connectionId}`);
    const legacyBak = path.join(authDir, `session-${connectionId}.backup`);
    const toRemove = [sessionPath, backupPath];
    if (whatsappSessionSlugForLogicalId(connectionId) !== connectionId) {
        toRemove.push(legacyMain, legacyBak);
    }
    for (const p of toRemove) {
        await fs.promises.rm(p, { recursive: true, force: true }).catch(() => {});
    }
};

// --- VERIFICAÇÃO DUPLA DE CONEXÃO ---
const isClientReallyReady = async (connectionId: string): Promise<boolean> => {
    const client = clients.get(connectionId);
    const connInfo = connectionsInfo.find(c => c.id === connectionId);
    
    // 1. Verificar se cliente existe
    if (!client) {
        console.warn(`[ReadyCheck] Cliente ${connectionId} não existe`);
        return false;
    }
    
    // 2. Verificar se status está CONNECTED
    if (connInfo?.status !== ConnectionStatus.CONNECTED) {
        console.warn(`[ReadyCheck] Canal ${connectionId} status: ${connInfo?.status}`);
        return false;
    }
    
    // CORREÇÃO: Confiar apenas no status do connectionsInfo
    // O getConnectionState() do WPPConnect retorna valores inconsistentes
    console.log(`[ReadyCheck] ✅ Canal ${connectionId} está CONNECTED e client existe`);
    return true;
};

// Ping rápido do canal
const pingChannel = async (connectionId: string): Promise<boolean> => {
    try {
        const isReady = await isClientReallyReady(connectionId);
        if (isReady) {
            console.log(`[Ping] ✅ Canal ${connectionId} respondeu OK`);
        } else {
            console.warn(`[Ping] ❌ Canal ${connectionId} não está pronto`);
        }
        return isReady;
    } catch (error) {
        console.error(`[Ping] ❌ Falha ao pingar canal ${connectionId}:`, error);
        return false;
    }
};

// Detecção de Puppeteer travado
const checkPuppeteerHealth = async (connectionId: string): Promise<boolean> => {
    const client = clients.get(connectionId);
    if (!client) return false;
    
    try {
        // Tentar executar comando simples no navegador (timeout 5s)
        const puppeteerPage = (client as any).pupPage;
        if (!puppeteerPage) return true; // Não tem acesso direto, assume ok
        
        const testPromise = puppeteerPage.evaluate(() => 1 + 1);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Puppeteer timeout')), 5000)
        );
        
        await Promise.race([testPromise, timeoutPromise]);
        return true; // Puppeteer respondeu
    } catch (error) {
        console.error(`[PuppeteerCheck] 🔴 Puppeteer travado no canal ${connectionId}`);
        return false; // Puppeteer travado
    }
};

// Monitor de Puppeteer (roda a cada 60s para canais conectados)
let puppeteerMonitorInterval: NodeJS.Timeout | null = null;

const startPuppeteerMonitor = () => {
    if (process.env.SESSION_PROCESS_MODE === 'api') return;
    if (puppeteerMonitorInterval) return;
    
    puppeteerMonitorInterval = setInterval(async () => {
        for (const conn of connectionsInfo) {
            if (conn.status === ConnectionStatus.CONNECTED) {
                const isHealthy = await checkPuppeteerHealth(conn.id);
                if (!isHealthy) {
                    console.warn(`[PuppeteerMonitor] 🔄 Reiniciando canal ${conn.id} (Puppeteer travado)`);
                    emitCampaignLog('WARN', 'Puppeteer travado, executando restart', {
                        connectionId: conn.id
                    });
                    await reconnectConnection(conn.id).catch(err => {
                        console.error('[PuppeteerMonitor] Falha no restart:', err);
                    });
                }
            }
        }
    }, 60000); // A cada 60s
    
    console.log('[PuppeteerMonitor] 🚀 Iniciado (verifica a cada 60s)');
};

// Estado em memória
let connectionsInfo: WhatsAppConnection[] = [];
const clients = new Map<string, WhatsAppClient>();
let conversations: Conversation[] = [];
let io: SocketIOServer;

/** Worker publica no Redis; processo API com Socket.IO real emite para o browser. */
type OwnerEmitFn = (uid: string, event: string, payload: Record<string, unknown>) => void;
let ownerEmitRedisBridge: OwnerEmitFn | null = null;
export const setOwnerEmitRedisBridge = (fn: OwnerEmitFn | null) => {
    ownerEmitRedisBridge = fn;
};

const MAX_MESSAGES = 10000; // cap generoso para permitir historico completo quando carregado sob demanda
const MAX_CONVERSATIONS = 200;
const MAX_RECONNECT_ATTEMPTS = 10;
const reconnectState = new Map<string, { attempts: number; timeout?: NodeJS.Timeout }>();
const webFixInProgress = new Map<string, number>(); // connectionId -> lastAttemptMs
const healthCheckIntervals = new Map<string, NodeJS.Timeout>(); // connectionId -> interval
const channelQualityMetrics = new Map<string, {
    successCount: number;
    failCount: number;
    totalAttempts: number;
    lastSuccessTimestamp?: number;
    avgLatency: number;
    uptime: number;
    healthScore: number;
}>();

const clearWebCache = async (connectionId?: string) => {
    try {
        if (connectionId) {
            console.log(`[Cache] Limpando cache específico para ${connectionId}...`);
            const { sessionPath } = waSessionDirPair(connectionId);
            const localCachePath = path.join(sessionPath, 'Default', 'Cache');
            const localCodeCachePath = path.join(sessionPath, 'Default', 'Code Cache');
            
            await Promise.all([
                fs.promises.rm(localCachePath, { recursive: true, force: true }).catch(() => {}),
                fs.promises.rm(localCodeCachePath, { recursive: true, force: true }).catch(() => {})
            ]);
        } else {
            console.log(`[Cache] Limpando cache global do WhatsApp Web...`);
            await fs.promises.rm(webCacheDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.warn('[Cache] Erro ao limpar cache:', e);
    }
};

const ensureDataDir = async () => {
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.mkdir(webCacheDir, { recursive: true });
    await fs.promises.mkdir(authDir, { recursive: true });
};

/** Pastas Chromium de cópia de segurança (`session-xx.backup`) geravam canais fantasmas se listadas ao reconstruir a lista. */
const isPhantomSessionBackupConnectionId = (id: unknown): boolean =>
    typeof id === 'string' && id.length > 0 && id.endsWith('.backup');

/** Remove sufixo errado quando o nome veio por engano da pasta `.backup`. */
const sanitizeFallbackConnectionName = <T extends WhatsAppConnection>(rest: T): string => {
    const n = rest.name;
    if (typeof n === 'string' && n.startsWith('WhatsApp · ') && /\.backup$/i.test(n)) {
        return n.replace(/\.backup$/i, '').trim();
    }
    return n;
};

/** Tenta recuperar nome/metadados gravados mesmo se connections.json principal estiver vazio ou corrompido. */
const readAnyConnectionsSnapshotById = async (): Promise<Map<string, WhatsAppConnection>> => {
    const byId = new Map<string, WhatsAppConnection>();
    for (const fp of [connectionsFile, connectionsBackupFile]) {
        try {
            const raw = await fs.promises.readFile(fp, 'utf8');
            const parsed = JSON.parse(raw) as WhatsAppConnection[];
            if (!Array.isArray(parsed)) continue;
            for (const c of parsed) {
                if (!c || typeof c.id !== 'string' || c.id.length === 0 || byId.has(c.id)) continue;
                if (isPhantomSessionBackupConnectionId(c.id)) continue;
                byId.set(c.id, c);
            }
        } catch {
            /* ignora arquivo ausente ou JSON inválido */
        }
    }
    return byId;
};

const loadConnectionsFromAuth = async () => {
    try {
        await fs.promises.mkdir(authDir, { recursive: true });
        const entries = await fs.promises.readdir(authDir, { withFileTypes: true });
        /** Backup de Chromium fica em `session-{slug}.backup` — não é uma segunda sessão. */
        const dirSlugs = entries
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('session-'))
            .filter((entry) => !entry.name.endsWith('.backup'))
            .map((entry) => entry.name.replace('session-', ''))
            .filter(Boolean);

        if (dirSlugs.length === 0) return;

        const snapshotById = await readAnyConnectionsSnapshotById();
        const rebuilt: WhatsAppConnection[] = [];

        for (const slug of dirSlugs) {
            const sessionDirPath = path.join(authDir, `session-${slug}`);
            let logicalId = slug;
            try {
                const markerRaw = (
                    await fs.promises
                        .readFile(path.join(sessionDirPath, ZAPMASS_LOGICAL_ID_MARKER), 'utf8')
                        .catch(() => '')
                ).trim();
                if (markerRaw) logicalId = markerRaw;
            } catch {
                /* usar slug */
            }

            if (
                slug.startsWith('w') &&
                /^w[a-f0-9]{47}$/.test(slug) &&
                logicalId === slug &&
                !snapshotById.has(slug)
            ) {
                console.warn(
                    `[Connections] Ignorando pasta orfa ${path.basename(sessionDirPath)} (sem marker e sem snapshot)`
                );
                continue;
            }

            const prev = snapshotById.get(logicalId);
            if (prev) {
                rebuilt.push({
                    ...prev,
                    name: sanitizeFallbackConnectionName(prev),
                    status: ConnectionStatus.CONNECTING,
                    lastActivity: 'Restaurando sessao...',
                    queueSize: prev.queueSize || 0,
                    messagesSentToday: prev.messagesSentToday || 0,
                    signalStrength: prev.signalStrength || 'STRONG',
                    batteryLevel: prev.batteryLevel ?? 0
                });
                continue;
            }

            const shortLabel = logicalId.includes('__')
                ? (logicalId.split('__').pop()?.slice(-8) || logicalId.slice(-8))
                : logicalId.slice(-8);
            const tail = shortLabel.replace(/\.backup$/i, '').trim() || shortLabel;
            rebuilt.push({
                id: logicalId,
                name: `WhatsApp · ${tail}`,
                phoneNumber: null,
                status: ConnectionStatus.CONNECTING,
                lastActivity: 'Restaurando sessao...',
                queueSize: 0,
                messagesSentToday: 0,
                signalStrength: 'STRONG',
                batteryLevel: 0
            });
        }

        const uniqById = new Map<string, WhatsAppConnection>();
        for (const row of rebuilt) {
            const prevRow = uniqById.get(row.id);
            if (!prevRow) {
                uniqById.set(row.id, row);
                continue;
            }
            const prevFallback = prevRow.name.startsWith('WhatsApp ·');
            const rowFallback = row.name.startsWith('WhatsApp ·');
            if (prevFallback && !rowFallback) {
                uniqById.set(row.id, row);
            }
        }

        connectionsInfo = [...uniqById.values()];
        await persistConnections();
    } catch {
        // Ignora se nao conseguir ler a pasta de auth
    }
};

const stripQrForDisk = (list: WhatsAppConnection[]): Omit<WhatsAppConnection, 'qrCode'>[] =>
    list.map((c) => {
        const { qrCode: _q, ...rest } = c as WhatsAppConnection & { qrCode?: string };
        return rest;
    });

const persistConnections = async () => {
    await ensureDataDir();
    try {
        const data = JSON.stringify(stripQrForDisk(connectionsInfo), null, 2);
        await fs.promises.writeFile(connectionsFile, data, 'utf8');
        await fs.promises.copyFile(connectionsFile, connectionsBackupFile).catch((e) => {
            console.warn('[Connections] Nao foi possivel gravar backup:', (e as Error)?.message || e);
        });
    } catch (e) {
        console.error('[Connections] Falha ao persistir connections.json:', e);
        throw e;
    }
};

const loadConnections = async () => {
    try {
        const tryFiles = [connectionsFile, connectionsBackupFile];
        for (const fp of tryFiles) {
            try {
                const raw = await fs.promises.readFile(fp, 'utf8');
                const parsed = JSON.parse(raw) as WhatsAppConnection[];
                if (!Array.isArray(parsed) || parsed.length === 0) {
                    continue;
                }
                const headlessApi = process.env.SESSION_PROCESS_MODE === 'api';
                connectionsInfo = parsed
                    .filter((conn) => !isPhantomSessionBackupConnectionId(conn?.id))
                    .map((conn) => {
                    const { qrCode: _drop, ...rest } = conn as WhatsAppConnection & { qrCode?: string };
                    const name = sanitizeFallbackConnectionName(rest);
                    return {
                        ...rest,
                        name,
                        status: headlessApi ? (rest.status ?? ConnectionStatus.CONNECTING) : ConnectionStatus.CONNECTING,
                        lastActivity: headlessApi ? (rest.lastActivity ?? 'Sincronizando estado…') : 'Restaurando sessao...',
                        queueSize: rest.queueSize || 0,
                        messagesSentToday: rest.messagesSentToday || 0,
                        signalStrength: rest.signalStrength || 'STRONG'
                    };
                });
                const needsConnectionsFileHeal =
                    fp === connectionsFile &&
                    (parsed.some((c) => isPhantomSessionBackupConnectionId(c?.id)) ||
                        parsed.some((c) => {
                            if (!c || typeof c.name !== 'string') return false;
                            return (
                                c.name.startsWith('WhatsApp · ') &&
                                /\.backup$/i.test(c.name) &&
                                sanitizeFallbackConnectionName(c as WhatsAppConnection) !== c.name
                            );
                        }));
                if (needsConnectionsFileHeal) {
                    void persistConnections().catch(() => {});
                }
                if (fp !== connectionsFile) {
                    console.warn(
                        `[Connections] connections.json ausente ou vazio — recuperado backup (${connectionsInfo.length} canais)`
                    );
                }
                return;
            } catch {
                /* próximo arquivo */
            }
        }
        connectionsInfo = [];
    } catch {
        connectionsInfo = [];
    }
};

/** No modo API headless, o worker grava connections.json; aqui só reflectimos o ficheiro. */
let connectionsFileSyncTimer: NodeJS.Timeout | null = null;
const startConnectionsFileSyncFromWorker = () => {
    if (connectionsFileSyncTimer) return;
    console.log('[whatsapp] Sync connections.json (4s) — estado real no worker');
    connectionsFileSyncTimer = setInterval(async () => {
        try {
            const raw = await fs.promises.readFile(connectionsFile, 'utf8');
            const parsed = JSON.parse(raw) as WhatsAppConnection[];
            const next = parsed
                .filter((conn) => !isPhantomSessionBackupConnectionId(conn?.id))
                .map((conn) => {
                    const { qrCode: _drop, ...rest } = conn as WhatsAppConnection & { qrCode?: string };
                    const name = sanitizeFallbackConnectionName(rest);
                    return {
                        ...rest,
                        name,
                        status: rest.status ?? ConnectionStatus.CONNECTING,
                        lastActivity: rest.lastActivity ?? '—',
                        queueSize: rest.queueSize || 0,
                        messagesSentToday: rest.messagesSentToday || 0,
                        signalStrength: rest.signalStrength || 'STRONG'
                    };
                });
            for (const c of next) {
                if (c.status === ConnectionStatus.CONNECTED || c.status === ConnectionStatus.DISCONNECTED) {
                    bridgeQrByConnectionId.delete(c.id);
                }
            }
            const prevIds = JSON.stringify(connectionsInfo.map((c) => ({ id: c.id, status: c.status })));
            const nextIds = JSON.stringify(next.map((c) => ({ id: c.id, status: c.status })));
            connectionsInfo = next;
            if (prevIds !== nextIds) {
                emitConnectionsUpdate();
            }
        } catch {
            /* ignorar */
        }
    }, 4000);
};

interface QueueItem {
    to: string;
    message: string;
    connectionId: string;
    /** Outros chips que participam da mesma campanha (failover quando o principal falha). */
    alternateChannelIds?: string[];
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    attempts?: number;
    totalAttempts?: number; // Tentativas totais (incluindo após restarts)
    lastError?: string;
    /** Campanha associada (pausa, funil, UI) — importante apos fila inicial em fluxo por resposta. */
    queueCampaignId?: string;
    /** Apos envio bem-sucedido, registra sessao aguardando resposta (somente abertura do fluxo). */
    replyFlowOpen?: { campaignId: string; phoneDigits: string; vars: Record<string, string> };
    /** Apos envio bem-sucedido, atualiza etapa aguardada na sessao. */
    replyFlowAfterSend?: { phoneDigits: string; newAwaitingAfterStep: number };
}

let messageQueue: QueueItem[] = [];
let isProcessingQueue = false;
const MAX_QUEUE_ATTEMPTS = 5;

interface WarmupItem {
    to: string;
    connectionId: string;
    message: string;
    campaignId?: string;
    createdAt: string;
    reason: string;
}

let warmupQueue: WarmupItem[] = [];
const warmedNumbers = new Set<string>();

// =====================================================================
// ESTATISTICAS DE AQUECIMENTO POR CHIP (persistente)
// Cada chip tem historico diario de mensagens enviadas/recebidas/falhas
// e um `firstWarmedAt` usado para calcular a "maturidade" do aquecimento.
// =====================================================================
interface WarmupDailyEntry {
    date: string; // YYYY-MM-DD
    sent: number;
    received: number;
    failed: number;
}
interface WarmupChipStats {
    connectionId: string;
    firstWarmedAt?: number;
    lastActiveAt?: number;
    totalSent: number;
    totalReceived: number;
    totalFailed: number;
    dailyHistory: WarmupDailyEntry[];
}

const warmupChipStatsFile = path.join(dataDir, 'warmup_chip_stats.json');
let warmupChipStats = new Map<string, WarmupChipStats>();
let warmupStatsSaveTimer: NodeJS.Timeout | null = null;

const WARMUP_HISTORY_DAYS = 30;
const todayKey = (ts: number = Date.now()) => {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
};

const loadWarmupChipStats = async () => {
    try {
        const raw = await fs.promises.readFile(warmupChipStatsFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            warmupChipStats = new Map(parsed.map((s: WarmupChipStats) => [s.connectionId, s]));
            console.log(`[WarmupChipStats] Carregado historico de ${warmupChipStats.size} chip(s).`);
        }
    } catch {
        console.log('[WarmupChipStats] Nenhum historico encontrado — iniciando do zero.');
    }
};

const scheduleWarmupStatsSave = () => {
    if (warmupStatsSaveTimer) return;
    warmupStatsSaveTimer = setTimeout(async () => {
        warmupStatsSaveTimer = null;
        try {
            const payload = Array.from(warmupChipStats.values());
            await fs.promises.writeFile(warmupChipStatsFile, JSON.stringify(payload, null, 2), 'utf8');
        } catch (e: any) {
            console.error('[WarmupChipStats] Erro ao salvar:', e?.message || e);
        }
    }, 1500);
};

const getOrCreateChipStats = (connectionId: string): WarmupChipStats => {
    let stats = warmupChipStats.get(connectionId);
    if (!stats) {
        stats = {
            connectionId,
            firstWarmedAt: undefined,
            lastActiveAt: undefined,
            totalSent: 0,
            totalReceived: 0,
            totalFailed: 0,
            dailyHistory: []
        };
        warmupChipStats.set(connectionId, stats);
    }
    return stats;
};

const ensureTodayEntry = (stats: WarmupChipStats): WarmupDailyEntry => {
    const key = todayKey();
    let entry = stats.dailyHistory.find((d) => d.date === key);
    if (!entry) {
        entry = { date: key, sent: 0, received: 0, failed: 0 };
        stats.dailyHistory.push(entry);
        // mantem somente os ultimos N dias
        if (stats.dailyHistory.length > WARMUP_HISTORY_DAYS) {
            stats.dailyHistory = stats.dailyHistory.slice(-WARMUP_HISTORY_DAYS);
        }
    }
    return entry;
};

const getConnectedSocketsSafe = (): Socket[] => {
    try {
        const socketsMap = (io as any)?.sockets?.sockets;
        if (!socketsMap || typeof socketsMap.values !== 'function') return [];
        return Array.from(socketsMap.values()) as Socket[];
    } catch {
        return [];
    }
};

const emitWarmupChipStats = () => {
    if (!io) return;
    const list = Array.from(warmupChipStats.values());
    for (const socket of getConnectedSocketsSafe()) {
        const uid = String((socket.data as { uid?: string }).uid ?? 'anonymous');
        socket.emit('warmup-chip-stats-update', filterByConnectionScope(uid, list));
    }
};

const ownerUidFromConnectionId = (connectionId?: string): string | null => {
    if (!connectionId || typeof connectionId !== 'string') return null;
    const idx = connectionId.indexOf('__');
    if (idx <= 0) return null;
    return connectionId.slice(0, idx);
};

/** No processo API (sem Chromium), o worker envia QR via Redis; gravamos aqui para enriquecer `connections-update`. */
const bridgeQrByConnectionId = new Map<string, string>();

const mergeBridgeQrIntoConnections = (list: WhatsAppConnection[]): WhatsAppConnection[] =>
    bridgeQrByConnectionId.size === 0
        ? list
        : list.map((c) => {
              const bridged = bridgeQrByConnectionId.get(c.id);
              return bridged ? { ...c, qrCode: bridged } : c;
          });

const emitConnectionsUpdate = () => {
    if (!io) return;
    for (const socket of getConnectedSocketsSafe()) {
        const uid = String((socket.data as { uid?: string }).uid ?? 'anonymous');
        socket.emit('connections-update', mergeBridgeQrIntoConnections(filterByConnectionScope(uid, connectionsInfo)));
    }
};

/**
 * Chamado pela subscricao Redis na API sempre que o worker publicar um evento ao dono da sessao.
 * Mantém o QR em RAM para proximos `connections-update` (fallback da UI quando a ordem de eventos falha).
 */
export const ingestOwnerBridgedSocketEvent = (event: string, payload?: Record<string, unknown>) => {
    if ((process.env.SESSION_PROCESS_MODE || '').trim() !== 'api') return;
    const connectionId =
        typeof payload?.connectionId === 'string' && payload.connectionId ? String(payload.connectionId) : '';
    if (!connectionId) return;

    const clearBridgedQr = (): void => {
        if (bridgeQrByConnectionId.delete(connectionId)) {
            emitConnectionsUpdate();
        }
    };

    if (event === 'qr-code') {
        const qr = typeof payload?.qrCode === 'string' ? payload.qrCode : '';
        if (qr.trim().length > 0) {
            bridgeQrByConnectionId.set(connectionId, qr);
            emitConnectionsUpdate();
        }
        return;
    }
    if (
        event === 'connection-authenticated' ||
        event === 'connection-ready' ||
        event === 'auth-failure' ||
        event === 'connection-init-failure'
    ) {
        clearBridgedQr();
        return;
    }
};

const resolveConnectionOwnerUid = (connectionId: string): string | null => {
    const fromId = ownerUidFromConnectionId(connectionId);
    if (fromId) return fromId;
    const row = connectionsInfo.find((c) => c.id === connectionId);
    const fromRow = row && typeof (row as { ownerUid?: string }).ownerUid === 'string' ? (row as { ownerUid: string }).ownerUid : '';
    return fromRow || null;
};

const emitToConnectionOwner = (event: string, connectionId: string, payload: Record<string, unknown>) => {
    if (isLegacyConnectionId(connectionId)) {
        const ouid = resolveConnectionOwnerUid(connectionId);
        if (ouid) {
            if (ownerEmitRedisBridge) {
                ownerEmitRedisBridge(ouid, event, payload);
                return;
            }
            if (io) io.to(`user:${ouid}`).emit(event, payload);
            return;
        }
        if (!io) return;
        for (const socket of getConnectedSocketsSafe()) {
            const uid = String((socket.data as { uid?: string }).uid ?? 'anonymous');
            if (!uid || uid === 'anonymous') socket.emit(event, payload);
        }
        return;
    }
    const targetUid = resolveConnectionOwnerUid(connectionId);
    if (!targetUid) {
        console.warn(`[emitToConnectionOwner] sem dono para conexao ${connectionId} (${event})`);
        return;
    }
    if (ownerEmitRedisBridge) {
        ownerEmitRedisBridge(targetUid, event, payload);
        return;
    }
    if (!io) return;
    io.to(`user:${targetUid}`).emit(event, payload);
};

const emitToOwnerUid = (event: string, ownerUid: string | undefined, payload: Record<string, unknown>) => {
    if (!io || !ownerUid) return;
    io.to(`user:${ownerUid}`).emit(event, payload);
};

/**
 * Variante exportada de `emitToOwnerUid`. Usa o bridge Redis quando disponível
 * (modo `api`+`worker`); cai para `io` local caso contrário. Útil para componentes
 * fora deste módulo (ex.: control plane) que precisam notificar um utilizador
 * sem ter um `connectionId` ainda — por exemplo, antes de criar uma conexão.
 */
export const publishOwnerEvent = (
    ownerUid: string | undefined,
    event: string,
    payload: Record<string, unknown>
): void => {
    if (!ownerUid) return;
    if (ownerEmitRedisBridge) {
        ownerEmitRedisBridge(ownerUid, event, payload);
        return;
    }
    if (!io) return;
    io.to(`user:${ownerUid}`).emit(event, payload);
};

/** Aviso ao utilizador (socket) quando o runner de campanhas agendadas adia ou falha ao iniciar. */
export function emitScheduledCampaignUserNotice(
    ownerUid: string | undefined,
    payload: {
        message: string;
        campaignId?: string;
        kind?: 'retry' | 'no_chip' | 'subscription';
    }
): void {
    emitToOwnerUid('scheduled-campaign-notice', ownerUid, {
        message: payload.message,
        campaignId: payload.campaignId ?? '',
        kind: payload.kind ?? 'retry'
    });
    const k = payload.kind ?? 'retry';
    const title =
        k === 'subscription'
            ? 'Assinatura e agendamento'
            : k === 'no_chip'
              ? 'Nenhum chip conectado'
              : 'Agendamento reprogramado';
    void persistUserNotification(String(ownerUid || ''), {
        title,
        body: payload.message,
        kind: k === 'subscription' ? 'error' : k === 'no_chip' ? 'warning' : 'info',
        category: 'schedule',
        campaignId: payload.campaignId
    }).catch(() => {});
}

export const getWarmupChipStats = (): WarmupChipStats[] => Array.from(warmupChipStats.values());

const recordWarmupSent = (fromId: string, toPhone: string) => {
    const now = Date.now();
    const fromStats = getOrCreateChipStats(fromId);
    if (!fromStats.firstWarmedAt) fromStats.firstWarmedAt = now;
    fromStats.lastActiveAt = now;
    fromStats.totalSent += 1;
    ensureTodayEntry(fromStats).sent += 1;

    // Se o destino eh um dos nossos proprios chips, contabiliza "recebida" nele
    const normalized = toPhone.replace(/\D/g, '');
    const targetConn = connectionsInfo.find((c) => (c.phoneNumber || '').replace(/\D/g, '') === normalized);
    if (targetConn) {
        const toStats = getOrCreateChipStats(targetConn.id);
        if (!toStats.firstWarmedAt) toStats.firstWarmedAt = now;
        toStats.lastActiveAt = now;
        toStats.totalReceived += 1;
        ensureTodayEntry(toStats).received += 1;
    }

    scheduleWarmupStatsSave();
    emitWarmupChipStats();
};

const recordWarmupFailed = (fromId: string) => {
    const stats = getOrCreateChipStats(fromId);
    stats.totalFailed += 1;
    ensureTodayEntry(stats).failed += 1;
    scheduleWarmupStatsSave();
    emitWarmupChipStats();
};

export const clearWarmupChipStats = (connectionId?: string) => {
    if (connectionId) {
        warmupChipStats.delete(connectionId);
    } else {
        warmupChipStats.clear();
    }
    scheduleWarmupStatsSave();
    emitWarmupChipStats();
};

const normalizeNumber = (raw: string) => {
    let formatted = raw.replace(/\D/g, '');
    if (!formatted.startsWith('55') && formatted.length >= 10) {
        formatted = `55${formatted}`;
    }
    return formatted;
};

/** Variantes BR com/sem 9º dígito (mesma lógica da fila de campanha). */
const buildBrE164Variants = (formattedNum: string): string[] => {
    const variants: string[] = [formattedNum];
    if (formattedNum.startsWith('55') && formattedNum.length === 13 && formattedNum[4] === '9') {
        const ddd = formattedNum.substring(2, 4);
        const rest = formattedNum.substring(5);
        variants.push(`55${ddd}${rest}`);
    } else if (formattedNum.startsWith('55') && formattedNum.length === 12) {
        const ddd = formattedNum.substring(2, 4);
        const rest = formattedNum.substring(4);
        variants.push(`55${ddd}9${rest}`);
    }
    return variants;
};

/**
 * WhatsApp Web passou a exigir mapeamento LID↔PN para envios a alguns contatos.
 * O whatsapp-web.js injeta `enforceLidAndPnRetrieval` (src/util/Injected/Utils.js).
 * Combinamos isso com `getNumberId` para obter o JID canônico (@lid ou @c.us).
 */
const resolveBestUserJidForSend = async (client: WhatsAppClient, rawChatId: string): Promise<string> => {
    const raw = String(rawChatId || '').trim();
    if (raw.includes('@g.us')) return raw;
    if (raw.endsWith('@lid')) return raw;

    const withCus = raw.includes('@') ? raw : `${raw.replace(/\D/g, '')}@c.us`;

    const pupPage = (client as { pupPage?: { evaluate: <T>(fn: (...args: unknown[]) => T | Promise<T>, ...args: unknown[]) => Promise<T> } }).pupPage;
    if (pupPage) {
        try {
            const fromBrowser = await pupPage.evaluate(async (cid: string) => {
                const W = (window as unknown as { WWebJS?: { enforceLidAndPnRetrieval?: (id: string) => Promise<{ lid?: { _serialized?: string }; phone?: { _serialized?: string } }> } }).WWebJS;
                if (!W || typeof W.enforceLidAndPnRetrieval !== 'function') return null;
                try {
                    const out = await W.enforceLidAndPnRetrieval(cid);
                    const ser = (w?: { _serialized?: string }) =>
                        w && typeof w._serialized === 'string' ? w._serialized : '';
                    return ser(out?.lid) || ser(out?.phone) || null;
                } catch {
                    return null;
                }
            }, withCus);
            if (typeof fromBrowser === 'string' && fromBrowser.length > 3) return fromBrowser;
        } catch (e) {
            console.warn('[LID] enforceLidAndPnRetrieval:', (e as Error)?.message || e);
        }
    }

    const digitPart = withCus.split('@')[0].replace(/\D/g, '');
    if (digitPart.length < 10) return withCus;

    const formatted = normalizeNumber(digitPart);
    for (const v of buildBrE164Variants(formatted)) {
        const wid = await client.getNumberId(v).catch(() => null);
        const ser = wid && typeof (wid as { _serialized?: string })._serialized === 'string' ? (wid as { _serialized: string })._serialized : '';
        if (ser) return ser;
    }
    return withCus;
};

/** Evita evaluate/getNumberId extra quando o JID já é grupo ou @lid. */
const maybeResolveUserJidForSend = async (client: WhatsAppClient, chatId: string): Promise<string> => {
    const raw = String(chatId || '');
    if (raw.includes('@g.us') || raw.endsWith('@lid')) return raw;
    return resolveBestUserJidForSend(client, raw);
};

/**
 * getNumberId() às vezes devolve null por instabilidade do WhatsApp Web, não porque o número seja inválido.
 * Várias rodadas curtas reduzem falso positivo de "numero não registrado".
 */
const resolveNumberIdsWithRetries = async (
    client: WhatsAppClient,
    variants: string[],
    rounds = 3,
    pauseMs = 900
): Promise<string | null> => {
    for (let round = 0; round < rounds; round++) {
        for (const variant of variants) {
            try {
                const resolvedId = await client.getNumberId(variant);
                if (resolvedId?._serialized) {
                    return resolvedId._serialized;
                }
            } catch {
                /* próxima variante / rodada */
            }
        }
        if (round < rounds - 1) {
            await new Promise((r) => setTimeout(r, pauseMs));
        }
    }
    return null;
};

/** Erro típico do Puppeteer/Chromium quando o bundle do WhatsApp Web mudou e o whatsapp-web.js ficou atrás da versão. */
const isLikelyGetChatEvaluateError = (raw: string): boolean => {
    const msg = String(raw || '');
    if (
        msg.includes("reading 'getChat'") ||
        msg.includes('reading "getChat"') ||
        /Cannot read properties of undefined\s*\(\s*reading\s+[`'"]getChat[`'"]\s*\)/i.test(msg)
    ) {
        return true;
    }
    if (/\bgetchat\b/i.test(msg) && /(undefined|null|not a function|cannot read)/i.test(msg)) {
        return true;
    }
    if (/evaluation failed/i.test(msg) && /\b(getchat|wwebjs|whatsapp web|@\w+)/i.test(msg)) {
        return true;
    }
    return false;
};

const formatSendError = (rawMessage?: string) => {
    const msg = rawMessage || 'Falha ao enviar mensagem';
    const lower = msg.toLowerCase();
    if (isLikelyGetChatEvaluateError(msg) || msg.includes('getChat')) {
        return 'Incompatibilidade ou instabilidade ao abrir conversa no WhatsApp Web. Atualize o servidor (whatsapp-web.js), reconecte o canal e tente de novo.';
    }
    if (msg.includes('No LID for user')) {
        return 'WhatsApp ainda nao associou este contato (LID). Abra o chat com o numero no WhatsApp Web/celular e tente de novo, ou confira o 9º digito.';
    }
    if (
        msg.includes('not registered') ||
        msg.includes('Number not found') ||
        lower.includes('not a whatsapp') ||
        lower.includes('is not on whatsapp') ||
        lower.includes('no whatsapp account')
    ) {
        return 'Número sem WhatsApp ou não encontrado. Confira DDD, 9º dígito (celular BR) e se o contato usa WhatsApp.';
    }
    if (msg.includes('Invalid') || msg.includes('invalid')) {
        return 'Numero invalido';
    }
    return msg;
};

/** Disparo em massa: evita sendSeen (paths sensíveis no WA-Web) e link preview por mensagem. */
const CAMPAIGN_TEXT_SEND_OPTS = { sendSeen: false, linkPreview: false };

const emitCampaignLog = (level: 'INFO' | 'WARN' | 'ERROR', message: string, payload?: Record<string, unknown>) => {
    emitToOwnerUid('campaign-log', currentCampaign.ownerUid, {
        timestamp: new Date().toISOString(),
        level,
        message,
        payload: {
            campaignId: currentCampaign.campaignId,
            ...payload
        }
    });
    console.log(`[Campaign:${level}] ${message}`, payload || '');
};

let currentCampaign = {
    isRunning: false,
    total: 0,
    processed: 0,
    successCount: 0,
    failCount: 0,
    campaignId: undefined as string | undefined,
    ownerUid: undefined as string | undefined,
    lastLoggedProcessed: 0,
    startTime: 0
};

/** Fila global de disparo em massa: evita iniciar outra campanha enquanto uma está ativa. */
export const isMassCampaignEngineIdle = (): boolean => !currentCampaign.isRunning;

let metrics: DashboardMetrics = {
  totalSent: 0,
  totalDelivered: 0,
  totalRead: 0,
  totalReplied: 0
};

// =====================================================================
// FUNNEL STATS (acumulador persistente — sobrevive a restart e a delecao
// de campanhas). Todas as alteracoes sao via incrementFunnel/clearFunnel
// para garantir persistencia em disco e broadcast para clientes.
// =====================================================================
interface PersistedFunnelStats {
    totalSent: number;
    totalDelivered: number;
    totalRead: number;
    totalReplied: number;
    updatedAt: number;
    clearedAt?: number;
}

interface PersistedFunnelStatsFileV2 {
    version: 2;
    global: PersistedFunnelStats;
    byOwner: Record<string, PersistedFunnelStats>;
}

const funnelStatsFile = path.join(dataDir, 'funnel_stats.json');
const campaignGeoFile = path.join(dataDir, 'campaign_geography.json');

const makeEmptyFunnelStats = (): PersistedFunnelStats => ({
    totalSent: 0,
    totalDelivered: 0,
    totalRead: 0,
    totalReplied: 0,
    updatedAt: Date.now()
});

const normalizeFunnelStats = (raw?: Partial<PersistedFunnelStats> | null): PersistedFunnelStats => ({
    totalSent: Number(raw?.totalSent) || 0,
    totalDelivered: Number(raw?.totalDelivered) || 0,
    totalRead: Number(raw?.totalRead) || 0,
    totalReplied: Number(raw?.totalReplied) || 0,
    updatedAt: Number(raw?.updatedAt) || Date.now(),
    clearedAt: raw?.clearedAt
});

let funnelStats: PersistedFunnelStats = makeEmptyFunnelStats();
const funnelStatsByOwner = new Map<string, PersistedFunnelStats>();
const hasAnyFunnelData = (stats: PersistedFunnelStats): boolean =>
    (Number(stats.totalSent) || 0) > 0
    || (Number(stats.totalDelivered) || 0) > 0
    || (Number(stats.totalRead) || 0) > 0
    || (Number(stats.totalReplied) || 0) > 0;

// Rastreia em memoria (rebuild a cada restart) o estado de ack ja contabilizado
// por mensagem de campanha, evitando dupla contagem quando o WhatsApp dispara
// varios acks para o mesmo msg id. 0=nenhum, 1=delivered, 2=read.
const campaignAckLevel = new Map<string, 0 | 1 | 2>();

/** msgId -> campanha + UF (ou OUT) para ack no mapa */
const campaignMsgMeta = new Map<string, { campaignId: string; uf: string }>();

type CampaignGeoUf = { delivered: number; read: number; replied: number };
const campaignGeoById = new Map<string, Record<string, CampaignGeoUf>>();
const campaignGeoOwnerById = new Map<string, string | undefined>();
let campaignGeoEmitTimer: NodeJS.Timeout | null = null;
let campaignGeoEmitPendingId: string | null = null;

// Para cada conversa, lista de timestamps de disparos de campanha que ainda
// nao receberam reply contabilizado. Quando chega um msg incoming 'them',
// pega o disparo mais recente <= ts, marca como contabilizado e incrementa replied.
interface PendingCampaignSend { ts: number; counted: boolean; campaignId?: string; ownerUid?: string }
const pendingCampaignSendsByConv = new Map<string, PendingCampaignSend[]>();

let funnelSaveTimer: NodeJS.Timeout | null = null;
const scheduleFunnelSave = () => {
    if (funnelSaveTimer) return;
    funnelSaveTimer = setTimeout(() => {
        funnelSaveTimer = null;
        const byOwner: Record<string, PersistedFunnelStats> = {};
        for (const [uid, stats] of funnelStatsByOwner.entries()) {
            byOwner[uid] = { ...stats };
        }
        fs.promises
            .writeFile(
                funnelStatsFile,
                JSON.stringify({ version: 2, global: funnelStats, byOwner } satisfies PersistedFunnelStatsFileV2, null, 2),
                'utf-8'
            )
            .catch((err) => console.error('[FunnelStats] Falha ao persistir:', err?.message || err));
    }, 1500);
};

/** Dono do funil em tempo real: campanha ativa / ultima campanha com geo persistida. */
const funnelStatsRecipientUid = (): string | undefined => {
    if (currentCampaign.ownerUid) return currentCampaign.ownerUid;
    const cid = currentCampaign.campaignId;
    if (cid) return campaignGeoOwnerById.get(cid);
    return undefined;
};

const ownerFunnelStats = (ownerUid: string | undefined): PersistedFunnelStats | null => {
    if (!ownerUid || ownerUid === 'anonymous') return null;
    const existing = funnelStatsByOwner.get(ownerUid);
    if (existing) return existing;
    // Compatibilidade com formato legado: se ainda nao existe bucket por owner
    // e havia historico global salvo, migra para o primeiro usuario autenticado
    // que efetivamente usar o funil.
    const seeded =
        funnelStatsByOwner.size === 0 && hasAnyFunnelData(funnelStats)
            ? normalizeFunnelStats(funnelStats)
            : makeEmptyFunnelStats();
    funnelStatsByOwner.set(ownerUid, seeded);
    return seeded;
};

const incrementOwnerFunnel = (
    ownerUid: string | undefined,
    delta: Partial<Pick<PersistedFunnelStats, 'totalSent' | 'totalDelivered' | 'totalRead' | 'totalReplied'>>
) => {
    const target = ownerFunnelStats(ownerUid);
    if (!target) return;
    target.totalSent += Number(delta.totalSent) || 0;
    target.totalDelivered += Number(delta.totalDelivered) || 0;
    target.totalRead += Number(delta.totalRead) || 0;
    target.totalReplied += Number(delta.totalReplied) || 0;
    target.updatedAt = Date.now();
};

const emitFunnelStats = (ownerUidHint?: string) => {
    if (!io) return;
    const owner = ownerUidHint || funnelStatsRecipientUid();
    const payload = {
        ...(owner ? ownerFunnelStats(owner) || makeEmptyFunnelStats() : funnelStats)
    };
    if (owner) {
        io.to(`user:${owner}`).emit('funnel-stats-update', payload);
    }
};

const loadFunnelStats = async () => {
    try {
        if (!fs.existsSync(funnelStatsFile)) return;
        const raw = await fs.promises.readFile(funnelStatsFile, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedFunnelStatsFileV2> & Partial<PersistedFunnelStats>;
        funnelStatsByOwner.clear();
        if (parsed && parsed.version === 2 && parsed.global) {
            funnelStats = normalizeFunnelStats(parsed.global);
            const owners = parsed.byOwner && typeof parsed.byOwner === 'object' ? parsed.byOwner : {};
            Object.entries(owners).forEach(([uid, stats]) => {
                if (!uid) return;
                funnelStatsByOwner.set(uid, normalizeFunnelStats(stats));
            });
        } else {
            // Compatibilidade com formato antigo (global simples).
            funnelStats = normalizeFunnelStats(parsed);
        }
        console.log('[FunnelStats] 📊 Carregado:', funnelStats);
    } catch (err: any) {
        console.error('[FunnelStats] Falha ao carregar arquivo:', err?.message || err);
    }
};

interface PersistedCampaignGeoFile {
    version: 1;
    entries: Record<string, { ownerUid?: string; byUf: Record<string, CampaignGeoUf>; updatedAt: number }>;
}

let campaignGeoPersistTimer: NodeJS.Timeout | null = null;
const scheduleCampaignGeoSave = () => {
    if (campaignGeoPersistTimer) return;
    campaignGeoPersistTimer = setTimeout(() => {
        campaignGeoPersistTimer = null;
        const entries: PersistedCampaignGeoFile['entries'] = {};
        for (const [id, byUf] of campaignGeoById) {
            entries[id] = {
                ownerUid: campaignGeoOwnerById.get(id),
                byUf: { ...byUf },
                updatedAt: Date.now()
            };
        }
        fs.promises
            .writeFile(campaignGeoFile, JSON.stringify({ version: 1, entries }, null, 2), 'utf-8')
            .catch((err) => console.error('[CampaignGeo] Falha ao persistir:', err?.message || err));
    }, 1500);
};

const loadCampaignGeoState = async () => {
    try {
        if (!fs.existsSync(campaignGeoFile)) return;
        const raw = await fs.promises.readFile(campaignGeoFile, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedCampaignGeoFile;
        if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') return;
        let n = 0;
        for (const [id, row] of Object.entries(parsed.entries)) {
            if (!id || !row) continue;
            campaignGeoById.set(id, row.byUf && typeof row.byUf === 'object' ? row.byUf : {});
            campaignGeoOwnerById.set(id, row.ownerUid);
            n++;
        }
        if (n > 0) console.log(`[CampaignGeo] Restaurado(s) ${n} campanha(s) em disco`);
    } catch (err: any) {
        console.log('[CampaignGeo] Falha ao carregar:', err?.message || err);
    }
};

// --- BLOCKLIST DE CONVERSAS DELETADAS ---
// Quando o usuario apaga uma conversa vazia/sistema no painel, a exclusao precisa ser
// persistente. Sem isso, os ciclos de syncConversationsFromContacts / getChats recriam
// shells vazias de todos os contatos da agenda toda vez que o cliente reconecta.
// Regra: ids no blocklist sao bloqueados em `upsertConversation` SOMENTE quando a
// conversa candidata vier VAZIA (messages.length === 0). Qualquer mensagem real
// (incoming ou campanha) remove o id do blocklist, permitindo a conversa voltar.
const deletedConversationIdsFile = path.join(dataDir, 'deleted_conversations.json');
const deletedConversationIds = new Set<string>();
let deletedIdsSaveTimer: NodeJS.Timeout | null = null;
const scheduleDeletedIdsSave = () => {
    if (deletedIdsSaveTimer) return;
    deletedIdsSaveTimer = setTimeout(() => {
        deletedIdsSaveTimer = null;
        fs.promises
            .writeFile(deletedConversationIdsFile, JSON.stringify(Array.from(deletedConversationIds), null, 2), 'utf-8')
            .catch((err) => console.error('[DeletedConvs] Falha ao persistir:', err?.message || err));
    }, 500);
};
// Remove um id da blocklist quando uma acao do usuario ou mensagem real justifica
// reabrir a conversa (ex: chegou nova mensagem, novo disparo de campanha).
const allowDeletedConversation = (id: string) => {
    if (deletedConversationIds.has(id)) {
        deletedConversationIds.delete(id);
        scheduleDeletedIdsSave();
        console.log(`[DeletedConvs] ♻️  Liberado ${id} do blocklist (mensagem real recebida/enviada).`);
    }
};
const loadDeletedConversationIds = async () => {
    try {
        if (!fs.existsSync(deletedConversationIdsFile)) return;
        const raw = await fs.promises.readFile(deletedConversationIdsFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            parsed.forEach((id) => {
                if (typeof id === 'string' && id.length > 0) deletedConversationIds.add(id);
            });
            console.log(`[DeletedConvs] 🗑️  Carregado blocklist com ${deletedConversationIds.size} conversa(s).`);
        }
    } catch (err: any) {
        console.log('[DeletedConvs] Falha ao carregar blocklist:', err?.message || err);
    }
};

export const getFunnelStats = (): PersistedFunnelStats => funnelStats;
export const getFunnelStatsForUid = (uid: string): PersistedFunnelStats => {
    if (!uid || uid === 'anonymous') return funnelStats;
    return ownerFunnelStats(uid) || makeEmptyFunnelStats();
};

export const clearFunnelStats = (ownerUid?: string) => {
    const now = Date.now();
    if (ownerUid && ownerUid !== 'anonymous') {
        funnelStatsByOwner.set(ownerUid, { ...makeEmptyFunnelStats(), updatedAt: now, clearedAt: now });
        // Remove rastros de ack/reply apenas das campanhas deste owner.
        for (const [msgId, meta] of campaignMsgMeta.entries()) {
            if (!meta?.campaignId) continue;
            if (campaignGeoOwnerById.get(meta.campaignId) !== ownerUid) continue;
            campaignMsgMeta.delete(msgId);
            campaignAckLevel.delete(msgId);
        }
        for (const [key, list] of pendingCampaignSendsByConv.entries()) {
            const filtered = list.filter((row) => row.ownerUid !== ownerUid);
            if (filtered.length > 0) pendingCampaignSendsByConv.set(key, filtered);
            else pendingCampaignSendsByConv.delete(key);
        }
        scheduleFunnelSave();
        emitFunnelStats(ownerUid);
        console.log(`[FunnelStats] 🧹 Contadores zerados pelo usuario ${ownerUid}`);
        return;
    }

    funnelStats = { ...makeEmptyFunnelStats(), updatedAt: now, clearedAt: now };
    campaignAckLevel.clear();
    campaignMsgMeta.clear();
    pendingCampaignSendsByConv.clear();
    scheduleFunnelSave();
    emitFunnelStats();
    console.log('[FunnelStats] 🧹 Contadores globais zerados');
};

// Chave normalizada por telefone para cruzar envio <-> resposta mesmo que o
// WhatsApp devolva a conversa por @c.us em um momento e @lid em outro. O
// conversationId "cru" pode variar — mas a parte do numero e sempre a mesma.
const toPhoneKey = (chatIdOrPhone: string): string => {
    const raw = String(chatIdOrPhone || '');
    const beforeAt = raw.split('@')[0];
    return beforeAt.replace(/\D/g, '');
};
const getFunnelConvKey = (connectionId: string, chatIdOrPhone: string) => {
    return `${connectionId}:${toPhoneKey(chatIdOrPhone)}`;
};

/** Mesmo envio/ack: preferir id curto; senao _serialized (evita mapa de ack sem match). */
const normalizeWwebMessageId = (raw: unknown): string => {
    if (raw == null) return '';
    if (typeof raw === 'string') return String(raw).trim();
    const o = raw as { id?: string; _serialized?: string };
    const short = o.id != null && String(o.id).length > 0 ? String(o.id) : '';
    if (short) return short;
    const ser = o._serialized != null ? String(o._serialized).trim() : '';
    return ser;
};

const trackCampaignSend = (msgId: string, conversationId: string, ts: number, phoneDigits: string, explicitCampaignId?: string) => {
    funnelStats.totalSent++;
    funnelStats.updatedAt = Date.now();
    const normId = normalizeWwebMessageId(msgId);
    const cidForMeta = explicitCampaignId || currentCampaign.campaignId;
    if (normId) {
        campaignAckLevel.set(normId, 0);
        if (cidForMeta) {
            const uf = phoneDigitsToUf(phoneDigits) || GEO_UNKNOWN_UF;
            campaignMsgMeta.set(normId, { campaignId: cidForMeta, uf });
        }
    }
    // conversationId = "connectionId:JID" — indexa por JID normalizado e tambem por E.164
    // para bater com @lid / @c.us / @s.whatsapp.net na resposta.
    const [connId, chatPart] = conversationId.split(':');
    const ownerUid = currentCampaign.ownerUid || (cidForMeta ? campaignGeoOwnerById.get(cidForMeta) : undefined) || undefined;
    incrementOwnerFunnel(ownerUid, { totalSent: 1 });
    const entry: PendingCampaignSend = { ts, counted: false, campaignId: cidForMeta, ownerUid };
    const pushKey = (key: string) => {
        if (!key || key.endsWith(':') || key === `${connId}:`) return;
        const list = pendingCampaignSendsByConv.get(key) || [];
        list.push(entry);
        pendingCampaignSendsByConv.set(key, list);
    };
    const jidKey = getFunnelConvKey(connId || '', chatPart || '');
    const digits = toPhoneKey(phoneDigits || '');
    const phoneKey = digits.length >= 10 ? getFunnelConvKey(connId || '', digits) : '';
    pushKey(jidKey);
    if (phoneKey && phoneKey !== jidKey) pushKey(phoneKey);
    scheduleFunnelSave();
    emitFunnelStats(ownerUid);
};

const ensureCampaignGeo = (campaignId: string): Record<string, CampaignGeoUf> => {
    if (!campaignGeoById.has(campaignId)) {
        campaignGeoById.set(campaignId, {});
    }
    return campaignGeoById.get(campaignId)!;
};

const emitCampaignGeoNow = (campaignId: string) => {
    if (!io || !campaignId) return;
    const ownerUid = campaignGeoOwnerById.get(campaignId);
    const byUf = campaignGeoById.get(campaignId) || {};
    const payload = { campaignId, byUf, updatedAt: Date.now() };
    if (ownerUid) {
        io.to(`user:${ownerUid}`).emit('campaign-geo-update', payload);
    }
    scheduleCampaignGeoSave();
};

/** Ao reconectar o socket (refresh/nova aba), repõe o mapa da campanha atual ou última em memória. */
export const hydrateCampaignGeoForSocket = (socket: Socket) => {
    const campaignId = currentCampaign.campaignId;
    if (!campaignId || !campaignGeoById.has(campaignId)) return;
    const ownerUid = campaignGeoOwnerById.get(campaignId);
    const clientUid = String(socket.data?.uid ?? 'anonymous');
    if (ownerUid && clientUid !== ownerUid) return;
    socket.emit('campaign-geo-update', {
        campaignId,
        byUf: campaignGeoById.get(campaignId) || {},
        updatedAt: Date.now()
    });
};

const bumpCampaignGeo = (campaignId: string, uf: string, field: keyof CampaignGeoUf) => {
    if (!campaignId || !uf) return;
    const map = ensureCampaignGeo(campaignId);
    if (!map[uf]) map[uf] = { delivered: 0, read: 0, replied: 0 };
    map[uf][field] += 1;
    campaignGeoEmitPendingId = campaignId;
    if (campaignGeoEmitTimer) return;
    campaignGeoEmitTimer = setTimeout(() => {
        campaignGeoEmitTimer = null;
        const id = campaignGeoEmitPendingId;
        campaignGeoEmitPendingId = null;
        if (id) emitCampaignGeoNow(id);
    }, 280);
};

// Recebe um ack do WhatsApp para um msg id e incrementa delivered/read
// somente se ainda nao tinhamos contabilizado aquele nivel.
// Niveis whatsapp-web.js: -1=ERROR, 0=PENDING, 1=SERVER, 2=DEVICE(entregue),
// 3=READ(lido), 4=PLAYED(audio/video reproduzido).
const handleCampaignAck = (msgId: string, ack: number) => {
    if (!campaignAckLevel.has(msgId)) return;
    const current = campaignAckLevel.get(msgId) || 0;
    const meta = campaignMsgMeta.get(msgId);
    let changed = false;
    if (ack >= 2 && current < 1) {
        funnelStats.totalDelivered++;
        campaignAckLevel.set(msgId, 1);
        changed = true;
        incrementOwnerFunnel(meta?.campaignId ? campaignGeoOwnerById.get(meta.campaignId) : undefined, { totalDelivered: 1 });
        if (meta?.campaignId) bumpCampaignGeo(meta.campaignId, meta.uf, 'delivered');
    }
    if (ack >= 3 && (campaignAckLevel.get(msgId) || 0) < 2) {
        funnelStats.totalRead++;
        campaignAckLevel.set(msgId, 2);
        changed = true;
        incrementOwnerFunnel(meta?.campaignId ? campaignGeoOwnerById.get(meta.campaignId) : undefined, { totalRead: 1 });
        if (meta?.campaignId) bumpCampaignGeo(meta.campaignId, meta.uf, 'read');
    }
    if (changed) {
        funnelStats.updatedAt = Date.now();
        scheduleFunnelSave();
        emitFunnelStats(meta?.campaignId ? campaignGeoOwnerById.get(meta.campaignId) : undefined);
    }
};

// Recebeu uma mensagem 'them' nesta conversa. Conta como reply do disparo
// mais recente <= incomingTs ainda nao contabilizado.
const handleIncomingForFunnel = (conversationId: string, incomingTs: number, phoneDigitsHint?: string) => {
    const [connId, chatPart] = conversationId.split(':');
    const keys: string[] = [];
    const hint = phoneDigitsHint ? toPhoneKey(phoneDigitsHint) : '';
    if (hint.length >= 8) keys.push(getFunnelConvKey(connId || '', hint));
    keys.push(getFunnelConvKey(connId || '', chatPart || ''));
    let list: PendingCampaignSend[] | undefined;
    for (const k of keys) {
        list = pendingCampaignSendsByConv.get(k);
        if (list && list.length) break;
    }
    if (!list || list.length === 0) return;
    let candidate: PendingCampaignSend | null = null;
    for (const send of list) {
        if (send.counted) continue;
        if (send.ts > incomingTs) continue;
        if (!candidate || send.ts > candidate.ts) candidate = send;
    }
    if (candidate) {
        candidate.counted = true;
        funnelStats.totalReplied++;
        funnelStats.updatedAt = Date.now();
        const cid = candidate.campaignId;
        incrementOwnerFunnel(candidate.ownerUid || (cid ? campaignGeoOwnerById.get(cid) : undefined), { totalReplied: 1 });
        const uf = phoneDigitsToUf(toPhoneKey(chatPart || '')) || GEO_UNKNOWN_UF;
        if (cid) bumpCampaignGeo(cid, uf, 'replied');
        scheduleFunnelSave();
        emitFunnelStats(candidate.ownerUid || (cid ? campaignGeoOwnerById.get(cid) : undefined));
    }
};

// --- GRACEFUL SHUTDOWN ---
// Fecha todos os clientes whatsapp-web.js de forma ordenada para que o Chromium
// consiga persistir o estado da sessao (cookies, storage, IndexedDB) antes do
// processo morrer. Sem isto o SIGTERM do Docker (compose up -d --build) escapa
// para o Chrome como SIGKILL apos 10s, corrompendo dados e forcando novo QR.
let isShuttingDown = false;
export const isServerShuttingDown = () => isShuttingDown;
export const shutdownAll = async (reason: string = 'SIGTERM'): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[shutdown] 🛑 Iniciando shutdown gracioso (${reason}). Clientes: ${clients.size}`);
    // Cancela timers de reconexao pendentes
    for (const [, st] of reconnectState.entries()) {
        if (st.timeout) clearTimeout(st.timeout);
    }
    reconnectState.clear();
    // Antes de destruir, congelamos os status atuais no disco. O handler
    // 'disconnected' que vai disparar durante o destroy nao persiste mais
    // nada (checa isServerShuttingDown), entao o arquivo que sobrevive
    // reflete o estado real antes do deploy (CONNECTED, etc).
    try {
        await persistConnections();
    } catch (e) {
        console.warn('[shutdown] Falha ao persistir connections:', (e as any)?.message || e);
    }
    // Antes de destruir, tiramos backup de cada sessao ativa. Se o Chromium
    // corromper os arquivos durante a saida, temos um snapshot consistente
    // que o proximo boot usa para restaurar sem precisar de QR.
    const backupTasks: Promise<void>[] = [];
    for (const [id] of clients.entries()) {
        const conn = connectionsInfo.find(c => c.id === id);
        if (conn?.status === ConnectionStatus.CONNECTED) {
            backupTasks.push(
                Promise.race([
                    backupSession(id).then(() => {}),
                    new Promise<void>((resolve) => setTimeout(resolve, 5000))
                ])
            );
        }
    }
    await Promise.all(backupTasks);
    // Destroi clientes com timeout individual — se um cliente trava, nao pode
    // segurar o shutdown inteiro (precisamos sair antes do SIGKILL).
    const tasks: Promise<void>[] = [];
    for (const [id, client] of clients.entries()) {
        tasks.push(
            Promise.race([
                (async () => {
                    try {
                        stopHealthCheck(id);
                    } catch { /* ignore */ }
                    try {
                        console.log(`[shutdown] Destruindo cliente ${id}...`);
                        await (client as any).destroy?.();
                        console.log(`[shutdown] ✅ ${id} finalizado.`);
                    } catch (e: any) {
                        console.warn(`[shutdown] Erro ao destruir ${id}: ${e?.message || e}`);
                    }
                })(),
                // 15s — Chromium precisa de tempo para flushar IndexedDB.
                // docker-compose tem stop_grace_period: 45s, entao ha folga.
                new Promise<void>((resolve) => setTimeout(resolve, 15000))
            ])
        );
    }
    await Promise.all(tasks);
    clients.clear();
    console.log('[shutdown] Todos os clientes finalizados.');
};

// --- INITIALIZATION ---
export const init = (socketIo: SocketIOServer) => {
    io = socketIo;
    const headlessApi = process.env.SESSION_PROCESS_MODE === 'api';
    console.log(
        headlessApi
            ? 'WhatsApp Service: modo API headless (Chromium só no worker)'
            : 'WhatsApp Service Initialized with IO'
    );

    if (!headlessApi) {
        startPuppeteerMonitor();
    }

    ensureDataDir()
        .then(() => loadConnections())
        .then(() => loadQueue())
        .then(() => loadWarmupState())
        .then(() => loadWarmupChipStats())
        .then(() => loadFunnelStats())
        .then(() => loadCampaignGeoState())
        .then(() => loadDeletedConversationIds())
        .then(async () => {
            if (connectionsInfo.length === 0) {
                await loadConnectionsFromAuth();
            }
            if (headlessApi) {
                startConnectionsFileSyncFromWorker();
                return;
            }
            for (const conn of connectionsInfo) {
                // Evita corrida no bootstrap ao abrir varios Chromium ao mesmo tempo.
                // Isso reduz chance de falso positivo de profile lock em hosts com IO lento.
                await initializeClient(conn.id, conn.name);
                await new Promise((resolve) => setTimeout(resolve, 1200));
            }
        });
};

export const getConnections = () => connectionsInfo;
export const getMetrics = () => metrics;
export const getConversations = () => conversations;
export const getChannelMetrics = (connectionId: string) => channelQualityMetrics.get(connectionId);

// --- HEALTH CHECK & QUALITY METRICS ---

const initChannelMetrics = (connectionId: string) => {
    if (!channelQualityMetrics.has(connectionId)) {
        channelQualityMetrics.set(connectionId, {
            successCount: 0,
            failCount: 0,
            totalAttempts: 0,
            avgLatency: 0,
            uptime: Date.now(),
            healthScore: 100
        });
    }
};

const updateChannelMetrics = (connectionId: string, success: boolean, latencyMs?: number) => {
    const metrics = channelQualityMetrics.get(connectionId);
    if (!metrics) return;

    metrics.totalAttempts++;
    if (success) {
        metrics.successCount++;
        metrics.lastSuccessTimestamp = Date.now();
        if (latencyMs) {
            metrics.avgLatency = (metrics.avgLatency * (metrics.successCount - 1) + latencyMs) / metrics.successCount;
        }
    } else {
        metrics.failCount++;
    }

    // Calcular health score (0-100)
    const successRate = metrics.totalAttempts > 0 ? (metrics.successCount / metrics.totalAttempts) * 100 : 100;
    const uptimeHours = (Date.now() - metrics.uptime) / (1000 * 60 * 60);
    const uptimeScore = Math.min(uptimeHours * 2, 100); // +2pts por hora até 50h
    const latencyScore = metrics.avgLatency > 0 ? Math.max(100 - (metrics.avgLatency / 100), 0) : 100;
    
    const oldScore = metrics.healthScore;
    metrics.healthScore = Math.round((successRate * 0.7) + (uptimeScore * 0.2) + (latencyScore * 0.1));
    
    // Webhook se health score caiu abaixo de 30
    if (oldScore >= 30 && metrics.healthScore < 30) {
        const webhookUrl = dynamicSettings.webhookUrl || process.env.WEBHOOK_URL;
        if (webhookUrl) {
            advancedFeatures.sendWebhook('health_critical', {
                connectionId,
                healthScore: metrics.healthScore,
                successRate,
                avgLatency: metrics.avgLatency
            }, webhookUrl);
        }
    }
    
    channelQualityMetrics.set(connectionId, metrics);
    // Propagar healthScore e emitir connections-update
    updateConnectionState(connectionId, { healthScore: metrics.healthScore });
    emitConnectionsUpdate();
    io.emit('channel-metrics-update', { connectionId, metrics });
};

// Sistema de strikes: evita reconectar por blips transitorios de getState().
// Timeouts do getState (null) em rede lenta ou burst de CPU nao devem derrubar o canal no 3º tick.
const healthStrikes = new Map<string, number>();
/** Estado explicitamente incoerente (nao-null) — reconecta apos poucas leituras seguidas. */
const HEALTH_HARD_STRIKES_THRESHOLD = 4;
/** Timeout/erro leitura (state null) — precisa muitas falhas seguidas antes de reconectar. */
const HEALTH_SOFT_STRIKES_THRESHOLD = 14;
// Estados em que aceita o canal como "ok o suficiente" - evita reconexao por estado transitorio
const HEALTH_OK_STATES = new Set(['CONNECTED', 'OPENING', 'PAIRING', 'SYNCING']);
// Estados terminais que sempre exigem reconexao imediata
const HEALTH_FATAL_STATES = new Set(['CONFLICT', 'UNPAIRED', 'UNLAUNCHED', 'DEPRECATED_VERSION', 'TOS_BLOCK']);

const startHealthCheck = (connectionId: string, aggressive = false) => {
    stopHealthCheck(connectionId);

    // Intervalo: 15s durante campanha, 45s normal (era 10/30 - muito agressivo)
    const intervalTime = aggressive ? 15000 : 45000;

    healthStrikes.set(connectionId, 0);

    const interval = setInterval(async () => {
        const client = clients.get(connectionId);
        const conn = connectionsInfo.find(c => c.id === connectionId);

        if (!client || !conn || conn.status !== ConnectionStatus.CONNECTED) {
            return;
        }

        try {
            const startTime = Date.now();
            // getState com timeout proprio de 12s para evitar ficar pendurado
            const state = await Promise.race([
                client.getState().catch((e: any) => {
                    console.log(`[HealthCheck] getState erro transitorio em ${connectionId}: ${e?.message || e}`);
                    return null;
                }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000))
            ]);
            const latency = Date.now() - startTime;

            advancedFeatures.recordLatency(connectionId, latency);

            const currentStrikes = healthStrikes.get(connectionId) || 0;

            if (state && HEALTH_FATAL_STATES.has(state)) {
                // Estado terminal - reconecta imediatamente
                console.warn(`[HealthCheck] Canal ${connectionId} em estado FATAL ${state}. Reconectando...`);
                healthStrikes.set(connectionId, 0);
                updateChannelMetrics(connectionId, false);
                if (currentCampaign.isRunning && aggressive) {
                    emitToConnectionOwner('campaign-connection-lost', connectionId, { connectionId, campaignId: currentCampaign.campaignId });
                }
                await reconnectConnection(connectionId);
                return;
            }

            if (state && HEALTH_OK_STATES.has(state)) {
                // Estado saudavel - zera strikes
                if (currentStrikes > 0) {
                    console.log(`[HealthCheck] Canal ${connectionId} recuperou (estado ${state}). Zerando strikes.`);
                }
                healthStrikes.set(connectionId, 0);
                updateChannelMetrics(connectionId, true, latency);

                // Deteccao preditiva: so restart se latencia MUITO alta de forma sustentada
                if (advancedFeatures.predictFailure(connectionId)) {
                    console.warn(`[Predictive] Latencia muito alta em ${connectionId} - ignorando (apenas log).`);
                    // NAO reconecta automaticamente - era agressivo demais
                }
                return;
            }

            // Estado null/timeout/leitura vazia: rede/Chromium ocupado — mais tolerancia
            const isTransientRead = state == null || (typeof state === 'string' && state.trim() === '');
            const strikeLimit = isTransientRead ? HEALTH_SOFT_STRIKES_THRESHOLD : HEALTH_HARD_STRIKES_THRESHOLD;

            const nextStrikes = currentStrikes + 1;
            healthStrikes.set(connectionId, nextStrikes);
            updateChannelMetrics(connectionId, false);
            console.warn(
                `[HealthCheck] Canal ${connectionId} estado=${JSON.stringify(state)} (strike ${nextStrikes}/${strikeLimit}${isTransientRead ? ', leitura transitoria' : ''})`
            );

            if (nextStrikes >= strikeLimit) {
                console.warn(
                    `[HealthCheck] Canal ${connectionId} atingiu limite (${strikeLimit}) de falhas consecutivas. Reconectando...`
                );
                healthStrikes.set(connectionId, 0);
                if (currentCampaign.isRunning && aggressive) {
                    console.warn('[HealthCheck] 🚨 Canal caiu durante campanha! Pausando temporariamente...');
                    emitToConnectionOwner('campaign-connection-lost', connectionId, { connectionId, campaignId: currentCampaign.campaignId });
                }
                await reconnectConnection(connectionId);
            }
        } catch (error: any) {
            // Erros fora do getState tratados como falha soft (mesma tolerancia de timeout)
            console.error(`[HealthCheck] Falha na verificacao do canal ${connectionId}:`, error?.message || error);
            const currentStrikes = healthStrikes.get(connectionId) || 0;
            const nextStrikes = currentStrikes + 1;
            healthStrikes.set(connectionId, nextStrikes);
            updateChannelMetrics(connectionId, false);
            if (nextStrikes >= HEALTH_SOFT_STRIKES_THRESHOLD) {
                console.warn(
                    `[HealthCheck] Canal ${connectionId} atingiu ${HEALTH_SOFT_STRIKES_THRESHOLD} erros seguidos no health check — reconectando`
                );
                healthStrikes.set(connectionId, 0);
                if (currentCampaign.isRunning && aggressive) {
                    emitToConnectionOwner('campaign-connection-lost', connectionId, {
                        connectionId,
                        campaignId: currentCampaign.campaignId
                    });
                }
                await reconnectConnection(connectionId);
            }
        }
    }, intervalTime);

    healthCheckIntervals.set(connectionId, interval);
    console.log(
        `[HealthCheck] Iniciado para canal ${connectionId} (intervalo: ${intervalTime}ms, strikes: hard=${HEALTH_HARD_STRIKES_THRESHOLD} soft=${HEALTH_SOFT_STRIKES_THRESHOLD})`
    );
};

const stopHealthCheck = (connectionId: string) => {
    const interval = healthCheckIntervals.get(connectionId);
    if (interval) {
        clearInterval(interval);
        healthCheckIntervals.delete(connectionId);
        console.log(`[HealthCheck] Parado para canal ${connectionId}`);
    }
    healthStrikes.delete(connectionId);
};

// --- SESSION BACKUP & RESTORE ---

const backupSession = async (connectionId: string): Promise<boolean> => {
    const { sessionPath, backupPath } = waSessionDirPair(connectionId);
    
    try {
        // Remove backup antigo
        await fs.promises.rm(backupPath, { recursive: true, force: true });
        
        // Verifica se sessão existe
        const exists = await fs.promises.access(sessionPath).then(() => true).catch(() => false);
        if (!exists) {
            console.log(`[SessionBackup] Sessão ${connectionId} não existe, nada para fazer backup.`);
            return false;
        }
        
        // Copia sessão para backup
        await fs.promises.cp(sessionPath, backupPath, { recursive: true, force: true });
        console.log(`[SessionBackup] ✅ Backup criado para sessão ${connectionId}`);
        return true;
    } catch (error) {
        console.error(`[SessionBackup] ❌ Falha ao criar backup da sessão ${connectionId}:`, error);
        return false;
    }
};

const restoreSession = async (connectionId: string): Promise<boolean> => {
    const { sessionPath, backupPath } = waSessionDirPair(connectionId);
    
    try {
        // Verifica se backup existe
        const exists = await fs.promises.access(backupPath).then(() => true).catch(() => false);
        if (!exists) {
            console.log(`[SessionRestore] Backup da sessão ${connectionId} não existe.`);
            return false;
        }
        
        // Remove sessão atual (possivelmente corrompida)
        await fs.promises.rm(sessionPath, { recursive: true, force: true });
        
        // Restaura do backup
        await fs.promises.cp(backupPath, sessionPath, { recursive: true, force: true });
        console.log(`[SessionRestore] ✅ Sessão ${connectionId} restaurada do backup`);
        return true;
    } catch (error) {
        console.error(`[SessionRestore] ❌ Falha ao restaurar sessão ${connectionId}:`, error);
        return false;
    }
};

const cleanupSessionBackup = async (connectionId: string) => {
    const { backupPath } = waSessionDirPair(connectionId);
    try {
        await fs.promises.rm(backupPath, { recursive: true, force: true });
        console.log(`[SessionBackup] Backup removido para ${connectionId}`);
    } catch (error) {
        // Ignora erros de limpeza
    }
};

// Remove os arquivos SingletonLock/Cookie/Socket que o Chromium cria para impedir
// duas instancias no mesmo userDataDir. Se o processo anterior morreu sem limpar
// (crash, HMR restart, kill -9), o Puppeteer lanca "The browser is already running".
// Esta funcao apaga os locks para permitir uma nova inicializacao limpa.
const clearSessionLocks = (connectionId: string): boolean => {
    const { sessionPath: sessionRoot } = waSessionDirPair(connectionId);
    if (!fs.existsSync(sessionRoot)) return false;
    const lockFiles = [
        path.join(sessionRoot, 'SingletonLock'),
        path.join(sessionRoot, 'SingletonCookie'),
        path.join(sessionRoot, 'SingletonSocket'),
        path.join(sessionRoot, 'Default', 'SingletonLock'),
        path.join(sessionRoot, 'Default', 'SingletonCookie'),
        path.join(sessionRoot, 'Default', 'SingletonSocket'),
        path.join(sessionRoot, 'DevToolsActivePort'),
        path.join(sessionRoot, 'Default', 'DevToolsActivePort')
    ];
    const lockNameMatchers = [
        /^Singleton/i,
        /^\.org\.chromium\.Chromium\./i,
        /^LOCK$/i,
        /^lockfile$/i
    ];
    let removedAny = false;
    for (const file of lockFiles) {
        try {
            if (fs.existsSync(file)) {
                fs.rmSync(file, { force: true });
                removedAny = true;
            }
        } catch (e: any) {
            // Em Windows, se o Chrome ainda estiver rodando, nao conseguimos remover.
            // Nesse caso o erro vai aparecer no proximo initialize e sera tratado la.
            console.log(`[SessionLock] Aviso ao remover ${path.basename(file)} de ${connectionId}: ${e?.message || e}`);
        }
    }
    try {
        const sweepDirs = [sessionRoot, path.join(sessionRoot, 'Default')];
        for (const dir of sweepDirs) {
            if (!fs.existsSync(dir)) continue;
            const entries = fs.readdirSync(dir);
            for (const name of entries) {
                if (!lockNameMatchers.some((rx) => rx.test(name))) continue;
                const candidate = path.join(dir, name);
                try {
                    fs.rmSync(candidate, { recursive: true, force: true });
                    removedAny = true;
                } catch (e: any) {
                    console.log(`[SessionLock] Aviso ao remover ${name} de ${connectionId}: ${e?.message || e}`);
                }
            }
        }
    } catch {
        // ignore
    }
    if (removedAny) {
        console.log(`[SessionLock] 🧹 Locks removidos para sessao ${connectionId}`);
    }
    return removedAny;
};

// Em Windows, o Chromium spawnado pelo Puppeteer pode sobreviver ao restart do Node
// (ex: tsx watch / HMR). Esses processos orfaos continuam segurando o userDataDir e
// lancam "The browser is already running". Aqui matamos os chrome.exe que estao
// referenciando a pasta de sessao especifica - sem tocar em outros Chromes do usuario.
const killOrphanChromeForSession = async (connectionId: string): Promise<void> => {
    const paths = new Set<string>();
    paths.add(waSessionDirPair(connectionId).sessionPath);
    if (whatsappSessionSlugForLogicalId(connectionId) !== connectionId) {
        paths.add(path.join(authDir, `session-${connectionId}`));
    }
    const pathList = [...paths];

    for (const sessionPath of pathList) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            if (process.platform === 'linux') {
                const escaped = sessionPath.replace(/'/g, `'\\''`);
                const shScript = `set +e; pids="$(ps -eo pid,args | awk '/(chrome|chromium)/ && index($0, "${escaped}") {print $1}')"; if [ -n "$pids" ]; then echo "$pids" | xargs -r kill -9; echo "killed:$pids"; fi; exit 0`;
                execFile(
                    'sh',
                    ['-lc', shScript],
                    { timeout: 8000 },
                    (_err, stdout) => {
                        if (stdout && stdout.includes('killed:')) {
                            const killed = stdout
                                .replace('killed:', ' ')
                                .trim()
                                .split(/\s+/)
                                .filter(Boolean);
                            if (killed.length > 0) {
                                console.log(
                                    `[ChromeKill] ${killed.length} chromium orfao(s) encerrado(s) para sessao ${connectionId}`
                                );
                            }
                        }
                        resolve();
                    }
                );
                return;
            }
            if (process.platform !== 'win32') {
                resolve();
                return;
            }
            const safePath = sessionPath.replace(/'/g, "''");
            const psScript =
                `$ErrorActionPreference='SilentlyContinue'; ` +
                `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='chromium.exe'" | ` +
                `Where-Object { $_.CommandLine -like '*${safePath}*' } | ` +
                `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('killed:' + $_.ProcessId) }`;
            execFile(
                'powershell',
                ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
                { timeout: 8000, windowsHide: true },
                (err, stdout) => {
                    if (stdout && stdout.includes('killed:')) {
                        const kills = stdout.trim().split(/\r?\n/).filter((l) => l.startsWith('killed:'));
                        console.log(
                            `[ChromeKill] ${kills.length} chrome.exe orfao(s) encerrado(s) para sessao ${connectionId}`
                        );
                    }
                    if (err && !err.killed) {
                        /* silencioso */
                    }
                    resolve();
                }
            );
        });
    }
};

// --- QUEUE PERSISTENCE ---

const persistQueue = async () => {
    try {
        await ensureDataDir();
        const queueData = {
            queue: messageQueue,
            campaign: currentCampaign,
            timestamp: new Date().toISOString()
        };
        await fs.promises.writeFile(queueFile, JSON.stringify(queueData, null, 2), 'utf8');
    } catch (error) {
        console.error('[QueuePersist] Erro ao salvar fila:', error);
    }
};

const loadQueue = async () => {
    try {
        const raw = await fs.promises.readFile(queueFile, 'utf8');
        const data = JSON.parse(raw);
        
        if (data.queue && Array.isArray(data.queue) && data.queue.length > 0) {
            messageQueue = data.queue;
            console.log(`[QueueRestore] ✅ Restaurada fila com ${messageQueue.length} mensagens pendentes`);
            
            if (data.campaign && data.campaign.isRunning) {
                currentCampaign = { ...data.campaign };
                console.log(`[QueueRestore] ✅ Campanha ${currentCampaign.campaignId} retomada`);
                
                // Retomar processamento
                if (!isProcessingQueue) {
                    processQueue();
                }
            }
        }
    } catch (error) {
        // Arquivo não existe ou erro ao ler - tudo bem, começa com fila vazia
        console.log('[QueueRestore] Nenhuma fila salva encontrada (ok)');
    }
};

// --- WARMUP PERSISTENCE ---

const persistWarmupState = async () => {
    try {
        await ensureDataDir();
        await fs.promises.writeFile(warmupQueueFile, JSON.stringify(warmupQueue, null, 2), 'utf8');
        await fs.promises.writeFile(warmedNumbersFile, JSON.stringify([...warmedNumbers], null, 2), 'utf8');
    } catch (error) {
        console.error('[WarmupPersist] Erro ao salvar aquecimento:', error);
    }
};

const loadWarmupState = async () => {
    try {
        const rawQueue = await fs.promises.readFile(warmupQueueFile, 'utf8');
        const parsedQueue = JSON.parse(rawQueue);
        if (Array.isArray(parsedQueue)) {
            warmupQueue = parsedQueue;
            console.log(`[WarmupRestore] ✅ ${warmupQueue.length} números aguardando aquecimento`);
        }
    } catch {
        console.log('[WarmupRestore] Nenhum aquecimento salvo encontrado (ok)');
    }

    try {
        const rawWarmed = await fs.promises.readFile(warmedNumbersFile, 'utf8');
        const parsedWarmed = JSON.parse(rawWarmed);
        if (Array.isArray(parsedWarmed)) {
            parsedWarmed.forEach((num) => warmedNumbers.add(String(num)));
            console.log(`[WarmupRestore] ✅ ${warmedNumbers.size} números já aquecidos`);
        }
    } catch {
        // ignore
    }
};

const emitWarmupUpdate = () => {
    if (!io) return;
    if (io) {
        const grouped = new Map<string, typeof warmupQueue>();
        warmupQueue.forEach((item) => {
            const uid = ownerUidFromConnectionId((item as any).connectionId);
            if (!uid) return;
            if (!grouped.has(uid)) grouped.set(uid, []);
            grouped.get(uid)!.push(item);
        });
        grouped.forEach((pending, uid) => {
            io.to(`user:${uid}`).emit('warmup-update', {
                pending,
                warmedCount: warmedNumbers.size
            });
        });
    }
};

const addWarmupItem = async (item: WarmupItem) => {
    const normalized = normalizeNumber(item.to);
    if (warmedNumbers.has(normalized)) {
        return;
    }
    const exists = warmupQueue.find((queued) => queued.to === normalized);
    if (!exists) {
        warmupQueue.push({ ...item, to: normalized });
        await persistWarmupState();
        emitWarmupUpdate();
    }
};

export const markWarmupReady = async (numbers: string[]) => {
    const normalized = numbers.map(normalizeNumber);
    normalized.forEach((num) => warmedNumbers.add(num));
    const requeueItems = warmupQueue.filter((item) => normalized.includes(item.to));
    warmupQueue = warmupQueue.filter((item) => !normalized.includes(item.to));

    requeueItems.forEach((item) => {
        messageQueue.push({
            to: item.to,
            message: item.message,
            connectionId: item.connectionId,
            status: 'PENDING'
        });
    });

    await persistWarmupState();
    await persistQueue();
    emitWarmupUpdate();

    if (requeueItems.length > 0 && !isProcessingQueue) {
        processQueue();
    }
};

export const getWarmupQueue = () => warmupQueue;
export const getWarmupState = () => ({
    pending: warmupQueue,
    warmedCount: warmedNumbers.size
});

const clearPersistedQueue = async () => {
    try {
        await fs.promises.rm(queueFile, { force: true });
    } catch (error) {
        // Ignora
    }
};

// --- RATE LIMITING ---

const checkRateLimit = (connectionId: string): boolean => {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    let timestamps = rateLimitTracking.get(connectionId) || [];
    // Limpar timestamps antigos
    timestamps = timestamps.filter(ts => ts > hourAgo);
    
    // Aplicar warmup gradual
    const warmupLimit = advancedFeatures.getWarmupLimit(connectionId);
    const effectiveLimit = Math.min(RATE_LIMIT_PER_HOUR, warmupLimit);
    
    if (timestamps.length >= effectiveLimit) {
        console.log(`[RateLimit] Canal ${connectionId} atingiu limite de ${effectiveLimit} msgs/hora (warmup: ${warmupLimit})`);
        return false; // Limite excedido
    }
    
    timestamps.push(now);
    rateLimitTracking.set(connectionId, timestamps);
    return true;
};

const getIntelligentDelay = (): number => {
    const hour = new Date().getHours();
    
    if (hour >= 8 && hour < 12) return Math.random() * 2000 + 3000; // 3-5s
    if (hour >= 12 && hour < 14) return Math.random() * 4000 + 8000; // 8-12s
    if (hour >= 22 || hour < 7) return Math.random() * 15000 + 15000; // 15-30s
    
    return Math.random() * 5000 + 5000; // 5-10s (padrão)
};

// --- CIRCUIT BREAKER ---

const getCircuitBreaker = (connectionId: string) => {
    if (!circuitBreakers.has(connectionId)) {
        circuitBreakers.set(connectionId, {
            state: 'CLOSED',
            failures: 0,
            lastFailureTime: 0
        });
    }
    return circuitBreakers.get(connectionId)!;
};

const recordCircuitBreakerFailure = (connectionId: string) => {
    const cb = getCircuitBreaker(connectionId);
    const now = Date.now();
    
    // Reset se passou da janela de tempo
    if (now - cb.lastFailureTime > CIRCUIT_BREAKER_WINDOW) {
        cb.failures = 0;
    }
    
    cb.failures++;
    cb.lastFailureTime = now;
    
    // Abrir circuito se excedeu threshold
    if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD && cb.state === 'CLOSED') {
        cb.state = 'OPEN';
        cb.openUntil = now + CIRCUIT_BREAKER_TIMEOUT;
        console.warn(`[CircuitBreaker] 🔴 Canal ${connectionId} ABERTO (${cb.failures} falhas em 1min). Bloqueado por 5min.`);
        io.emit('circuit-breaker-open', { connectionId, failures: cb.failures });
        
        // Webhook crítico
        const webhookUrl = dynamicSettings.webhookUrl || process.env.WEBHOOK_URL;
        if (webhookUrl) {
            advancedFeatures.sendWebhook('circuit_breaker_open', {
                connectionId,
                failures: cb.failures,
                blockedUntil: new Date(cb.openUntil).toISOString()
            }, webhookUrl);
        }
    }
};

const recordCircuitBreakerSuccess = (connectionId: string) => {
    const cb = getCircuitBreaker(connectionId);
    
    if (cb.state === 'HALF_OPEN') {
        cb.state = 'CLOSED';
        cb.failures = 0;
        console.log(`[CircuitBreaker] 🟢 Canal ${connectionId} FECHADO (recuperado)`);
        io.emit('circuit-breaker-closed', { connectionId });
    } else if (cb.state === 'CLOSED') {
        // Decrementa falhas gradualmente em caso de sucesso
        cb.failures = Math.max(0, cb.failures - 1);
    }
};

const checkCircuitBreaker = (connectionId: string): boolean => {
    const cb = getCircuitBreaker(connectionId);
    const now = Date.now();
    
    if (cb.state === 'OPEN') {
        if (cb.openUntil && now >= cb.openUntil) {
            cb.state = 'HALF_OPEN';
            cb.failures = 0;
            console.log(`[CircuitBreaker] 🟡 Canal ${connectionId} MEIO-ABERTO (testando recuperação)`);
            return true; // Permite uma tentativa
        }
        return false; // Bloqueado
    }
    
    return true; // CLOSED ou HALF_OPEN permite
};

// --- DEAD LETTER QUEUE ---

const addToDLQ = async (item: QueueItem, reason: string) => {
    try {
        let dlq = [];
        try {
            const raw = await fs.promises.readFile(dlqFile, 'utf8');
            dlq = JSON.parse(raw);
        } catch {}
        
        dlq.push({
            ...item,
            failureReason: reason,
            timestamp: new Date().toISOString()
        });
        
        await fs.promises.writeFile(dlqFile, JSON.stringify(dlq, null, 2), 'utf8');
        console.log(`[DLQ] Mensagem adicionada: ${item.to}`);
    } catch (error) {
        console.error('[DLQ] Erro ao adicionar à DLQ:', error);
    }
};

const getConversationKey = (connectionId: string, chatId: string) => `${connectionId}:${chatId}`;

const normalizeTimestamp = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    if (isToday) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (isYesterday) return 'Ontem';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const resolveMessageStatus = (ack?: number): ChatMessage['status'] => {
    if (ack === 3) return 'read';
    if (ack === 2) return 'delivered';
    return 'sent';
};

const toChatMessage = async (msg: any, opts?: { skipMedia?: boolean }): Promise<ChatMessage> => {
    const tsMs = msg.timestamp ? msg.timestamp * 1000 : Date.now();
    const baseMsg: ChatMessage = {
        id: msg.id?.id || `${Date.now()}`,
        text: msg.body || '',
        timestamp: msg.timestamp ? normalizeTimestamp(msg.timestamp) : new Date().toLocaleTimeString(),
        sender: msg.fromMe ? 'me' : 'them',
        status: msg.fromMe ? resolveMessageStatus(msg.ack) : 'read',
        type: 'text',
        mediaUrl: undefined,
        timestampMs: tsMs
    };
    
    // Detectar tipo de mídia
    if (msg.type === 'image') baseMsg.type = 'image';
    else if (msg.type === 'audio' || msg.type === 'ptt') baseMsg.type = 'audio';
    else if (msg.type === 'sticker') baseMsg.type = 'sticker';
    else if (msg.type === 'video') baseMsg.type = 'video';
    else if (msg.type === 'document') baseMsg.type = 'document';
    
    const isMedia = baseMsg.type === 'image' || baseMsg.type === 'sticker' || baseMsg.type === 'video' || baseMsg.type === 'document' || baseMsg.type === 'audio';

    if (msg.hasMedia && isMedia) {
        if (opts?.skipMedia) {
            // Ao carregar historico massivamente pulamos o download para nao travar o servidor.
            // A UI mostra um placeholder e o usuario pode solicitar a midia sob demanda.
            if (!baseMsg.text) baseMsg.text = `[${baseMsg.type.toUpperCase()}]`;
        } else {
            try {
                const media = await msg.downloadMedia();
                if (media && media.data) {
                    const mimeType = media.mimetype || 'application/octet-stream';
                    baseMsg.mediaUrl = `data:${mimeType};base64,${media.data}`;
                    if (!baseMsg.text) {
                        baseMsg.text = media.filename || `[${baseMsg.type.toUpperCase()}]`;
                    }
                }
            } catch (e) {
                console.log(`[toChatMessage] Erro ao baixar mídia:`, e);
                if (!baseMsg.text) baseMsg.text = `[${baseMsg.type.toUpperCase()} - não baixado]`;
            }
        }
    }
    
    return baseMsg;
};

const upsertConversation = (next: Conversation) => {
    // Conversa na blocklist (foi apagada pelo usuario): nunca recriar em sync.
    // Somente o handler de mensagens ao vivo (client.on('message')) ou um
    // disparo de campanha podem reabri-la, chamando `allowDeletedConversation()`
    // antes do upsert.
    if (deletedConversationIds.has(next.id)) {
        return;
    }
    const index = conversations.findIndex(conv => conv.id === next.id);
    if (index >= 0) {
        conversations[index] = next;
    } else {
        conversations.unshift(next);
    }
    // Ordenar: grupos (@g.us) fixos no topo, depois por timestamp decrescente (mais recente no topo)
    conversations.sort((a, b) => {
        const aIsGroup = a.id.endsWith('@g.us') ? 1 : 0;
        const bIsGroup = b.id.endsWith('@g.us') ? 1 : 0;
        if (aIsGroup !== bIsGroup) return bIsGroup - aIsGroup;
        return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
    });
    conversations = conversations.slice(0, MAX_CONVERSATIONS);
};

const emitConversationsUpdate = () => {
    try {
        console.log(`[emitConversations] Emitindo ${conversations.length} conversas...`);
        const payload = conversations.map((c) => ({ ...c, connectionId: c.connectionId }));

        /** No wa-worker o `io` e noop: sem sockets; o bridge Redis entrega aos browsers ligados aa API. */
        if (ownerEmitRedisBridge) {
            const uidSet = new Set<string>();
            for (const c of conversations) {
                const uid = ownerUidFromConnectionId(c.connectionId);
                if (uid) uidSet.add(uid);
            }
            for (const uid of uidSet) {
                const filtered = filterByConnectionScope(uid, payload);
                ownerEmitRedisBridge(uid, 'conversations-update', filtered as unknown as Record<string, unknown>);
            }
        }

        if (!io) return;
        for (const socket of getConnectedSocketsSafe()) {
            const uid = String((socket.data as { uid?: string }).uid ?? 'anonymous');
            socket.emit('conversations-update', filterByConnectionScope(uid, payload));
        }
        console.log(`[emitConversations] Emitiu com sucesso`);
    } catch (e: any) {
        console.error('[CRASH] Erro ao emitir conversations-update:', e?.message || e, e?.stack?.split('\n')[1] || '');
        // Em worker sem Socket.IO real, so registramos e seguimos.
    }
};

// --- PROFILE PICTURE PROGRESSIVE LOADER ---
const pictureFetchQueue = new Map<string, { connectionId: string; chatId: string }>();
let pictureFetcherRunning = false;

const enqueueConversationPicture = (connectionId: string, chatId: string, conversationId: string) => {
    if (pictureFetchQueue.has(conversationId)) return;
    pictureFetchQueue.set(conversationId, { connectionId, chatId });
    if (!pictureFetcherRunning) {
        pictureFetcherRunning = true;
        setTimeout(runPictureFetcher, 1500);
    }
};

// Busca em lote as fotos de perfil diretamente no Store do WhatsApp Web via Puppeteer.
// Muito mais confiável e rápido que client.getProfilePicUrl() (que falha com frequência
// em contas com muitas conversas por conta de rate limit / timeouts internos do wwebjs).
const fetchProfilePicsBatch = async (client: any, chatIds: string[]): Promise<Map<string, string>> => {
    const result = new Map<string, string>();
    if (!chatIds.length) return result;
    const pupPage = (client as any).pupPage;
    if (!pupPage) return result;
    try {
        const jsCode = `(async () => {
            var ids = ${JSON.stringify(chatIds)};
            var W = window.Store;
            if (!W || !W.Contact) return {};
            var out = {};
            var getThumbUrl = function(obj) {
                if (!obj) return null;
                var th = obj['__x_profilePicThumb'] || obj.profilePicThumbObj || obj.profilePicThumb;
                return (th && (th.imgFull || th.img || th.eurl)) || null;
            };
            for (var i = 0; i < ids.length; i++) {
                var id = ids[i];
                try {
                    var chatWid = (W.WidFactory && W.WidFactory.createWid) ? W.WidFactory.createWid(id) : id;
                    var ct = null;
                    if (W.Contact.get) {
                        ct = W.Contact.get(chatWid) || W.Contact.get(id);
                    }
                    var url = getThumbUrl(ct);
                    if (!url && W.ProfilePic && W.ProfilePic.profilePicFind) {
                        var r = await W.ProfilePic.profilePicFind(chatWid, true).catch(function(){return null;});
                        url = (r && (r.imgFull || r.img || r.eurl)) || null;
                    }
                    if (url && typeof url === 'string') {
                        out[id] = url;
                    }
                } catch(e) { /* ignore individual */ }
            }
            return out;
        })()`;
        const payload: Record<string, string> = await pupPage.evaluate(jsCode);
        for (const [id, url] of Object.entries(payload || {})) {
            if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('blob:'))) {
                result.set(id, url);
            }
        }
    } catch (e: any) {
        console.log('[PicBatch] erro:', e?.message || e);
    }
    return result;
};

const runPictureFetcher = async () => {
    let totalProcessed = 0;
    let totalFetched = 0;
    console.log(`[PicFetcher] iniciando. ${pictureFetchQueue.size} conversas na fila.`);
    try {
        while (pictureFetchQueue.size > 0) {
            // Drena ate 15 entradas de uma vez e agrupa por connectionId
            const entries = Array.from(pictureFetchQueue.entries()).slice(0, 15);
            const byConn = new Map<string, Array<{ convId: string; chatId: string }>>();
            for (const [convId, info] of entries) {
                pictureFetchQueue.delete(convId);
                const conv = conversations.find(c => c.id === convId);
                if (!conv || conv.profilePicUrl) { totalProcessed++; continue; }
                if (!byConn.has(info.connectionId)) byConn.set(info.connectionId, []);
                byConn.get(info.connectionId)!.push({ convId, chatId: info.chatId });
            }

            for (const [connId, items] of byConn.entries()) {
                const client: any = clients.get(connId);
                if (!client) { totalProcessed += items.length; continue; }
                const chatIds = items.map(i => i.chatId);
                const pics = await fetchProfilePicsBatch(client, chatIds);
                let batchUpdated = 0;
                for (const { convId, chatId } of items) {
                    totalProcessed++;
                    const url = pics.get(chatId);
                    if (!url) continue;
                    const idx = conversations.findIndex(c => c.id === convId);
                    if (idx < 0) continue;
                    conversations[idx] = { ...conversations[idx], profilePicUrl: url };
                    totalFetched++;
                    batchUpdated++;
                }
                if (batchUpdated > 0) emitConversationsUpdate();
                // Pequena pausa entre lotes para nao sobrecarregar o WhatsApp Web
                await new Promise(r => setTimeout(r, 600));
            }

            if (totalProcessed % 50 < 15) {
                console.log(`[PicFetcher] progresso: ${totalProcessed} processadas, ${totalFetched} com foto, ${pictureFetchQueue.size} restantes.`);
            }
        }
    } catch (err: any) {
        console.error('[PicFetcher] erro:', err?.message || err);
    } finally {
        pictureFetcherRunning = false;
        console.log(`[PicFetcher] concluido. ${totalProcessed} processadas, ${totalFetched} com foto real.`);
    }
};

const enqueueMissingPicturesForConnection = (connectionId: string) => {
    let enqueued = 0;
    for (const conv of conversations) {
        if (conv.connectionId !== connectionId) continue;
        if (conv.profilePicUrl) continue;
        if (conv.id.endsWith('@g.us')) continue;
        const colonIdx = conv.id.indexOf(':');
        if (colonIdx < 0) continue;
        const chatId = conv.id.substring(colonIdx + 1);
        if (!pictureFetchQueue.has(conv.id)) {
            pictureFetchQueue.set(conv.id, { connectionId, chatId });
            enqueued++;
        }
    }
    if (enqueued > 0) {
        console.log(`[PicFetcher] ${enqueued} conversas sem foto enfileiradas para ${connectionId}.`);
        if (!pictureFetcherRunning) {
            pictureFetcherRunning = true;
            setTimeout(runPictureFetcher, 500);
        }
    }
};

export const fetchConversationPicture = async (conversationId: string): Promise<string | null> => {
    const conv = conversations.find(c => c.id === conversationId);
    if (!conv) {
        console.log(`[PicFetch] Conversa nao encontrada: ${conversationId}`);
        return null;
    }
    if (conv.profilePicUrl) return conv.profilePicUrl;
    const colonIdx = conversationId.indexOf(':');
    if (colonIdx < 0) return null;
    const connectionId = conversationId.substring(0, colonIdx);
    const chatId = conversationId.substring(colonIdx + 1);
    const client: any = clients.get(connectionId);
    if (!client) {
        console.log(`[PicFetch] Cliente nao encontrado para ${connectionId}`);
        return null;
    }
    try {
        console.log(`[PicFetch] Buscando foto para ${chatId} via ${connectionId}...`);
        let pic: string | null = await Promise.race([
            client.getProfilePicUrl(chatId),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000))
        ]).catch(() => null);

        if (!pic && typeof client.getContactById === 'function') {
            const ct = await client.getContactById(chatId).catch(() => null);
            if (ct && typeof ct.getProfilePicUrl === 'function') {
                pic = await ct.getProfilePicUrl().catch(() => null);
            }
        }

        if (pic && typeof pic === 'string' && pic.startsWith('http')) {
            const idx = conversations.findIndex(c => c.id === conversationId);
            if (idx >= 0) {
                conversations[idx] = { ...conversations[idx], profilePicUrl: pic };
                emitConversationsUpdate();
            }
            console.log(`[PicFetch] Foto encontrada para ${chatId}`);
            return pic;
        }
        console.log(`[PicFetch] Sem foto disponivel para ${chatId}`);
    } catch (e: any) {
        console.log(`[PicFetch] Erro ao buscar ${chatId}:`, e?.message || e);
    }
    return null;
};

// Sync via Store.Chat direto pelo Puppeteer — usado quando client.getChats() falha.
// Traz TODAS as conversas do WhatsApp Web (incluindo arquivadas) com ultima mensagem,
// contato, unread count e timestamp — do jeito que o proprio WhatsApp exibe.
const syncConversationsViaStore = async (client: any, connectionId: string): Promise<boolean> => {
    const pupPage = (client as any).pupPage;
    if (!pupPage) return false;
    console.log(`[SyncConv] Tentando sync via Store.Chat (Puppeteer) para ${connectionId}...`);
    try {
        const jsCode = `(async () => {
            var W = window.Store;
            if (!W || !W.Chat) return { error: 'no_store' };
            var list = [];
            try {
                list = W.Chat.getModelsArray ? W.Chat.getModelsArray() : (W.Chat.models || []);
            } catch(e) {}
            if (!list || !list.length) return { error: 'empty' };
            var out = [];
            for (var i = 0; i < list.length; i++) {
                try {
                    var c = list[i];
                    if (!c || !c.id) continue;
                    var serialized = (c.id && (c.id._serialized || (typeof c.id.toString === 'function' && c.id.toString()))) || null;
                    if (!serialized) continue;
                    if (serialized === 'status@broadcast') continue;
                    var last = (c.msgs && c.msgs.last) ? c.msgs.last : (c.lastReceivedKey ? null : null);
                    var lastBody = (last && (last.body || last.caption)) || c.lastMessage && (c.lastMessage.body || c.lastMessage.caption) || '';
                    var lastTs = (last && (last.t || last.timestamp)) || c.t || 0;
                    var isGroup = !!c.isGroup || serialized.indexOf('@g.us') >= 0;
                    var name = c.name || c.formattedTitle || (c.contact && (c.contact.name || c.contact.pushname || c.contact.formattedName)) || '';
                    var number = (c.contact && c.contact.id && c.contact.id.user) || (c.id && c.id.user) || '';
                    var unread = c.unreadCount || 0;
                    out.push({
                        id: serialized,
                        name: name,
                        number: number,
                        unread: unread,
                        lastBody: lastBody,
                        lastTs: lastTs,
                        isGroup: isGroup
                    });
                } catch(e) { /* ignora individual */ }
            }
            return { chats: out };
        })()`;
        const raw: any = await pupPage.evaluate(jsCode);
        if (!raw || raw.error) {
            console.warn(`[SyncConv] Store.Chat indisponivel: ${raw?.error || 'unknown'}`);
            return false;
        }
        const rawChats: any[] = raw.chats || [];
        console.log(`[SyncConv] Store.Chat retornou ${rawChats.length} conversas.`);
        if (rawChats.length === 0) return false;

        // Ordena por mais recente primeiro para emitir conversas uteis antes
        rawChats.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));

        let processed = 0;
        for (const rc of rawChats) {
            const chatId: string = rc.id;
            const conversationId = getConversationKey(connectionId, chatId);
            const existing = conversations.find(c => c.id === conversationId);
            const contactName = rc.name || (rc.number ? `+${rc.number}` : 'Contato');
            const contactPhone = rc.number ? `+${rc.number}` : '';
            const lastTs: number = rc.lastTs || 0;
            const lastMessageTime = lastTs ? normalizeTimestamp(lastTs) : (existing?.lastMessageTime || '');
            const lastMessageTimestamp = lastTs ? lastTs * 1000 : (existing?.lastMessageTimestamp || Date.now());
            upsertConversation({
                id: conversationId,
                contactName,
                contactPhone,
                profilePicUrl: existing?.profilePicUrl,
                connectionId,
                unreadCount: rc.unread || 0,
                lastMessage: rc.lastBody || existing?.lastMessage || '',
                lastMessageTime,
                lastMessageTimestamp,
                messages: existing?.messages || [],
                tags: existing?.tags || []
            });
            if (!rc.isGroup) {
                enqueueConversationPicture(connectionId, chatId, conversationId);
            }
            processed++;
        }
        console.log(`[SyncConv] Store.Chat: ${processed} conversas processadas.`);
        emitConversationsUpdate();
        return true;
    } catch (e: any) {
        console.error('[SyncConv] Erro no sync via Store.Chat:', e?.message || e);
        return false;
    }
};

// Sync alternativo usando getContacts — ultimo recurso quando getChats E Store falham
const syncConversationsFromContacts = async (client: any, connectionId: string) => {
    console.log(`[SyncConv] Iniciando sync via getContacts para ${connectionId}...`);
    try {
        const contacts = await client.getContacts();
        console.log(`[SyncConv] Total de contatos: ${contacts.length}`);
        
        let processed = 0;
        for (const contact of contacts) {
            // Pegar apenas contatos que são usuários (não grupos) e têm número
            if (!contact.number || contact.isGroup) continue;
            
            const chatId = `${contact.number}@c.us`;
            const conversationId = getConversationKey(connectionId, chatId);
            
            // Verificar se já existe
            if (conversations.find(c => c.id === conversationId)) continue;
            
            const contactName = contact.name || contact.pushname || `+${contact.number}`;
            const contactPhone = `+${contact.number}`;

            upsertConversation({
                id: conversationId,
                contactName,
                contactPhone,
                profilePicUrl: undefined,
                connectionId,
                unreadCount: 0,
                lastMessage: '',
                lastMessageTime: '',
                lastMessageTimestamp: Date.now(),
                messages: [],
                tags: []
            });
            enqueueConversationPicture(connectionId, chatId, conversationId);
            processed++;
        }
        
        console.log(`[SyncConv] Processados ${processed} contatos para ${connectionId}`);
        emitConversationsUpdate();
    } catch (error: any) {
        console.error('[SyncConv] Erro no sync via getContacts:', error.message);
        throw error;
    }
};

const syncConversationsFromClient = async (client: any, connectionId: string) => {
    console.log(`[SyncConv] Iniciando sync para ${connectionId}...`);
    try {
        // Retry ate 3x — logo apos o 'ready' o Store do WhatsApp Web as vezes ainda
        // nao esta pronto, e a primeira chamada de getChats() pode lancar ou retornar 0.
        let chats: any[] = [];
        let lastErr: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const result = await Promise.race([
                    client.getChats(),
                    new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('getChats timeout 45s')), 45000))
                ]);
                if (Array.isArray(result) && result.length > 0) {
                    chats = result;
                    break;
                }
                console.warn(`[SyncConv] getChats tentativa ${attempt} retornou ${Array.isArray(result) ? result.length : 'nao-array'}, tentando novamente...`);
            } catch (e: any) {
                lastErr = e;
                console.warn(`[SyncConv] getChats tentativa ${attempt} falhou: ${e?.message || e}`);
            }
            if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 3000));
        }
        if (!chats.length) {
            throw lastErr || new Error('getChats retornou vazio apos 3 tentativas');
        }
        // getChats() já retorna ordenado por recência — preservar essa ordem
        console.log(`[SyncConv] Total de chats obtidos: ${chats.length}`);
        let processed = 0;
        for (const chat of chats) {
            // Pular broadcasts e status
            if (chat.isStatus || chat.id?._serialized === 'status@broadcast') continue;
            const contact = await chat.getContact().catch(() => null);
            const contactName = chat.name || contact?.name || contact?.pushname || contact?.number || 'Contato';
            const contactPhone = contact?.number ? `+${contact.number}` : chat.id?.user ? `+${chat.id.user}` : '';
            // Usar apenas fallback ui-avatars para contatos (foto real causa crash no sync de 428 chats)
            const profilePicUrl = undefined;
            const lastMessage = chat.lastMessage?.body || '';
            const lastMsgTs = chat.lastMessage?.timestamp || 0;
            const lastMessageTime = lastMsgTs ? normalizeTimestamp(lastMsgTs) : '';
            const lastMessageTimestamp = lastMsgTs ? lastMsgTs * 1000 : Date.now();
            const fetchedMessages = await chat.fetchMessages({ limit: 25 }).catch(() => []);
            const messages: ChatMessage[] = (await Promise.all(
                fetchedMessages
                    .filter((msg: any) => !msg.isStatus)
                    .map(toChatMessage)
            )).reverse().slice(-MAX_MESSAGES);

            const conversationId = getConversationKey(connectionId, chat.id._serialized);
            upsertConversation({
                id: conversationId,
                contactName,
                contactPhone,
                profilePicUrl: profilePicUrl || undefined,
                connectionId,
                unreadCount: chat.unreadCount || 0,  // valor real do WhatsApp
                lastMessage,
                lastMessageTime,
                lastMessageTimestamp,
                messages,
                tags: []
            });
            if (!chat.id._serialized.endsWith('@g.us')) {
                enqueueConversationPicture(connectionId, chat.id._serialized, conversationId);
            }
            processed++;
        }
        console.log(`[SyncConv] Processados ${processed} conversas para ${connectionId}`);
        console.log(`[SyncConv] Total no array: ${conversations.length}`);
        emitConversationsUpdate();
        console.log(`[SyncConv] Emittiu conversas-update com ${conversations.length} total`);
    } catch (error) {
        console.error('[SyncConv] Erro ao sincronizar conversas:', error);
    }
};

// --- CONNECTION MANAGEMENT ---

/** Sanitiza nome amigável: corta controlos, normaliza espaços e limita comprimento. */
const sanitizeConnectionDisplayName = (raw: string | undefined | null, fallback = 'WhatsApp'): string => {
    const cleaned = String(raw ?? '')
        // remove caracteres de controlo (incluindo \u0000-\u001F, DEL e similares)
        // que podem corromper armazenamento ou logs
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
        // normaliza espaços
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return fallback;
    return cleaned.length > 60 ? cleaned.slice(0, 60).trim() : cleaned;
};

export const createConnection = async (name: string, ownerUid?: string) => {
    const safeName = sanitizeConnectionDisplayName(name);
    const baseId = Date.now().toString();
    const connectionId = ownerUid ? `${ownerUid}__${baseId}` : baseId;
    
    const newConn: WhatsAppConnection = {
        id: connectionId,
        name: safeName,
        phoneNumber: null,
        status: ConnectionStatus.CONNECTING,
        lastActivity: 'Inicializando...',
        queueSize: 0,
        messagesSentToday: 0,
        signalStrength: 'STRONG',
        batteryLevel: 0,
        ...(ownerUid ? { ownerUid } : {})
    };
    connectionsInfo.push(newConn);
    persistConnections().catch(() => {});
    initializeClient(connectionId, safeName);
    return newConn;
};

// Handler quando cliente está pronto
const handleClientReady = async (client: WhatsAppClient, id: string, name: string) => {
    console.log(`[handleClientReady] 🟢 Cliente ${name} (${id}) está pronto!`);
    let phoneNumber = '';
    let profilePicUrl = '';

    try {
        const info = client.info;
        phoneNumber = info?.wid?.user || '';
        console.log(`[handleClientReady] Info do cliente ${name}:`, { phone: phoneNumber, wid: info?.wid?._serialized });
        const widSerialized = info?.wid?._serialized;
        if (widSerialized) {
            console.log(`[handleClientReady] Buscando profile pic para ${widSerialized}...`);
            try {
                // Tentar obter contato primeiro, depois a foto
                console.log(`[handleClientReady] Tentando getContactById...`);
                const contact = await client.getContactById(widSerialized).catch((e: any) => {
                    console.log(`[handleClientReady] getContactById falhou:`, e?.message || e);
                    return null;
                });
                console.log(`[handleClientReady] Contato obtido:`, contact ? 'sim' : 'não');
                if (contact) {
                    console.log(`[handleClientReady] Tentando contact.getProfilePicUrl...`);
                    profilePicUrl = await contact.getProfilePicUrl().catch((e: any) => {
                        console.log(`[handleClientReady] contact.getProfilePicUrl falhou:`, e?.message || e);
                        return '';
                    });
                    console.log(`[handleClientReady] URL do contato:`, profilePicUrl || 'vazio');
                }
                // Fallback: tentar diretamente pelo client
                if (!profilePicUrl) {
                    console.log(`[handleClientReady] Tentando client.getProfilePicUrl...`);
                    profilePicUrl = await client.getProfilePicUrl(widSerialized).catch((e: any) => {
                        console.log(`[handleClientReady] client.getProfilePicUrl falhou:`, e?.message || e);
                        return '';
                    });
                    console.log(`[handleClientReady] URL do client:`, profilePicUrl || 'vazio');
                }
            } catch (e: any) {
                console.log(`[handleClientReady] Erro geral ao buscar avatar:`, e?.message || e);
            }
            // Fallback: preferir nome da conexão ou pushname — nunca o número bruto
            if (!profilePicUrl) {
                const pushname = client.info?.pushname || '';
                const isNumber = /^\d[\d\s\-+()]*$/.test(pushname);
                const displayName = name || (!isNumber && pushname) || 'WA';
                profilePicUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=25D366&color=fff&size=128&bold=true`;
            }
            console.log(`[handleClientReady] Avatar final: ${profilePicUrl ? profilePicUrl.substring(0, 60) : 'vazio'}`);
        }
    } catch (e) {
        console.error('[handleClientReady] Erro ao buscar infos do perfil:', e);
    }

    console.log(`[handleClientReady] Atualizando estado para CONNECTED...`);
    const existingConn = connectionsInfo.find(c => c.id === id);
    // Preservar connectedSince salvo (sobrevive a reiniínios do servidor)
    // Só define novo timestamp se não houver um salvo
    const connectedSince = existingConn?.connectedSince || Date.now();
    updateConnectionState(id, { 
        status: ConnectionStatus.CONNECTED, 
        phoneNumber: phoneNumber ? `+${phoneNumber}` : undefined,
        profilePicUrl,
        lastActivity: 'Online',
        batteryLevel: 100,
        connectedSince,
        totalMessagesSent: existingConn?.totalMessagesSent || 0,
        healthScore: 100,
        qrCode: undefined
    });

    // Buscar foto de perfil async (getProfilePicUrl falha para si mesmo; usar Store diretamente)
    setTimeout(async () => {
        try {
            const widSerialized = client.info?.wid?._serialized;
            if (!widSerialized) return;
            const pupPage = (client as any).pupPage;
            if (!pupPage) return;

            // Usar string JS pura — evita o helper __name que TSX injeta e não existe no browser
            const jsCode = `(async () => {
                var wid = ${JSON.stringify(widSerialized)};
                var toB64 = async function(url) {
                    try {
                        var resp = await fetch(url);
                        var blob = await resp.blob();
                        return await new Promise(function(res) {
                            var r = new FileReader();
                            r.onload = function() { res(r.result); };
                            r.onerror = function() { res(null); };
                            r.readAsDataURL(blob);
                        });
                    } catch(e) { return null; }
                };
                try {
                    var W = window.Store;
                    if (!W) return '__NO_STORE__';
                    var chatWid = W.WidFactory && W.WidFactory.createWid ? W.WidFactory.createWid(wid) : wid;
                    // Tentar Contact.find (async — carrega do servidor se não estiver no cache)
                    var ct = null;
                    if (W.Contact) {
                        ct = W.Contact.get(chatWid) || W.Contact.get(wid);
                        if (!ct && W.Contact.find) {
                            ct = await W.Contact.find(chatWid).catch(function(){return null;});
                        }
                    }
                    // Chave real é __x_profilePicThumb (nome minificado pelo WhatsApp Web)
                    var getThumbUrl = function(obj) {
                        if (!obj) return null;
                        var th = obj['__x_profilePicThumb'] || obj.profilePicThumbObj || obj.profilePicThumb;
                        return th && (th.imgFull || th.img || th.eurl) || null;
                    };
                    if (ct) {
                        var u2 = getThumbUrl(ct);
                        if (u2) return (u2.startsWith('http')||u2.startsWith('blob')) ? await toB64(u2) : u2;
                    }
                    var me = W.MeContact || (W.Contact && W.Contact.getMeContact && W.Contact.getMeContact());
                    if (me) {
                        var u3 = getThumbUrl(me);
                        if (u3) return (u3.startsWith('http')||u3.startsWith('blob')) ? await toB64(u3) : u3;
                    }
                    // Último recurso: ProfilePic.profilePicFind
                    if (W.ProfilePic && W.ProfilePic.profilePicFind) {
                        var r1 = await W.ProfilePic.profilePicFind(chatWid, true).catch(function(){return null;});
                        var u1 = r1 && (r1.imgFull || r1.img || r1.eurl);
                        if (u1) return (u1.startsWith('http')||u1.startsWith('blob')) ? await toB64(u1) : u1;
                    }
                    return null;
                } catch(e) { return '__ERR__:' + (e && e.message); }
            })()`;
            const picUrl: string | null = await pupPage.evaluate(jsCode);
            const isValidPic = picUrl && (picUrl.startsWith('data:') || picUrl.startsWith('http'));
            if (isValidPic) {
                console.log(`[Avatar] ✅ Foto real obtida para ${id} (${picUrl!.length} bytes)`);
                updateConnectionState(id, { profilePicUrl: picUrl! });
                emitConnectionsUpdate();
                persistConnections().catch(() => {});
            } else {
                console.log(`[Avatar] Sem foto disponível para ${id} — usando fallback`);
            }
        } catch (e: any) {
            console.log(`[Avatar] Erro ao buscar foto async:`, e?.message || e);
        }
    }, 8000);

    console.log(`[handleClientReady] Emitindo connection-ready e connections-update...`);
    emitToConnectionOwner('connection-ready', id, { connectionId: id });
    emitConnectionPhase(id, 'ready');
    initAutoRetryCount.delete(id);
    emitConnectionsUpdate();
    persistConnections().catch(() => {});
    reconnectState.delete(id);
    resumeQueueIfNeeded(id);
    
    // Sync de conversas de forma assíncrona e não-bloqueante
    console.log(`[handleClientReady] ✅ Conexão estabelecida - sincronizando conversas em background...`);
    setImmediate(() => {
        syncConversationsFromClient(client, id)
            .catch(async (err) => {
                console.warn('[handleClientReady] getChats falhou, tentando Store.Chat direto:', err?.message || err);
                const ok = await syncConversationsViaStore(client, id).catch(e => {
                    console.warn('[handleClientReady] Store.Chat falhou:', e?.message || e);
                    return false;
                });
                if (ok) return;
                console.warn('[handleClientReady] Fallback final via getContacts...');
                return syncConversationsFromContacts(client, id).catch(e => {
                    console.warn('[handleClientReady] Sync de contatos também falhou:', e?.message || e);
                });
            })
            .finally(() => {
                // Foto de perfil: primeiro passo rapido (3s) e depois mais um (30s)
                // para pegar contatos que so apareceram apos scroll/sincronizacao do WA Web.
                setTimeout(() => enqueueMissingPicturesForConnection(id), 3000);
                setTimeout(() => enqueueMissingPicturesForConnection(id), 30000);
                setTimeout(() => enqueueMissingPicturesForConnection(id), 90000);
            });
    });
    emitConversationsUpdate();
    
    // Iniciar health check e métricas
    console.log(`[handleClientReady] Iniciando health check e métricas...`);
    initChannelMetrics(id);
    startHealthCheck(id);
    advancedFeatures.initWarmup(id);

    // Backup da sessao 60s apos conectar — garante que temos um snapshot
    // consistente no disco caso o proximo SIGTERM corrompa os arquivos do
    // Chromium. O backup so e tirado com a conexao estavel por >60s para
    // evitar salvar estados transitorios.
    setTimeout(() => {
        const conn = connectionsInfo.find(c => c.id === id);
        if (conn?.status === ConnectionStatus.CONNECTED && !isShuttingDown) {
            backupSession(id).catch((e: any) => {
                console.warn(`[SessionBackup] Falha no backup pos-ready ${id}:`, e?.message || e);
            });
        }
    }, 60000);
};

// Controla quantas vezes ja tentamos restaurar backup por sessao nesta vida do processo
const backupRestoreAttempts = new Map<string, number>();
/** Contador de auto-retentativa do init quando o 1º QR demora — limita a 1 antes de avisar o utilizador. */
const initAutoRetryCount = new Map<string, number>();
const MAX_INIT_AUTO_RETRY = Math.max(0, Number(process.env.WA_INIT_AUTO_RETRY || '1'));

/** Tempo máx. para o `qr` (ou `ready` se sessão restaurada) chegar; senão aborta. */
const FIRST_QR_TIMEOUT_MS = Number(process.env.WA_FIRST_QR_TIMEOUT_MS || 90_000);

type ConnectionInitPhase =
    | 'queued'
    | 'preparing'
    | 'launching-browser'
    | 'loading-whatsapp-web'
    | 'awaiting-scan'
    | 'authenticated'
    | 'ready'
    | 'failed';

const emitConnectionPhase = (
    id: string,
    phase: ConnectionInitPhase,
    extra?: Record<string, unknown>
) => {
    emitToConnectionOwner('connection-progress', id, {
        connectionId: id,
        phase,
        at: Date.now(),
        ...(extra || {})
    });
};

const initializeClient = async (id: string, name: string) => {
    console.log(`Inicializando cliente whatsapp-web.js: ${name} (${id})`);
    
    // Evitar múltiplas instâncias simultâneas
    if (clients.has(id)) {
        console.log(`[whatsapp-web.js] Cliente ${name} já existe, ignorando duplicata`);
        return;
    }

    // Definir CONNECTING imediatamente — evita UI mostrar "Offline" enquanto Chrome carrega
    updateConnectionState(id, {
        status: ConnectionStatus.CONNECTING,
        lastActivity: 'Inicializando...',
        qrCode: undefined
    });
    emitConnectionsUpdate();
    emitConnectionPhase(id, 'preparing');

    // Se a sessao principal estiver faltando mas tivermos um backup do shutdown
    // anterior, restauramos proativamente. Evita o usuario ver um QR novo quando
    // o Chromium foi morto de forma tosca no deploy anterior.
    try {
        await migrateLegacyWaSessionFolders(id);
        const { sessionPath, backupPath } = waSessionDirPair(id);
        const sessionExists = await fs.promises.access(sessionPath).then(() => true).catch(() => false);
        const backupExists = await fs.promises.access(backupPath).then(() => true).catch(() => false);
        if (!sessionExists && backupExists && (backupRestoreAttempts.get(id) || 0) < 1) {
            console.log(`[whatsapp-web.js] 🔁 Sessao ${name} ausente — restaurando do backup antes de iniciar.`);
            await restoreSession(id).catch(() => false);
            backupRestoreAttempts.set(id, 1);
        }
    } catch {
        /* ignore — initialize lida com a ausencia */
    }

    // Limpar reconnect antigo se existir
    const state = reconnectState.get(id);
    if (state?.timeout) {
        clearTimeout(state.timeout);
        reconnectState.delete(id);
    }
    
    // NÃO limpar cache aqui — clearing a cada init força re-download completo do WWeb
    // (cache só é limpo em forceQr ou erros de corrupção)

    // Limpa arquivos de lock do Chromium caso algum processo anterior tenha morrido sem limpar
    // (evita erro "The browser is already running for ...session-XXX" em HMR/restart do servidor).
    clearSessionLocks(id);

    // Hoist do timeout para ser acessivel pelo catch e evitar que o timeout de 240s
    // continue ativo apos uma falha imediata de inicializacao (ex: browser lock).
    let connectionTimeoutRef: NodeJS.Timeout | null = null;

    try {
        const { slug, sessionPath } = waSessionDirPair(id);
        const remoteWaHtml = process.env.WWEBJS_WEB_VERSION_URL?.trim();
        const webVersionCache = remoteWaHtml
            ? { type: 'remote' as const, remotePath: remoteWaHtml }
            : { type: 'local' as const };
        if (remoteWaHtml) {
            console.log(`[whatsapp-web.js] webVersionCache remote: ${remoteWaHtml.slice(0, 80)}…`);
        }
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: slug, dataPath: authDir }),
            webVersionCache,
            puppeteer: {
                // Forca isolamento explicito por conexao para evitar colisoes de perfil.
                userDataDir: sessionPath,
                headless: process.env.HEADFUL_MODE !== 'true',
                protocolTimeout: 180000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--no-zygote',
                    '--disable-extensions',
                    '--no-first-run',
                    '--disable-default-apps',
                    '--window-size=1280,800'
                ]
            }
        });

        let isReadyHandled = false;
        let firstQrTimeoutRef: NodeJS.Timeout | null = null;

        const clearConnectionTimeout = () => {
            if (connectionTimeoutRef) {
                clearTimeout(connectionTimeoutRef);
                connectionTimeoutRef = null;
            }
            if (firstQrTimeoutRef) {
                clearTimeout(firstQrTimeoutRef);
                firstQrTimeoutRef = null;
            }
        };

        emitConnectionPhase(id, 'launching-browser');
        // Após `launching-browser`, o WWeb-JS faz GET no whatsapp.com — sinaliza
        // a fase intermediária para o front após ~3s (quando o `qr` ainda não veio).
        const loadingPhaseTimer = setTimeout(() => {
            if (!isReadyHandled) emitConnectionPhase(id, 'loading-whatsapp-web');
        }, 3500);

        client.on('qr', (qr) => {
            if (isReadyHandled) return;
            if (firstQrTimeoutRef) {
                clearTimeout(firstQrTimeoutRef);
                firstQrTimeoutRef = null;
            }
            clearTimeout(loadingPhaseTimer);
            console.log(`[whatsapp-web.js] 📱 QR Code gerado para ${name}`);
            updateConnectionState(id, {
                status: ConnectionStatus.QR_READY,
                lastActivity: 'Aguardando Leitura',
                qrCode: qr
            });
            emitToConnectionOwner('qr-code', id, { connectionId: id, qrCode: qr });
            emitConnectionsUpdate();
            emitConnectionPhase(id, 'awaiting-scan');
        });

        client.on('authenticated', () => {
            if (isReadyHandled) return;
            if (firstQrTimeoutRef) {
                clearTimeout(firstQrTimeoutRef);
                firstQrTimeoutRef = null;
            }
            clearTimeout(loadingPhaseTimer);
            console.log(`[whatsapp-web.js] 🔐 ${name} autenticado`);
            updateConnectionState(id, {
                status: ConnectionStatus.CONNECTING,
                lastActivity: 'Autenticado',
                qrCode: undefined
            });
            emitConnectionsUpdate();
            emitToConnectionOwner('connection-authenticated', id, { connectionId: id });
            emitConnectionPhase(id, 'authenticated');
        });

        client.on('ready', async () => {
            if (isReadyHandled) return;
            isReadyHandled = true;
            clearConnectionTimeout();
            console.log(`[whatsapp-web.js] ✅ ${name} PRONTO!`);
            try {
                await handleClientReady(client, id, name);
            } catch (err) {
                console.error(`[whatsapp-web.js] Erro no ready ${name}:`, err);
            }
        });

        client.on('auth_failure', (msg) => {
            console.error(`[whatsapp-web.js] ❌ Falha ${name}:`, msg);
            clearConnectionTimeout();
            updateConnectionState(id, {
                status: ConnectionStatus.DISCONNECTED,
                lastActivity: 'Falha auth',
                qrCode: undefined
            });
            emitConnectionsUpdate();
            emitToConnectionOwner('auth-failure', id, { connectionId: id, message: msg });
        });
        
        // Timeout para o PRIMEIRO QR/auth: se nada chegou em FIRST_QR_TIMEOUT_MS,
        // tenta automaticamente uma vez antes de devolver erro amigável ao utilizador.
        firstQrTimeoutRef = setTimeout(async () => {
            if (isReadyHandled) return;
            const conn = connectionsInfo.find((c) => c.id === id);
            if (conn?.status === ConnectionStatus.QR_READY) return; // Já temos QR; deixa o timeout global gerir.
            clearTimeout(loadingPhaseTimer);
            const tries = initAutoRetryCount.get(id) || 0;
            const willRetry = tries < MAX_INIT_AUTO_RETRY;
            console.warn(
                `[whatsapp-web.js] ⏱️ Sem QR/auth em ${FIRST_QR_TIMEOUT_MS}ms para ${name} — ` +
                `${willRetry ? `auto-retry ${tries + 1}/${MAX_INIT_AUTO_RETRY}` : 'abortando motor.'}`
            );
            // Independente de retry/desistência, libertamos o motor actual.
            if (clients.has(id)) {
                const clientToDestroy = clients.get(id);
                clients.delete(id);
                try { await clientToDestroy?.destroy(); } catch { /* ignore */ }
            }
            try { clearSessionLocks(id); } catch { /* ignore */ }
            if (willRetry) {
                initAutoRetryCount.set(id, tries + 1);
                emitConnectionPhase(id, 'preparing', { autoRetry: tries + 1, of: MAX_INIT_AUTO_RETRY });
                updateConnectionState(id, {
                    status: ConnectionStatus.CONNECTING,
                    lastActivity: `A retentar (${tries + 1}/${MAX_INIT_AUTO_RETRY})...`,
                    qrCode: undefined
                });
                emitConnectionsUpdate();
                // Pequeno delay para o GC do Chromium fechar tudo bem.
                setTimeout(() => {
                    initializeClient(id, name).catch((e: any) =>
                        console.warn(`[whatsapp-web.js] auto-retry init falhou para ${name}:`, e?.message || e)
                    );
                }, 1500);
                return;
            }
            // Esgotou retries — agora avisa o utilizador.
            initAutoRetryCount.delete(id);
            emitConnectionPhase(id, 'failed', { reason: 'first-qr-timeout' });
            emitToConnectionOwner('connection-init-failure', id, {
                connectionId: id,
                message: `Não foi possível gerar o QR code em ${Math.round(FIRST_QR_TIMEOUT_MS / 1000)}s mesmo após retentar. Tente "Forçar QR" mais tarde ou verifique a ligação do servidor a whatsapp.com.`
            });
            updateConnectionState(id, {
                status: ConnectionStatus.DISCONNECTED,
                lastActivity: 'Sem QR no tempo previsto',
                qrCode: undefined
            });
            emitConnectionsUpdate();
        }, FIRST_QR_TIMEOUT_MS);

        // Timeout global: 240s para dar tempo ao WhatsApp Web de carregar completamente
        connectionTimeoutRef = setTimeout(async () => {
            if (!isReadyHandled) {
                console.log(`[whatsapp-web.js] ⏱️ Timeout ${name} (240s) - limpando e reiniciando motor...`);
                updateConnectionState(id, {
                    status: ConnectionStatus.DISCONNECTED,
                    lastActivity: 'Timeout conexão',
                    qrCode: undefined
                });
                emitConnectionsUpdate();
                clearTimeout(loadingPhaseTimer);
                
                // CRÍTICO: Limpar referência ANTES de tentar destruir e agendar reconexão
                if (clients.has(id)) {
                    const clientToDestroy = clients.get(id);
                    clients.delete(id); // Remove do mapa para permitir novo agendamento
                    try {
                        console.log(`[whatsapp-web.js] Destruindo instância travada de ${name}...`);
                        await clientToDestroy?.destroy();
                    } catch (e) {
                        console.log(`[whatsapp-web.js] Erro ao destruir cliente (timeout):`, e);
                    }
                }
                
                scheduleReconnect(id, name, 'timeout_240s');
            }
        }, 240000);

        client.on('disconnected', async (reason) => {
            // Durante shutdown gracioso (SIGTERM do deploy), nao mudamos status
            // nem agendamos reconexao — se mudassemos, o disco ficaria com
            // DISCONNECTED e o proximo boot nao tentaria restaurar a sessao.
            if (isShuttingDown) {
                console.log(`[whatsapp-web.js] ${name} desconectado durante shutdown (${reason}) — ignorando.`);
                return;
            }
            console.warn(`[whatsapp-web.js] ${name} desconectado: ${reason}`);
            stopHealthCheck(id);
            // Limpar connectedSince ao desconectar genuinamente (será recalculado ao reconectar)
            updateConnectionState(id, {
                status: ConnectionStatus.DISCONNECTED,
                lastActivity: 'Desconectado',
                connectedSince: undefined,
                qrCode: undefined
            });
            
            // Garantir que a instância antiga seja removida do mapa
            if (clients.has(id)) {
                const oldClient = clients.get(id);
                clients.delete(id);
                try { await oldClient?.destroy(); } catch (e) {}
            }
            
            scheduleReconnect(id, name, reason);
        });

        // Mensagens recebidas em tempo real
        client.on('message', async (msg) => {
            if (!msg || typeof msg.getChat !== 'function') return;
            if (msg.isStatus) return;
            const chat = await msg.getChat().catch(() => null);
            if (!chat) return;
            const contact = await msg.getContact().catch(() => null);
            const convId = getConversationKey(id, chat.id._serialized);
            // Mensagem real chegou: se conversa estava no blocklist, libera.
            allowDeletedConversation(convId);
            const existing = conversations.find(c => c.id === convId);
            const newMsg = await toChatMessage(msg);
            const msgTs = (msg.timestamp || 0) * 1000 || Date.now();
            // Funil persistente: registra resposta a campanha (se aplicavel)
            try {
                if (newMsg.sender === 'them') {
                    let funnelPhone = '';
                    if (contact?.number) funnelPhone = String(contact.number).replace(/\D/g, '');
                    if (!funnelPhone && chat?.id?._serialized) funnelPhone = toPhoneKey(chat.id._serialized);
                    handleIncomingForFunnel(convId, msgTs, funnelPhone || undefined);
                }
            } catch (e: any) {
                console.log('[FunnelStats] Falha em handleIncomingForFunnel:', e?.message || e);
            }
            try {
                if (!msg.fromMe && newMsg.sender === 'them') {
                    const chatSerialized = chat.id?._serialized || '';
                    if (!chatSerialized.endsWith('@g.us')) {
                        let phoneDigits = '';
                        if (contact?.number) phoneDigits = String(contact.number).replace(/\D/g, '');
                        if (!phoneDigits) phoneDigits = toPhoneKey(chatSerialized);
                        if (phoneDigits.length >= 8) {
                            handleReplyFlowIncoming(id, phoneDigits, String(msg.body || ''));
                        }
                    }
                }
            } catch (rfErr: any) {
                console.log('[ReplyFlow] Falha ao processar resposta:', rfErr?.message || rfErr);
            }
            if (existing) {
                existing.messages = [...existing.messages.slice(-(MAX_MESSAGES - 1)), newMsg];
                existing.lastMessage = msg.body || '';
                existing.lastMessageTime = newMsg.timestamp;
                existing.lastMessageTimestamp = msgTs;
                existing.unreadCount = (existing.unreadCount || 0) + 1;
                upsertConversation(existing);
            } else {
                const contactName = contact?.name || contact?.pushname || chat.name || chat.id?.user || 'Contato';
                const contactPhone = contact?.number ? `+${contact.number}` : chat.id?.user ? `+${chat.id.user}` : '';
                const profilePicUrl = contact ? await contact.getProfilePicUrl().catch(() => undefined) : undefined;
                upsertConversation({
                    id: convId,
                    contactName,
                    contactPhone,
                    profilePicUrl,
                    connectionId: id,
                    unreadCount: 1,
                    lastMessage: msg.body || '',
                    lastMessageTime: newMsg.timestamp,
                    lastMessageTimestamp: msgTs,
                    messages: [newMsg],
                    tags: []
                });
            }
            emitConversationsUpdate();
        });

        // Atualizar ack (status de entrega/leitura) em tempo real
        client.on('message_ack', (msg, ack) => {
            const ackMsgId = normalizeWwebMessageId(msg?.id);
            // Atualiza contador persistente do funil para mensagens de campanha
            if (ackMsgId) {
                try {
                    handleCampaignAck(ackMsgId, Number(ack));
                } catch (e: any) {
                    console.log('[FunnelStats] Falha em handleCampaignAck:', e?.message || e);
                }
            }
            if (!msg || msg.to == null || msg.to === '') return;
            const convId = getConversationKey(id, String(msg.to));
            const conv = conversations.find(c => c.id === convId);
            if (!conv) return;
            conv.messages = conv.messages.map((m) =>
                normalizeWwebMessageId(m.id) === ackMsgId ? { ...m, status: resolveMessageStatus(ack) } : m
            );
            emitConversationsUpdate();
        });

        if (process.env.HEADFUL_MODE === 'true') {
            console.log('\n╔════════════════════════════════════════════════════════════╗');
            console.log('║  🌐 MODO HEADFUL ATIVO - WhatsApp Web Visível!          ║');
            console.log('╚════════════════════════════════════════════════════════════╝');
            console.log('\n📋 INSTRUÇÕES:');
            console.log('  1. Uma janela do Chrome vai abrir automaticamente');
            console.log('  2. Você verá o WhatsApp Web carregando');
            console.log('  3. Abra as conversas para aquecer os números');
            console.log('  4. Deixe a janela ABERTA durante o aquecimento\n');
        }

        clients.set(id, client);
        console.log(`[whatsapp-web.js] Cliente ${name} criado, iniciando...`);
        await client.initialize();
        await writeLogicalIdMarkerToSessionDir(id, waSessionDirPair(id).sessionPath);

    } catch (err: any) {
        console.error(`Erro ao inicializar cliente whatsapp-web.js ${name}:`, err?.message || err);
        updateConnectionState(id, {
            status: ConnectionStatus.DISCONNECTED,
            lastActivity: 'Erro ao iniciar',
            qrCode: undefined
        });
        emitConnectionsUpdate();
        persistConnections().catch(() => {});

        // Cancela o timeout de 240s para nao disparar reconnect duplicado depois
        if (connectionTimeoutRef) {
            clearTimeout(connectionTimeoutRef);
            connectionTimeoutRef = null;
        }

        // Remove o client do mapa para permitir que scheduleReconnect funcione
        // (o client foi inserido em clients.set antes do initialize() falhar).
        if (clients.has(id)) {
            const broken = clients.get(id);
            clients.delete(id);
            try { await broken?.destroy(); } catch { /* ignore */ }
        }

        const msg = String(err?.message || '');
        const forUser = (msg || String(err) || 'erro desconhecido').replace(/\0/g, '');
        const userMsg = forUser.length > 500 ? forUser.slice(0, 500) + '…' : forUser;
        emitToConnectionOwner('connection-init-failure', id, { connectionId: id, message: userMsg });
        emitConnectionPhase(id, 'failed', { reason: 'init-error', message: userMsg.slice(0, 160) });
        const isBrowserLock =
            msg.includes('browser is already running') ||
            msg.includes('SingletonLock') ||
            msg.includes('process_singleton_posix') ||
            msg.includes('profile appears to be in use');
        // Sinais classicos de sessao corrompida apos SIGKILL do Chromium.
        // Se batermos nisso e tivermos um backup, restauramos e tentamos de novo.
        const isCorruptionSignal = /Protocol error|Execution context was destroyed|Target closed|Session closed|IndexedDB|Failed to read|ENOENT.*LOCK|Unexpected token/i.test(msg);

        if (isBrowserLock) {
            // Chromium anterior deixou o userDataDir travado. Mata processos orfaos,
            // limpa os arquivos de lock e agenda nova tentativa apos alguns segundos.
            console.log(`[whatsapp-web.js] 🔧 Browser travado em ${name} - matando orfaos e limpando locks...`);
            await killOrphanChromeForSession(id);
            clearSessionLocks(id);
            setTimeout(() => scheduleReconnect(id, name, 'browser_lock'), 6000);
        } else if (isCorruptionSignal && (backupRestoreAttempts.get(id) || 0) < 1) {
            // Tenta restaurar do backup (criado no shutdown anterior) e reinicia.
            backupRestoreAttempts.set(id, (backupRestoreAttempts.get(id) || 0) + 1);
            console.warn(`[whatsapp-web.js] 🩺 Sessao ${name} parece corrompida (${msg.slice(0, 80)}) — tentando restore do backup...`);
            const restored = await restoreSession(id).catch(() => false);
            if (restored) {
                clearSessionLocks(id);
                setTimeout(() => scheduleReconnect(id, name, 'restored_from_backup'), 4000);
            } else {
                console.warn(`[whatsapp-web.js] Sem backup valido para ${name} — agendando reconnect normal.`);
                scheduleReconnect(id, name, `init_error: ${msg || 'corrupcao'}`);
            }
        } else if (!msg.includes('Failed to launch')) {
            scheduleReconnect(id, name, `init_error: ${msg || 'erro desconhecido'}`);
        }
    }
};

// --- CAMPAIGN ENGINE (REAL-TIME) ---

type CampaignRecipient = { phone: string; vars: Record<string, string> };

const normalizePhoneKey = (phone: string): string => (phone || '').replace(/\D/g, '');

const buildRecipientVarsMap = (recipients?: CampaignRecipient[]): Map<string, Record<string, string>> => {
    const map = new Map<string, Record<string, string>>();
    if (!recipients || !Array.isArray(recipients)) return map;
    for (const r of recipients) {
        const key = normalizePhoneKey(r.phone);
        if (!key) continue;
        map.set(key, r.vars || {});
    }
    return map;
};

const applyMessageVars = (template: string, phone: string, vars: Record<string, string> = {}): string => {
    const safeVars: Record<string, string> = {
        ...vars,
        telefone: vars.telefone || phone
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

type ReplyFlowStepDef = {
    body: string;
    acceptAnyReply: boolean;
    validTokens: string[];
    invalidReplyBody: string;
};

type ReplyFlowSession = {
    campaignId: string;
    /** Indice da etapa ja enviada; aguardamos resposta conforme o gate desta etapa antes de enviar a proxima. */
    awaitingAfterStep: number;
    vars: Record<string, string>;
    /** Mesmo `to` usado na fila na abertura (formato da campanha). */
    toRaw: string;
};

const replyFlowDefs = new Map<string, { steps: ReplyFlowStepDef[] }>();
const replyFlowSessions = new Map<string, ReplyFlowSession>();
const replyFlowSessionCountByCampaign = new Map<string, number>();

const adjustReplyFlowSessionCount = (campaignId: string, delta: number) => {
    if (!campaignId) return;
    const next = (replyFlowSessionCountByCampaign.get(campaignId) || 0) + delta;
    if (next <= 0) replyFlowSessionCountByCampaign.delete(campaignId);
    else replyFlowSessionCountByCampaign.set(campaignId, next);
};

const maybeClearReplyFlowDef = (campaignId: string) => {
    if (!campaignId) return;
    if ((replyFlowSessionCountByCampaign.get(campaignId) || 0) === 0) {
        replyFlowDefs.delete(campaignId);
    }
};

const sanitizeReplyFlowSteps = (
    raw: Array<{ body?: string; acceptAnyReply?: boolean; validTokens?: string[]; invalidReplyBody?: string }>
): ReplyFlowStepDef[] => {
    return raw
        .map((s) => ({
            body: String(s.body || '').trim(),
            acceptAnyReply: Boolean(s.acceptAnyReply),
            validTokens: Array.isArray(s.validTokens)
                ? s.validTokens.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean)
                : [],
            invalidReplyBody: String(s.invalidReplyBody || '').trim()
        }))
        .filter((s) => s.body.length > 0);
};

const replyMatchesGate = (step: ReplyFlowStepDef, bodyText: string): boolean => {
    const t = String(bodyText || '').trim();
    if (!t) return false;
    if (step.acceptAnyReply) return true;
    const norm = t.toLowerCase();
    const first = norm.split(/\s+/)[0] || '';
    const tokens = step.validTokens || [];
    if (tokens.length === 0) return true;
    return tokens.some((tok) => tok === norm || tok === first);
};

const enqueueReplyFlowOutbound = async (item: QueueItem) => {
    messageQueue.push(item);
    const conn = connectionsInfo.find((c) => c.id === item.connectionId);
    if (conn) conn.queueSize = (conn.queueSize || 0) + 1;
    emitConnectionsUpdate();
    await persistQueue();
    if (!isProcessingQueue) {
        processQueue();
    }
};

const handleReplyFlowIncoming = (connectionId: string, phoneDigits: string, bodyText: string) => {
    const key = `${connectionId}:${phoneDigits}`;
    const session = replyFlowSessions.get(key);
    if (!session) return;
    const def = replyFlowDefs.get(session.campaignId);
    if (!def?.steps?.length) {
        replyFlowSessions.delete(key);
        adjustReplyFlowSessionCount(session.campaignId, -1);
        maybeClearReplyFlowDef(session.campaignId);
        return;
    }
    if (pausedCampaigns.has(session.campaignId)) return;

    const steps = def.steps;
    const awaiting = session.awaitingAfterStep;

    if (awaiting >= steps.length - 1) {
        const gate = steps[steps.length - 1];
        if (!replyMatchesGate(gate, bodyText) && gate.invalidReplyBody) {
            const inv = applyMessageVars(gate.invalidReplyBody, phoneDigits, session.vars);
            void enqueueReplyFlowOutbound({
                to: session.toRaw,
                message: inv,
                connectionId,
                status: 'PENDING',
                queueCampaignId: session.campaignId
            });
            return;
        }
        replyFlowSessions.delete(key);
        adjustReplyFlowSessionCount(session.campaignId, -1);
        maybeClearReplyFlowDef(session.campaignId);
        return;
    }

    const gateStep = steps[awaiting];
    if (!replyMatchesGate(gateStep, bodyText)) {
        if (gateStep.invalidReplyBody) {
            const inv = applyMessageVars(gateStep.invalidReplyBody, phoneDigits, session.vars);
            void enqueueReplyFlowOutbound({
                to: session.toRaw,
                message: inv,
                connectionId,
                status: 'PENDING',
                queueCampaignId: session.campaignId
            });
        }
        return;
    }

    const nextIdx = awaiting + 1;
    if (nextIdx >= steps.length) {
        replyFlowSessions.delete(key);
        adjustReplyFlowSessionCount(session.campaignId, -1);
        maybeClearReplyFlowDef(session.campaignId);
        return;
    }

    const nextBody = applyMessageVars(steps[nextIdx].body, phoneDigits, session.vars);
    void enqueueReplyFlowOutbound({
        to: session.toRaw,
        message: nextBody,
        connectionId,
        status: 'PENDING',
        queueCampaignId: session.campaignId,
        replyFlowAfterSend: { phoneDigits, newAwaitingAfterStep: nextIdx }
    });
};

/** Rodízio ponderado (pesos relativos); índices consecutivos percorrem um ciclo de soma(weights). */
function pickWeightedChannel(
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

export const startCampaign = async (
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
        }>;
    },
    ownerUidHint?: string,
    channelWeights?: Record<string, number>
): Promise<boolean> => {
    if (connectionIds.length === 0) return false;

    const sanitizedReplySteps =
        Boolean(replyFlow?.enabled && campaignId && Array.isArray(replyFlow?.steps) && (replyFlow?.steps?.length || 0) >= 2)
            ? sanitizeReplyFlowSteps(replyFlow!.steps!)
            : [];
    const useReplyFlow = sanitizedReplySteps.length >= 2;

    const templates = messageTemplates.map((t) => String(t || '').trim()).filter((t) => t.length > 0);
    if (!useReplyFlow && templates.length === 0) return false;

    if (useReplyFlow && campaignId) {
        replyFlowDefs.set(campaignId, { steps: sanitizedReplySteps });
    }

    const stageCount = useReplyFlow ? sanitizedReplySteps.length : templates.length;

    console.log(
        `Iniciando campanha para ${numbers.length} contatos (até ${connectionIds.length} conexão(ões) solicitada(s)).`
    );

    // PING DE SAÚDE: canais offline/banidos ficam de fora; o disparo continua com os que respondem.
    console.log('[Campaign] 🏥 Verificando saúde dos canais...');
    const activeConnectionIds: string[] = [];
    for (const connId of connectionIds) {
        let isReady = await pingChannel(connId);
        if (!isReady) {
            console.warn(`[Campaign] ⚠️ Canal ${connId} não está pronto. Tentando restart...`);
            emitCampaignLog('WARN', 'Canal não está pronto, executando restart', {
                connectionId: connId
            });

            await reconnectConnection(connId).catch((err) => {
                console.error('[Campaign] Falha no restart:', err);
            });

            await new Promise((r) => setTimeout(r, 10000));

            isReady = await pingChannel(connId);
        }
        if (isReady) {
            activeConnectionIds.push(connId);
        } else {
            console.error(`[Campaign] ❌ Canal ${connId} ficará de fora desta campanha (indisponível após restart).`);
            emitCampaignLog('WARN', `Canal excluído do disparo (indisponível): ${connId}`, {
                connectionId: connId,
                campaignId
            });
            emitToConnectionOwner('campaign-error', connId, {
                error: `Canal indisponível — excluído deste lote: ${connId}`,
                campaignId
            });
        }
    }
    if (activeConnectionIds.length === 0) {
        console.error('[Campaign] ❌ Nenhum canal disponível para iniciar a campanha.');
        emitCampaignLog('ERROR', 'Nenhum canal respondeu após verificação.', {
            campaignId,
            requestedConnectionIds: connectionIds
        });
        return false;
    }
    if (activeConnectionIds.length < connectionIds.length) {
        emitCampaignLog(
            'INFO',
            `Usando ${activeConnectionIds.length} de ${connectionIds.length} canais (demais indisponíveis).`,
            { campaignId }
        );
    }
    console.log(`[Campaign] ✅ ${activeConnectionIds.length} canal(is) ativo(s) para o rodízio desta campanha.`);

    currentCampaign = {
        isRunning: true,
        total: numbers.length * stageCount,
        processed: 0,
        successCount: 0,
        failCount: 0,
        campaignId,
        ownerUid: ownerUidHint || ownerUidFromConnectionId(activeConnectionIds[0]) || undefined,
        lastLoggedProcessed: 0,
        startTime: Date.now()
    };

    if (campaignId) {
        campaignGeoById.set(campaignId, {});
        campaignGeoOwnerById.set(campaignId, currentCampaign.ownerUid);
        emitCampaignGeoNow(campaignId);
    }

    // Ativar heartbeat agressivo (10s) durante campanha
    for (const connId of activeConnectionIds) {
        startHealthCheck(connId, true); // aggressive = true
    }

    emitToOwnerUid('campaign-started', currentCampaign.ownerUid, { total: currentCampaign.total, campaignId });
    void persistUserNotification(String(currentCampaign.ownerUid || ''), {
        title: 'Campanha iniciada',
        body: `A processar até ${currentCampaign.total} envios.`,
        kind: 'info',
        category: 'campaign',
        campaignId
    }).catch(() => {});
    emitCampaignLog('INFO', 'Campanha iniciada', {
        total: currentCampaign.total,
        campaignId: currentCampaign.campaignId,
        connections: activeConnectionIds.length,
        stages: stageCount,
        replyFlow: useReplyFlow
    });

    // Intelligent Load Balancing (baseado em health score)
    const channelScores = activeConnectionIds.map((id) => {
        const conn = connectionsInfo.find(c => c.id === id);
        const metrics = channelQualityMetrics.get(id);
        return {
            connectionId: id,
            healthScore: metrics?.healthScore || 100,
            queueSize: conn?.queueSize || 0,
            successRate: metrics ? (metrics.successCount / Math.max(metrics.totalAttempts, 1)) * 100 : 100
        };
    });

    const recipientVars = buildRecipientVarsMap(recipients);

    const useWeights =
        !useReplyFlow &&
        channelWeights &&
        typeof channelWeights === 'object' &&
        Object.keys(channelWeights).length > 0;

    const outboundPool = useReplyFlow ? undefined : [...activeConnectionIds];

    numbers.forEach((num, index) => {
        const assignedConnectionId = useWeights
            ? pickWeightedChannel(activeConnectionIds, channelWeights, index)
            : advancedFeatures.selectBestChannel(channelScores) ||
              activeConnectionIds[index % activeConnectionIds.length];

        const cleanPhone = normalizePhoneKey(num);
        const vars = recipientVars.get(cleanPhone) || {};

        let addedForNumber = 0;
        if (useReplyFlow) {
            const personalizedMessage = applyMessageVars(sanitizedReplySteps[0].body, cleanPhone, vars);
            messageQueue.push({
                to: num,
                message: personalizedMessage,
                connectionId: assignedConnectionId,
                alternateChannelIds: outboundPool,
                status: 'PENDING',
                queueCampaignId: campaignId,
                replyFlowOpen: campaignId
                    ? { campaignId, phoneDigits: cleanPhone, vars }
                    : undefined
            });
            addedForNumber = 1;
        } else {
            for (const template of templates) {
                const personalizedMessage = applyMessageVars(template, cleanPhone, vars);

                messageQueue.push({
                    to: num,
                    message: personalizedMessage,
                    connectionId: assignedConnectionId,
                    alternateChannelIds: outboundPool,
                    status: 'PENDING',
                    queueCampaignId: campaignId
                });
                addedForNumber++;
            }
        }

        const conn = connectionsInfo.find(c => c.id === assignedConnectionId);
        if (conn) conn.queueSize += addedForNumber;

        // Atualizar score após atribuição
        const scoreIndex = channelScores.findIndex(s => s.connectionId === assignedConnectionId);
        if (scoreIndex >= 0) channelScores[scoreIndex].queueSize += addedForNumber;
    });

    emitConnectionsUpdate();
    await persistQueue(); // Salvar fila no disco
    processQueue();
    return true;
};

const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const item = messageQueue.shift();
        if (!item) break;

        // Incrementa tentativas totais
        item.totalAttempts = (item.totalAttempts || 0) + 1;

        // Se passou de 10 tentativas totais (incluindo após restarts), move para DLQ
        if (item.totalAttempts > 10) {
            await addToDLQ(item, 'Excedido limite de 10 tentativas');
            emitCampaignLog('ERROR', 'Excedido limite de tentativas (10). Mensagem movida para DLQ.', {
                to: item.to,
                connectionId: item.connectionId,
                totalAttempts: item.totalAttempts
            });
            currentCampaign.failCount++;
            currentCampaign.processed++;
            handleCampaignProgress();
            continue;
        }

        // Circuit Breaker
        if (!checkCircuitBreaker(item.connectionId)) {
            console.warn(`[CircuitBreaker] Canal ${item.connectionId} está ABERTO. Recolocando mensagem na fila...`);
            messageQueue.push(item); // Recoloca no final
            await new Promise(r => setTimeout(r, 10000)); // Aguarda 10s antes de verificar novamente
            continue;
        }

        // Rate limiting - CORREÇÃO: só verificar na primeira tentativa, não nos retries
        if (!item.attempts && !checkRateLimit(item.connectionId)) {
            console.warn(`[RateLimit] Canal ${item.connectionId} excedeu limite de ${RATE_LIMIT_PER_HOUR} msgs/hora. Aguardando...`);
            messageQueue.push(item); // Recoloca no final
            await new Promise(r => setTimeout(r, 30000)); // Aguarda 30s
            continue;
        }

        let readyForSend = await isClientReallyReady(item.connectionId);

        /* Multi-chip campanhas: falha rápida com troca de canal antes dos retries pesados. */
        if (
            !readyForSend &&
            item.alternateChannelIds &&
            item.alternateChannelIds.length > 1 &&
            item.queueCampaignId
        ) {
            const pool = item.alternateChannelIds;
            const cur = item.connectionId;
            const ix = Math.max(0, pool.indexOf(cur));
            for (let step = 1; step < pool.length; step++) {
                const altId = pool[(ix + step) % pool.length];
                if (altId === cur) continue;
                // eslint-disable-next-line no-await-in-loop
                if (await isClientReallyReady(altId)) {
                    emitCampaignLog('WARN', 'Canal indisponivel — alternando para outro chip da campanha', {
                        de: cur,
                        para: altId,
                        campaignId: item.queueCampaignId
                    });
                    item.connectionId = altId;
                    readyForSend = true;
                    break;
                }
            }
        }

        if (!readyForSend) {
            readyForSend = await isClientReallyReady(item.connectionId);
        }

        const connInfo = connectionsInfo.find(c => c.id === item.connectionId);
        if (connInfo) connInfo.queueSize = Math.max(0, (connInfo.queueSize || 1) - 1);
        emitConnectionsUpdate();

        const client = clients.get(item.connectionId);
        
        // VERIFICAÇÃO DUPLA: valida se cliente está REALMENTE pronto
        const isReady = readyForSend;
        
        if (!isReady) {
            item.attempts = (item.attempts || 0) + 1;
            item.lastError = 'Conexao indisponivel';
            
            // Auto-restart após 3 tentativas
            if (item.attempts === 3) {
                console.warn(`[Queue] 🔄 Auto-restart do canal ${item.connectionId} (após 3 tentativas)`);
                emitCampaignLog('WARN', 'Executando auto-restart do canal', {
                    connectionId: item.connectionId,
                    attempts: item.attempts
                });
                
                // Restart assíncrono (não bloqueia fila)
                reconnectConnection(item.connectionId).catch(err => {
                    console.error(`[Queue] Falha no auto-restart:`, err);
                });
                
                // Aguarda 15s para dar tempo do restart
                console.log(`[Queue] Aguardando 15s para reconexão...`);
                await new Promise(r => setTimeout(r, 15000));
                
                // Reseta attempts para dar nova chance após restart
                item.attempts = 0;
                messageQueue.push(item);
                continue;
            }
            
            // Se está CONNECTING (reconectando), aguarda 5s antes de retentar
            if (connInfo?.status === ConnectionStatus.CONNECTING) {
                console.log(`[Queue] Canal ${item.connectionId} reconectando. Aguardando 5s... (tentativa ${item.attempts})`);
                await new Promise(r => setTimeout(r, 5000));
            } else {
                console.warn(`[Queue] Conexão ${item.connectionId} indisponível. Tentativa ${item.attempts}.`);
                await new Promise(r => setTimeout(r, 2000)); // Aguarda 2s antes de retry
            }
            
            if (item.attempts >= MAX_QUEUE_ATTEMPTS) {
                emitCampaignLog('ERROR', 'Falha ao enviar: conexao indisponivel (apos retries e restart)', {
                    to: item.to,
                    connectionId: item.connectionId,
                    totalAttempts: item.attempts
                });
                currentCampaign.failCount++;
                currentCampaign.processed++; // Contabiliza como processado (falha)
                handleCampaignProgress();
            } else {
                messageQueue.push(item);
            }
            continue;
        }

        // Re-fetch client after isReady check (safety against race conditions)
        const activeClient = clients.get(item.connectionId);
        if (!activeClient) {
            emitCampaignLog('ERROR', 'Cliente desconectou durante envio', {
                to: item.to,
                connectionId: item.connectionId
            });
            currentCampaign.failCount++;
            currentCampaign.processed++;
            handleCampaignProgress();
            continue;
        }

        try {
            let formattedNum = item.to.replace(/\D/g, '');
            if (!formattedNum.startsWith('55') && formattedNum.length >= 10) formattedNum = '55' + formattedNum;

            // Gera variantes possíveis (com/sem 9º dígito para números BR de celular)
            const variants: string[] = [formattedNum];
            if (formattedNum.startsWith('55') && formattedNum.length === 13) {
                // 55 + DDD(2) + 9 + XXXXXXXX — tenta também sem o 9
                const ddd = formattedNum.substring(2, 4);
                const rest = formattedNum.substring(5); // pula o 9
                variants.push(`55${ddd}${rest}`);
            } else if (formattedNum.startsWith('55') && formattedNum.length === 12) {
                // 55 + DDD(2) + XXXXXXXX — tenta também com o 9 inserido
                const ddd = formattedNum.substring(2, 4);
                const rest = formattedNum.substring(4);
                variants.push(`55${ddd}9${rest}`);
            }

            // Resolve o chatId: cache → getNumberId (com retries) → fallback @{número}@c.us (envio ainda pode resolver LID/JID).
            let targetChatId: string | null = null;
            const cachedId = getCachedNumberId(formattedNum);
            if (cachedId) {
                targetChatId = cachedId;
                console.log(`[ContactCache] ✅ Hit para ${formattedNum} → ${cachedId}`);
            } else {
                targetChatId = await resolveNumberIdsWithRetries(activeClient, variants, 3, 900);
                if (targetChatId) {
                    setCachedNumberId(formattedNum, targetChatId);
                    console.log(`[ContactCache] ✅ Número resolvido após retries → ${targetChatId}`);
                }
                if (!targetChatId) {
                    targetChatId = `${formattedNum}@c.us`;
                    console.warn(
                        `[Queue] getNumberId sem resultado (${variants.join(', ')}) → tentativa de envio direto ${targetChatId}`
                    );
                }
            }

            emitCampaignLog('INFO', 'Tentando envio', {
                to: formattedNum,
                connectionId: item.connectionId,
                targetChatId
            });

            // whatsapp-web.js: envio com resolve JID (LID / getNumberId) + timeout de segurança.
            const sendWithTimeout = async (
                chatId: string,
                msg: string,
                sendOpts?: { skipJidResolve?: boolean }
            ): Promise<{ result: unknown; jidUsed: string }> => {
                try {
                    const raw = String(chatId || '').trim();
                    let jidToUse = raw;
                    if (sendOpts?.skipJidResolve) {
                        if (!raw.includes('@')) {
                            const d = raw.replace(/\D/g, '');
                            jidToUse = d.length >= 10 ? `${d}@c.us` : raw;
                        }
                    } else {
                        jidToUse = await maybeResolveUserJidForSend(activeClient, chatId);
                    }
                    console.log(`[Queue] 📤 Enviando para ${jidToUse}`);
                    const result = await Promise.race([
                        activeClient.sendMessage(jidToUse, msg, CAMPAIGN_TEXT_SEND_OPTS),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Timeout ao enviar (30s)')), 30000)
                        )
                    ]);
                    console.log(`[Queue] ✅ Mensagem enviada`);
                    return { result, jidUsed: jidToUse };
                } catch (err: any) {
                    console.log(`[Queue] ❌ Erro ao enviar: ${err.message}`);
                    throw err;
                }
            };

            /** Envio ao JID literal sem pré-resolve — contorna falhas «No LID for user» quando o servidor ainda pode enviar @c.us. */
            const sendRawJidNoResolve = async (
                jidLiteral: string,
                msg: string
            ): Promise<{ result: unknown; jidUsed: string }> => {
                console.log(`[Queue] 📤 Envio direto sem pré-resolve JID: ${jidLiteral}`);
                const result = await Promise.race([
                    activeClient.sendMessage(jidLiteral, msg, CAMPAIGN_TEXT_SEND_OPTS),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout ao enviar (30s)')), 30000)
                    )
                ]);
                console.log('[Queue] ✅ Mensagem enviada (JID literal)');
                return { result, jidUsed: jidLiteral };
            };

            let sentResult: any = null;
            let finalChatId = targetChatId;
            try {
                const firstSend = await sendWithTimeout(targetChatId, item.message);
                sentResult = firstSend.result;
                finalChatId = firstSend.jidUsed;
            } catch (sendErr: any) {
                const errMsg = String(sendErr?.message || '');
                const hasNoLid = errMsg.includes('No LID for user');
                const hasMarkedUnread = errMsg.includes('markedUnread');
                const hasGetChatCrash = isLikelyGetChatEvaluateError(errMsg);
                const shouldRunSendFallbacks = hasNoLid || hasGetChatCrash || hasMarkedUnread;

                let fallbackOk = false;

                if (shouldRunSendFallbacks) {
                    invalidateCachedNumber(formattedNum);
                    const warnMsg = hasNoLid
                        ? 'Contato sem LID mapeado — tentando variantes e envio direto'
                        : hasMarkedUnread
                          ? 'Instabilidade markedUnread no WA Web — tentando variantes e envio direto'
                          : 'Erro ao resolver conversa no WA Web — tentando variantes e envio direto';
                    emitCampaignLog('WARN', warnMsg, {
                        to: formattedNum,
                        connectionId: item.connectionId
                    });

                    /** 1) @c.us literal primeiro: evita chamar enforceLid/getNumberId quando o primeiro send já rebentou por getChat. */
                    for (const variant of variants) {
                        try {
                            const fb = await sendRawJidNoResolve(`${variant}@c.us`, item.message);
                            sentResult = fb.result;
                            finalChatId = fb.jidUsed;
                            setCachedNumberId(formattedNum, fb.jidUsed);
                            fallbackOk = true;
                            emitCampaignLog('INFO', 'Reenvio ok via @c.us direto (prioritário)', {
                                variant
                            });
                            break;
                        } catch {
                            /* próxima variante */
                        }
                    }

                    /** 2) getNumberId + sendMessage sem segundo pré-resolve — JID já canónico (@lid/@c.us). */
                    if (!fallbackOk) {
                        for (const variant of variants) {
                            const wid = await activeClient.getNumberId(variant).catch(() => null);
                            if (!wid?._serialized) continue;
                            try {
                                const fb = await sendWithTimeout(wid._serialized, item.message, {
                                    skipJidResolve: true
                                });
                                sentResult = fb.result;
                                finalChatId = fb.jidUsed;
                                setCachedNumberId(formattedNum, wid._serialized);
                                fallbackOk = true;
                                emitCampaignLog('INFO', 'Reenvio ok apos novo getNumberId', {
                                    variant,
                                    jid: wid._serialized
                                });
                                break;
                            } catch {
                                /* próxima variante */
                            }
                        }
                    }

                    if (!fallbackOk) {
                        const wc: any = activeClient;
                        for (const variant of variants) {
                            const jid = `${variant}@c.us`;
                            try {
                                const chat = wc.getChatById ? await wc.getChatById(jid).catch(() => null) : null;
                                if (chat && typeof chat.sendMessage === 'function') {
                                    const result = await Promise.race([
                                        chat.sendMessage(item.message, CAMPAIGN_TEXT_SEND_OPTS),
                                        new Promise((_, reject) =>
                                            setTimeout(() => reject(new Error('Timeout ao enviar (30s)')), 30000)
                                        )
                                    ]);
                                    sentResult = result;
                                    finalChatId = jid;
                                    setCachedNumberId(formattedNum, jid);
                                    fallbackOk = true;
                                    emitCampaignLog('INFO', 'Reenvio ok via getChatById.sendMessage', { variant });
                                    break;
                                }
                            } catch {
                                /* próxima */
                            }
                        }
                    }
                }

                if (!fallbackOk) throw sendErr;
            }

            // Garante cache alinhado ao JID que de fato enviou (ex.: @lid após resolve)
            setCachedNumberId(formattedNum, finalChatId);

            // Registrar a mensagem na conversa para rastrear entrega/leitura via message_ack
            try {
                const campaignMsgId = sentResult?.id?.id || sentResult?.id?._serialized || `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const nowTs = Date.now();
                const timeLabel = new Date(nowTs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const conversationId = getConversationKey(item.connectionId, finalChatId);
                const newChatMsg: ChatMessage = {
                    id: campaignMsgId,
                    text: item.message,
                    timestamp: timeLabel,
                    sender: 'me',
                    status: 'sent',
                    type: 'text',
                    fromCampaign: true,
                    campaignId: item.queueCampaignId || currentCampaign?.campaignId,
                    timestampMs: nowTs
                };

                // Envio de campanha reabre a conversa mesmo que o usuario tenha apagado antes.
                allowDeletedConversation(conversationId);
                const existingConv = conversations.find(c => c.id === conversationId);
                if (existingConv) {
                    existingConv.messages = [...existingConv.messages.slice(-(MAX_MESSAGES - 1)), newChatMsg];
                    existingConv.lastMessage = item.message;
                    existingConv.lastMessageTime = timeLabel;
                    existingConv.lastMessageTimestamp = nowTs;
                } else {
                    const contactName = formattedNum;
                    upsertConversation({
                        id: conversationId,
                        contactName,
                        contactPhone: `+${formattedNum}`,
                        profilePicUrl: undefined,
                        connectionId: item.connectionId,
                        unreadCount: 0,
                        lastMessage: item.message,
                        lastMessageTime: timeLabel,
                        lastMessageTimestamp: nowTs,
                        messages: [newChatMsg],
                        tags: ['Campanha']
                    });
                    if (!finalChatId.endsWith('@g.us')) {
                        enqueueConversationPicture(item.connectionId, finalChatId, conversationId);
                    }
                }
                emitConversationsUpdate();
            } catch (trackErr: any) {
                console.log('[Queue] Nao foi possivel registrar mensagem na conversa:', trackErr?.message || trackErr);
            }

            emitCampaignLog('INFO', 'Mensagem enviada', {
                to: formattedNum,
                connectionId: item.connectionId
            });

            if (item.replyFlowOpen && item.replyFlowOpen.campaignId) {
                const sessKey = `${item.connectionId}:${item.replyFlowOpen.phoneDigits}`;
                replyFlowSessions.set(sessKey, {
                    campaignId: item.replyFlowOpen.campaignId,
                    awaitingAfterStep: 0,
                    vars: item.replyFlowOpen.vars,
                    toRaw: item.to
                });
                adjustReplyFlowSessionCount(item.replyFlowOpen.campaignId, 1);
            }
            if (item.replyFlowAfterSend) {
                const sessKey = `${item.connectionId}:${item.replyFlowAfterSend.phoneDigits}`;
                const sess = replyFlowSessions.get(sessKey);
                if (sess) {
                    sess.awaitingAfterStep = item.replyFlowAfterSend.newAwaitingAfterStep;
                }
            }

            metrics.totalSent++;
            // Funil persistente: registra envio (sobrevive a restart e a delecao da campanha)
            try {
                const fnMsgId = normalizeWwebMessageId(sentResult?.id);
                const fnConvId = getConversationKey(item.connectionId, finalChatId);
                if (fnMsgId) trackCampaignSend(fnMsgId, fnConvId, Date.now(), formattedNum, item.queueCampaignId);
            } catch (fnErr: any) {
                console.log('[FunnelStats] Falha ao registrar envio:', fnErr?.message || fnErr);
            }
            if(connInfo) {
                connInfo.messagesSentToday = (connInfo.messagesSentToday || 0) + 1;
                connInfo.totalMessagesSent = (connInfo.totalMessagesSent || 0) + 1;
            }
            currentCampaign.successCount++;
            updateChannelMetrics(item.connectionId, true);
            recordCircuitBreakerSuccess(item.connectionId);
            advancedFeatures.recordFailurePattern(formattedNum, new Date().getHours(), false);

            console.log(`[Queue] Enviado para ${formattedNum} via ${connInfo?.name || item.connectionId}`);

        } catch (error: any) {
            const rawMsg = String(error?.message || '');
            
            // Erro markedUnread: incompatibilidade com versão do WhatsApp Web
            // SIMPLIFICADO: registra falha e continua (sem loop de restarts infinitos)
            if (rawMsg.includes('markedUnread')) {
                emitCampaignLog('ERROR', 'Erro markedUnread (incompatibilidade WhatsApp Web)', {
                    to: item.to,
                    connectionId: item.connectionId,
                    error: 'markedUnread - versao incompativel',
                    sugestion: 'Tente: 1) Reconectar canal via interface, 2) Atualizar whatsapp-web.js'
                });
                currentCampaign.failCount++;
                currentCampaign.processed++;
                handleCampaignProgress();
                continue;
            }

            // No LID / getChat: fallbacks na fila ja rodaram — aviso antes do retry/backoff
            if (rawMsg.includes('No LID for user')) {
                emitCampaignLog('WARN', 'Numero sem LID — fallbacks esgotados, nova tentativa na fila', {
                    to: item.to,
                    connectionId: item.connectionId
                });
            } else if (isLikelyGetChatEvaluateError(rawMsg)) {
                emitCampaignLog('WARN', 'Erro getChat no WhatsApp Web — fallbacks esgotados, nova tentativa na fila', {
                    to: item.to,
                    connectionId: item.connectionId
                });
            }

            // Outro chip da mesma rodada antes de backoff no mesmo numero
            let failOverDone = false;
            if (
                item.alternateChannelIds &&
                item.alternateChannelIds.length > 1 &&
                item.queueCampaignId
            ) {
                const pool = item.alternateChannelIds;
                const fromId = item.connectionId;
                const start = Math.max(0, pool.indexOf(fromId));
                for (let step = 1; step < pool.length; step++) {
                    const altId = pool[(start + step) % pool.length];
                    if (altId === fromId) continue;
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        const okAlt = await isClientReallyReady(altId);
                        if (okAlt) {
                            emitCampaignLog('WARN', 'Falha no envio — tentando pelo proximo canal da campanha', {
                                to: item.to,
                                de: fromId,
                                para: altId,
                                campaignId: item.queueCampaignId
                            });
                            item.connectionId = altId;
                            item.attempts = 0;
                            messageQueue.unshift(item);
                            failOverDone = true;
                            break;
                        }
                    } catch {
                        /* próximo canal */
                    }
                }
            }

            if (failOverDone) {
                continue;
            }

            // Para outros erros, incrementa attempts normalmente
            item.attempts = (item.attempts || 0) + 1;
            item.lastError = formatSendError(error?.message || 'Falha ao enviar');
            console.error(`[Queue] Falha ao enviar para ${item.to}:`, error);

            if (item.attempts >= MAX_QUEUE_ATTEMPTS) {
                emitCampaignLog('ERROR', item.lastError || 'Falha ao enviar mensagem', {
                    to: item.to,
                    connectionId: item.connectionId,
                    error: error?.message || item.lastError
                });
                currentCampaign.failCount++;
                updateChannelMetrics(item.connectionId, false);
                recordCircuitBreakerFailure(item.connectionId);
                advancedFeatures.recordFailurePattern(item.to, new Date().getHours(), true);
            } else {
                // Backoff exponencial antes de retry
                const backoffDelay = calculateBackoffDelay(item.attempts);
                console.log(`[Queue] Retry com backoff: ${backoffDelay}ms (tentativa ${item.attempts})`);
                await new Promise(r => setTimeout(r, backoffDelay));
                messageQueue.push(item);
                continue;
            }
        }

        currentCampaign.processed++;
        handleCampaignProgress();
        // Evita vazamento cross-tenant: metrica global nao e emitida para clientes.

        // Delay dinâmico (usa configurações salvas ou humanizado)
        const humanDelay = dynamicSettings.minDelay + Math.random() * (dynamicSettings.maxDelay - dynamicSettings.minDelay);
        await new Promise(r => setTimeout(r, humanDelay));

        // Verificar pausa de campanha ativa
        const pauseCampaignId = item.queueCampaignId || currentCampaign.campaignId;
        if (pauseCampaignId && pausedCampaigns.has(pauseCampaignId)) {
            console.log(`[Queue] ⏸️ Campanha ${pauseCampaignId} pausada. Aguardando retomada...`);
            while (pausedCampaigns.has(pauseCampaignId)) {
                await new Promise(r => setTimeout(r, 2000));
            }
            console.log(`[Queue] ▶️ Campanha ${pauseCampaignId} retomada.`);
        }
        
        // Verificar se deve fazer pausa (almoço/café)
        if (advancedFeatures.shouldTakeBreak()) {
            console.log('[HumanSimulation] 🍽️ Pausa humanizada (almoço/café)');
            await new Promise(r => setTimeout(r, 60000)); // 1min de pausa
        }
    }

    isProcessingQueue = false;
    currentCampaign.isRunning = false;

    const finishedCampaignId = currentCampaign.campaignId;
    if (campaignGeoEmitTimer) {
        clearTimeout(campaignGeoEmitTimer);
        campaignGeoEmitTimer = null;
        campaignGeoEmitPendingId = null;
    }
    if (finishedCampaignId) emitCampaignGeoNow(finishedCampaignId);

    // Restaurar heartbeat normal (30s) após campanha
    for (const conn of connectionsInfo) {
        if (conn.status === ConnectionStatus.CONNECTED) {
            startHealthCheck(conn.id, false); // aggressive = false
        }
    }
    
    console.log('Campanha finalizada.');
    emitToOwnerUid('campaign-complete', currentCampaign.ownerUid, { 
        successCount: currentCampaign.successCount, 
        failCount: currentCampaign.failCount,
        processed: currentCampaign.processed,
        total: currentCampaign.total,
        campaignId: currentCampaign.campaignId
    });
    const okN = currentCampaign.successCount || 0;
    const failN = currentCampaign.failCount || 0;
    const proc = currentCampaign.processed || 0;
    const tot = currentCampaign.total || 0;
    void persistUserNotification(String(currentCampaign.ownerUid || ''), {
        title: 'Campanha concluída',
        body: `Processados ${proc} de ${tot}. Sucesso: ${okN} · Falhas: ${failN}.`,
        kind: okN > 0 ? 'success' : failN > 0 ? 'warning' : 'info',
        category: 'campaign',
        campaignId: currentCampaign.campaignId
    }).catch(() => {});
    const finishedId = currentCampaign.campaignId;
    const finishedOwner = currentCampaign.ownerUid;
    void import('./campaignScheduleFollowup.js')
        .then((m) => m.onMassCampaignCompleteForSchedule(finishedId, finishedOwner))
        .catch(() => {});
    
    // Análise de auto-scaling
    const avgMessagesPerHour = (currentCampaign.total / ((Date.now() - (currentCampaign as any).startTime) / (1000 * 60 * 60))) || 0;
    const scalingAnalysis = advancedFeatures.analyzeCapacity(
        messageQueue.length,
        connectionsInfo.filter(c => c.status === ConnectionStatus.CONNECTED).length,
        avgMessagesPerHour
    );
    
    if (scalingAnalysis.needsScaling) {
        io.emit('scaling-suggestion', scalingAnalysis);
        const webhookUrl = dynamicSettings.webhookUrl || process.env.WEBHOOK_URL;
        if (webhookUrl) {
            advancedFeatures.sendWebhook('scaling_needed', scalingAnalysis, webhookUrl);
        }
    }
    
    // Webhook de campanha completa
    const webhookUrl = dynamicSettings.webhookUrl || process.env.WEBHOOK_URL;
    if (webhookUrl) {
        advancedFeatures.sendWebhook('campaign_complete', {
            campaignId: currentCampaign.campaignId,
            successCount: currentCampaign.successCount,
            failCount: currentCampaign.failCount,
            total: currentCampaign.total,
            duration: Date.now() - currentCampaign.startTime
        }, webhookUrl);
    }
    
    await clearPersistedQueue(); // Limpar fila salva (campanha completa)
};

/**
 * Apos deploy/restart o motor WhatsApp so fica pronto alguns segundos depois.
 * Se havia fila/campanha salva, `loadQueue` pode ter chamado `processQueue` cedo
 * demais — quando o canal volta a CONNECTED, retomamos aqui.
 */
const resumeQueueIfNeeded = (connectionId: string) => {
    void connectionId;
    const hasWork = messageQueue.length > 0 || !!currentCampaign.isRunning;
    if (!hasWork) return;
    if (isProcessingQueue) return;
    console.log(`[QueueResume] Motor pronto — retomando fila se necessario (pendentes: ${messageQueue.length}, campanhaRunning=${!!currentCampaign.isRunning})`);
    processQueue();
};

const handleCampaignProgress = () => {
    emitToOwnerUid('campaign-progress', currentCampaign.ownerUid, {
        total: currentCampaign.total,
        processed: currentCampaign.processed,
        successCount: currentCampaign.successCount,
        failCount: currentCampaign.failCount,
        campaignId: currentCampaign.campaignId
    });

    const shouldLog = currentCampaign.processed === currentCampaign.total
        || currentCampaign.processed - currentCampaign.lastLoggedProcessed >= 5;
    if (shouldLog) {
        currentCampaign.lastLoggedProcessed = currentCampaign.processed;
        emitCampaignLog('INFO', 'Progresso do disparo', {
            processed: currentCampaign.processed,
            total: currentCampaign.total,
            success: currentCampaign.successCount,
            failed: currentCampaign.failCount
        });
        // Salvar progresso a cada 5 mensagens
        persistQueue().catch(() => {});
    }
};

/**
 * Renomeia uma conexão sem reiniciar a sessão.
 * Persiste no disco e propaga via `connections-update` para todos os sockets do dono.
 */
export const renameConnection = async (id: string, newName: string): Promise<{ ok: boolean; reason?: string }> => {
    if (!String(newName || '').trim()) return { ok: false, reason: 'invalid-name' };
    const sanitized = sanitizeConnectionDisplayName(newName, '');
    if (!sanitized) return { ok: false, reason: 'invalid-name' };
    const conn = connectionsInfo.find((c) => c.id === id);
    if (!conn) return { ok: false, reason: 'not-found' };
    if (conn.name === sanitized) return { ok: true };
    conn.name = sanitized;
    emitConnectionsUpdate();
    persistConnections().catch(() => {});
    console.log(`[renameConnection] ${id} renomeado para "${sanitized}"`);
    return { ok: true };
};

export const deleteConnection = async (id: string) => {
    if (!id) return;
    console.log(`[deleteConnection] Removendo canal ${id}...`);
    try { stopHealthCheck(id); } catch { /* ignore */ }
    const rs = reconnectState.get(id);
    if (rs?.timeout) clearTimeout(rs.timeout);
    reconnectState.delete(id);
    const client = clients.get(id);
    if (client) {
        try {
            await client.logout();
        } catch {
            /* ignore */
        }
        try {
            await client.destroy();
        } catch {
            /* ignore */
        }
        clients.delete(id);
    }
    try { clearCacheForConnection(id); } catch { /* ignore */ }
    try { await removeSessionDir(id); } catch (e: any) {
        console.warn(`[deleteConnection] removeSessionDir falhou para ${id}:`, e?.message || e);
    }
    const before = connectionsInfo.length;
    connectionsInfo = connectionsInfo.filter((c) => c.id !== id);
    conversations = conversations.filter((conv) => conv.connectionId !== id);
    channelQualityMetrics.delete(id);
    emitConnectionsUpdate();
    emitConversationsUpdate();
    persistConnections().catch(() => {});
    if (before === connectionsInfo.length) {
        console.log(`[deleteConnection] ${id} não estava registado (idempotente).`);
    } else {
        console.log(`[deleteConnection] Canal ${id} removido. Total: ${connectionsInfo.length}`);
    }
};

export const sendMessage = async (conversationId: string, text: string) => {
    const [connectionId, ...chatParts] = conversationId.split(':');
    const chatId = chatParts.length > 0 ? chatParts.join(':') : conversationId;
    const client = clients.get(connectionId);
    if (!client) {
        throw new Error(`Cliente nao encontrado para conexao ${connectionId}`);
    }

    let jid = await resolveBestUserJidForSend(client, chatId);
    let sentResult: any = null;
    try {
        sentResult = await client.sendMessage(jid, text);
    } catch (firstErr: unknown) {
        const m = String((firstErr as Error)?.message || '');
        if (!chatId.includes('@g.us') && m.includes('No LID for user')) {
            await new Promise((r) => setTimeout(r, 400));
            jid = await resolveBestUserJidForSend(client, chatId);
            sentResult = await client.sendMessage(jid, text);
        } else {
            throw firstErr;
        }
    }

    // Acao explicita do usuario reabre a conversa caso estivesse apagada.
    allowDeletedConversation(conversationId);

    // Adicionar mensagem ao estado local para aparecer imediatamente
    const effectiveConversationId = getConversationKey(connectionId, jid);
    const nowMs = Date.now();
    const msgId =
        sentResult?.id?.id ||
        sentResult?.id?._serialized ||
        `${nowMs}_${Math.random().toString(36).slice(2, 8)}`;
    const newMsg: ChatMessage = {
        id: msgId,
        text,
        timestamp: new Date(nowMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        sender: 'me',
        status: 'sent',
        type: 'text',
        timestampMs: nowMs
    };
    let conv = conversations.find(c => c.id === effectiveConversationId) || conversations.find(c => c.id === conversationId);
    if (conv) {
        conv.messages = [...conv.messages.slice(-(MAX_MESSAGES - 1)), newMsg];
        conv.lastMessage = text;
        conv.lastMessageTime = newMsg.timestamp;
        conv.lastMessageTimestamp = nowMs;
        if (!conv.connectionId) conv.connectionId = connectionId;
        if (conv.id !== effectiveConversationId) conv.id = effectiveConversationId;
        upsertConversation(conv);
    } else {
        upsertConversation({
            id: effectiveConversationId,
            contactName: chatId.split('@')[0] || 'Contato',
            contactPhone: `+${toPhoneKey(jid)}`,
            profilePicUrl: undefined,
            connectionId,
            unreadCount: 0,
            lastMessage: text,
            lastMessageTime: newMsg.timestamp,
            lastMessageTimestamp: nowMs,
            messages: [newMsg],
            tags: []
        });
    }
    emitConversationsUpdate();
};

const inferChatMessageTypeFromMime = (mimeType: string): ChatMessage['type'] => {
    const mime = String(mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
};

export const sendMedia = async (
    conversationId: string,
    payload: { dataBase64: string; mimeType: string; fileName: string; caption?: string }
) => {
    const [connectionId, ...chatParts] = conversationId.split(':');
    const chatId = chatParts.length > 0 ? chatParts.join(':') : conversationId;
    const client = clients.get(connectionId);
    if (!client) throw new Error(`Cliente nao encontrado para conexao ${connectionId}`);
    if (!payload?.dataBase64 || !payload?.mimeType || !payload?.fileName) {
        throw new Error('Arquivo invalido para envio.');
    }
    const media = new MessageMedia(payload.mimeType, payload.dataBase64, payload.fileName);
    const jid = await maybeResolveUserJidForSend(client, chatId);
    const sent: any = await client.sendMessage(jid, media, { caption: payload.caption || '' });
    allowDeletedConversation(conversationId);
    const nowMs = Date.now();
    const msgId =
        sent?.id?.id ||
        sent?.id?._serialized ||
        `${nowMs}_${Math.random().toString(36).slice(2, 8)}`;
    const msgType = inferChatMessageTypeFromMime(payload.mimeType);
    const localMessage: ChatMessage = {
        id: msgId,
        text: payload.caption || payload.fileName,
        timestamp: new Date(nowMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        sender: 'me',
        status: 'sent',
        type: msgType,
        mediaUrl: `data:${payload.mimeType};base64,${payload.dataBase64}`,
        timestampMs: nowMs
    };
    const effectiveConversationId = getConversationKey(connectionId, jid);
    let conv = conversations.find((c) => c.id === effectiveConversationId) || conversations.find((c) => c.id === conversationId);
    if (conv) {
        conv.messages = [...conv.messages.slice(-(MAX_MESSAGES - 1)), localMessage];
        conv.lastMessage = localMessage.text || `[${msgType.toUpperCase()}]`;
        conv.lastMessageTime = localMessage.timestamp;
        conv.lastMessageTimestamp = nowMs;
        if (conv.id !== effectiveConversationId) conv.id = effectiveConversationId;
        upsertConversation(conv);
    } else {
        upsertConversation({
            id: effectiveConversationId,
            contactName: chatId.split('@')[0] || 'Contato',
            contactPhone: `+${toPhoneKey(jid)}`,
            profilePicUrl: undefined,
            connectionId,
            unreadCount: 0,
            lastMessage: localMessage.text || `[${msgType.toUpperCase()}]`,
            lastMessageTime: localMessage.timestamp,
            lastMessageTimestamp: nowMs,
            messages: [localMessage],
            tags: []
        });
    }
    emitConversationsUpdate();
};

export const sendWarmupMessage = async (connectionId: string, toPhone: string, message: string) => {
    const client = clients.get(connectionId);
    if (!client) {
        recordWarmupFailed(connectionId);
        throw new Error(`Cliente não encontrado: ${connectionId}`);
    }
    const normalizedPhone = toPhone.replace(/\D/g, '');
    const provisional = normalizedPhone.includes('@') ? normalizedPhone : `${normalizedPhone}@c.us`;
    const chatId = await resolveBestUserJidForSend(client, provisional);
    console.log(`[Warmup] Enviando de ${connectionId} para ${chatId}: "${message.substring(0, 30)}..."`);
    try {
        await client.sendMessage(chatId, message);
        console.log(`[Warmup] ✅ Mensagem enviada com sucesso`);
        recordWarmupSent(connectionId, normalizedPhone);
    } catch (err) {
        recordWarmupFailed(connectionId);
        throw err;
    }
};

export const markAsRead = async (conversationId: string) => {
    try {
        // conversationId pode ser "connectionId:phoneNumber" ou apenas o chatId
        const parts = conversationId.split(':');
        const connectionId = parts.length >= 2 ? parts[0] : null;
        const phone = parts.length >= 2 ? parts.slice(1).join(':') : conversationId;
        const client = connectionId ? clients.get(connectionId) : [...clients.values()][0];
        if (!client) return;
        const chatId = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@c.us`;
        const chat = await client.getChatById(chatId).catch(() => null);
        if (chat) await chat.sendSeen().catch(() => {});
    } catch (e) {
        console.error('[markAsRead] Erro:', e);
    }
};

// Carrega historico expandido de uma conversa direto do WhatsApp. Usa `chat.fetchMessages`
// com um limite grande e substitui o array local da conversa, preservando quaisquer
// mensagens locais que nao estejam no retorno (ex: envios recentes em andamento).
// `skipMedia=true` evita downloads pesados — a UI exibe placeholders.
export const loadChatHistory = async (
    conversationId: string,
    limit: number = 500,
    skipMedia: boolean = true
): Promise<{ ok: boolean; total: number; error?: string }> => {
    try {
        const [connectionId, ...chatParts] = conversationId.split(':');
        const chatId = chatParts.length > 0 ? chatParts.join(':') : '';
        const client: any = clients.get(connectionId);
        if (!client) {
            const conv0 = conversations.find((c) => c.id === conversationId);
            return {
                ok: false,
                total: conv0?.messages.length || 0,
                error: 'Canal desconectado.'
            };
        }

        const effectiveLimit = Math.max(50, Math.min(limit, MAX_MESSAGES));
        console.log(`[loadChatHistory] ${conversationId} → fetching ${effectiveLimit} (skipMedia=${skipMedia})`);

        const chat: any = await client.getChatById(chatId).catch(() => null);
        if (!chat) {
            const conv0 = conversations.find((c) => c.id === conversationId);
            return {
                ok: false,
                total: conv0?.messages.length || 0,
                error: 'Chat nao encontrado no cliente.'
            };
        }

        const fetched = await chat.fetchMessages({ limit: effectiveLimit }).catch(() => []);
        // Converte em ordem cronologica (fetchMessages retorna do mais novo ao mais antigo)
        const converted: ChatMessage[] = await Promise.all(
            (fetched as any[])
                .filter((m: any) => !m.isStatus)
                .map((m: any) => toChatMessage(m, { skipMedia }))
        );
        converted.sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));

        let conv = conversations.find((c) => c.id === conversationId);

        // Conversa nao existia em memoria — cria uma entry a partir do chat do WhatsApp
        // para poder manter o fluxo de historico sem jogar um erro na cara do usuario.
        if (!conv) {
            const contactName =
                (chat.name && String(chat.name)) ||
                (chat.contact?.pushname && String(chat.contact.pushname)) ||
                (chat.contact?.name && String(chat.contact.name)) ||
                (chat.id?.user && String(chat.id.user)) ||
                chatId;
            const contactPhone = (chat.id?.user && String(chat.id.user)) || chatId.replace(/\D/g, '');
            const lastMsg = converted[converted.length - 1];
            const newConv: Conversation = {
                id: conversationId,
                contactName,
                contactPhone,
                connectionId,
                unreadCount: typeof chat.unreadCount === 'number' ? chat.unreadCount : 0,
                lastMessage: lastMsg?.text || '',
                lastMessageTime: lastMsg?.timestamp || '',
                lastMessageTimestamp: lastMsg?.timestampMs,
                messages: [],
                tags: []
            };
            // Permitir que conversas da blocklist sejam recriadas quando o usuario
            // explicitamente tenta abrir historico delas.
            allowDeletedConversation(conversationId);
            upsertConversation(newConv);
            conv = conversations.find((c) => c.id === conversationId);
            if (!conv) {
                // upsert bloqueado ou falhou — ainda assim retornamos os dados carregados
                return { ok: true, total: converted.length };
            }
            console.log(`[loadChatHistory] Conversa criada on-the-fly: ${conversationId}`);
        }

        // Merge com mensagens locais (preserva marcacoes fromCampaign/campaignId e mensagens enviadas recentes)
        const byId = new Map<string, ChatMessage>();
        for (const m of converted) byId.set(m.id, m);
        for (const m of conv.messages) {
            const existing = byId.get(m.id);
            if (existing) {
                // preserva marcacoes locais uteis
                if (m.fromCampaign) existing.fromCampaign = m.fromCampaign;
                if (m.campaignId) existing.campaignId = m.campaignId;
                if (m.mediaUrl && !existing.mediaUrl) existing.mediaUrl = m.mediaUrl;
            } else {
                byId.set(m.id, m);
            }
        }
        const merged = Array.from(byId.values()).sort(
            (a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)
        );

        conv.messages = merged.slice(-MAX_MESSAGES);
        emitConversationsUpdate();
        return { ok: true, total: conv.messages.length };
    } catch (e: any) {
        console.error('[loadChatHistory] Erro:', e?.message || e);
        return { ok: false, total: 0, error: e?.message || 'Erro ao carregar historico.' };
    }
};

// Carrega uma midia sob demanda para uma mensagem especifica (usado quando o usuario
// clica em um balao que estava com placeholder). Retorna a URL data: atualizada.
export const loadMessageMedia = async (
    conversationId: string,
    messageId: string
): Promise<{ ok: boolean; mediaUrl?: string; error?: string }> => {
    try {
        const conv = conversations.find((c) => c.id === conversationId);
        if (!conv) return { ok: false, error: 'Conversa nao encontrada.' };
        const msgLocal = conv.messages.find((m) => m.id === messageId);
        if (msgLocal?.mediaUrl) return { ok: true, mediaUrl: msgLocal.mediaUrl };

        const [connectionId, ...chatParts] = conversationId.split(':');
        const chatId = chatParts.length > 0 ? chatParts.join(':') : '';
        const client = clients.get(connectionId);
        if (!client) return { ok: false, error: 'Canal desconectado.' };

        const chat = await client.getChatById(chatId).catch(() => null);
        if (!chat) return { ok: false, error: 'Chat nao encontrado.' };

        // Buscamos ate 500 mensagens e filtramos pelo id — whatsapp-web nao tem `getMessageById`
        const fetched = await chat.fetchMessages({ limit: 500 }).catch(() => []);
        const match = (fetched as any[]).find((m: any) => m.id?.id === messageId);
        if (!match || !match.hasMedia) return { ok: false, error: 'Mensagem nao tem midia ou nao foi encontrada.' };

        const media = await match.downloadMedia().catch(() => null);
        if (!media?.data) return { ok: false, error: 'Falha ao baixar midia.' };
        const mimeType = media.mimetype || 'application/octet-stream';
        const mediaUrl = `data:${mimeType};base64,${media.data}`;
        if (msgLocal) {
            msgLocal.mediaUrl = mediaUrl;
            emitConversationsUpdate();
        }
        return { ok: true, mediaUrl };
    } catch (e: any) {
        console.error('[loadMessageMedia] Erro:', e?.message || e);
        return { ok: false, error: e?.message || 'Erro ao carregar midia.' };
    }
};

// Remove conversas locais do painel (nao apaga no celular, apenas limpa o cache da UI).
// Usado para higienizar conversas criadas pelo sistema (campanhas) ou shells vazias
// provenientes do fallback de sincronizacao via contatos.
export const deleteLocalConversations = (conversationIds: string[]): number => {
    if (!Array.isArray(conversationIds) || conversationIds.length === 0) return 0;
    const idSet = new Set(conversationIds);
    const before = conversations.length;
    conversations = conversations.filter((c) => !idSet.has(c.id));
    const removed = before - conversations.length;

    // Remove da fila de pictures para evitar re-emits.
    conversationIds.forEach((id) => pictureFetchQueue.delete(id));

    // Persiste no blocklist para que os ciclos de sync nao recriem as shells vazias.
    let added = 0;
    conversationIds.forEach((id) => {
        if (typeof id === 'string' && id.length > 0 && !deletedConversationIds.has(id)) {
            deletedConversationIds.add(id);
            added++;
        }
    });
    if (added > 0) scheduleDeletedIdsSave();

    if (removed > 0 || added > 0) {
        console.log(`[deleteLocalConversations] Removidas ${removed} conversas do cache local. Blocklist: +${added} (total ${deletedConversationIds.size}).`);
        emitConversationsUpdate();
    }
    return removed;
};

const updateConnectionState = (id: string, updates: Partial<WhatsAppConnection>) => {
    connectionsInfo = connectionsInfo.map(c => c.id === id ? { ...c, ...updates } : c);
};

const scheduleReconnect = (id: string, name: string, reason: string) => {
    // CORREÇÃO: Não reagendar se já houver um client ativo
    if (clients.has(id)) {
        console.log(`[Reconnect] Cliente ${name} já existe, cancelando reconnect`);
        return;
    }
    
    const state = reconnectState.get(id) || { attempts: 0 };
    if (state.attempts >= MAX_RECONNECT_ATTEMPTS) {
        updateConnectionState(id, {
            status: ConnectionStatus.DISCONNECTED,
            lastActivity: 'Falha ao reconectar',
            qrCode: undefined
        });
        emitConnectionsUpdate();
        reconnectState.delete(id);
        return;
    }

    const nextAttempts = state.attempts + 1;
    // MAIS RÁPIDO: 2s, 4s, 8s, 16s, 30s...
    const delay = Math.min(30000, 2000 * Math.pow(2, nextAttempts - 1));
    if (state.timeout) {
        clearTimeout(state.timeout);
    }

    updateConnectionState(id, {
        status: ConnectionStatus.CONNECTING,
        lastActivity: `Reconectando (${nextAttempts})...`,
        qrCode: undefined
    });
    emitConnectionsUpdate();

    state.timeout = setTimeout(async () => {
        const client = clients.get(id);
        if (client) {
            try { await client.destroy(); } catch (e) {}
            clients.delete(id);
        }
        initializeClient(id, name);
    }, delay);

    reconnectState.set(id, { attempts: nextAttempts, timeout: state.timeout });
    console.log(`[Reconnect] ${name} (${id}) em ${delay}ms. Motivo: ${reason}`);
};

export const reconnectConnection = async (id: string) => {
    const conn = connectionsInfo.find(c => c.id === id);
    if (!conn) return;

    // Reset do contador de auto-retry — acção do utilizador zera tentativas.
    initAutoRetryCount.delete(id);
    // SIMPLIFICADO: Sem backup (estava falhando com EPERM)
    // LIMPAR CACHE ao reiniciar canal
    clearCacheForConnection(id);

    const client = clients.get(id);
    if (client) {
        try { await client.destroy(); } catch (e) {}
        clients.delete(id);
    }

    updateConnectionState(id, {
        status: ConnectionStatus.CONNECTING,
        lastActivity: 'Reconectando...',
        qrCode: undefined
    });
    emitConnectionsUpdate();
    
    initializeClient(id, conn.name);
};

export const forceQr = async (id: string) => {
    const conn = connectionsInfo.find(c => c.id === id);
    if (!conn) return;

    // Reset do contador de auto-retry — força um ciclo limpo.
    initAutoRetryCount.delete(id);
    // SIMPLIFICADO: Sem backup
    // LIMPAR CACHE ao forçar novo QR
    clearCacheForConnection(id);

    const client = clients.get(id);
    if (client) {
        try { await client.logout(); } catch (e) {}
        try { await client.destroy(); } catch (e) {}
        clients.delete(id);
    }

    await removeSessionDir(id);
    updateConnectionState(id, {
        status: ConnectionStatus.CONNECTING,
        lastActivity: 'Forcando novo QR...',
        qrCode: undefined
    });
    emitConnectionsUpdate();
    initializeClient(id, conn.name);
};

// --- EXTRA EXPORTS (compatibilidade com server.ts) ---

export const handleWebhook = (_event: unknown) => {
    // whatsapp-web.js não usa webhooks HTTP — eventos chegam via callbacks do client
};

export const applySettings = (settings: { minDelay?: number; maxDelay?: number; dailyLimit?: number; sleepMode?: boolean; webhookUrl?: string; emailNotif?: boolean }) => {
    if (settings.minDelay !== undefined) dynamicSettings.minDelay = settings.minDelay * 1000;
    if (settings.maxDelay !== undefined) dynamicSettings.maxDelay = settings.maxDelay * 1000;
    if (settings.dailyLimit !== undefined) dynamicSettings.dailyLimit = settings.dailyLimit;
    if (settings.sleepMode !== undefined) dynamicSettings.sleepMode = settings.sleepMode;
    if (settings.webhookUrl !== undefined) dynamicSettings.webhookUrl = settings.webhookUrl;
    if (settings.emailNotif !== undefined) dynamicSettings.emailNotif = settings.emailNotif;
    console.log('[Settings] ✅ Configurações aplicadas:', dynamicSettings);
};

export const pauseCampaign = (campaignId: string) => {
    pausedCampaigns.add(campaignId);
    console.log(`[Campaign] ⏸️ Pausada: ${campaignId}`);
    if (currentCampaign.campaignId === campaignId) {
        emitToOwnerUid('campaign-paused', currentCampaign.ownerUid, { campaignId });
        void persistUserNotification(String(currentCampaign.ownerUid || ''), {
            title: 'Campanha pausada',
            body: `A campanha foi colocada em pausa.`,
            kind: 'info',
            category: 'campaign',
            campaignId
        }).catch(() => {});
    }
};

export const resumeCampaign = (campaignId: string) => {
    pausedCampaigns.delete(campaignId);
    console.log(`[Campaign] ▶️ Retomada: ${campaignId}`);
    if (currentCampaign.campaignId === campaignId) {
        emitToOwnerUid('campaign-resumed', currentCampaign.ownerUid, { campaignId });
        void persistUserNotification(String(currentCampaign.ownerUid || ''), {
            title: 'Campanha retomada',
            body: `O envio da campanha foi retomado.`,
            kind: 'info',
            category: 'campaign',
            campaignId
        }).catch(() => {});
    }
};

export const canControlCampaign = (uid: string, campaignId: string): boolean => {
    if (!uid || !campaignId) return false;
    return currentCampaign.campaignId === campaignId && currentCampaign.ownerUid === uid;
};

export const getConnectionState = (id: string) => {
    return connectionsInfo.find(c => c.id === id) || null;
};
