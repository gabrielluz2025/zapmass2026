import { PROJECT_ROOT } from './bootstrapEnv.js';
import { getMercadoPagoHealthCached, isMercadoPagoAccessTokenConfigured, verifyMercadoPagoAccessTokenLive } from './mercadoPagoAccess.js';

import express, { type Request } from 'express';
import { createServer } from 'http';
import type { IncomingHttpHeaders } from 'http';
import net from 'net';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
// Motor Híbrido ativado (whatsappService / evolutionService)
import * as waService from './whatsappService.js';
import * as evolutionService from './evolutionService.js';
import { getAppVersion } from './version.js';
import { runBackup } from './backup.js';
import { registerSubscriptionWebhooks } from './subscriptionWebhooks.js';
import { registerBillingMercadoPagoRoutes } from './billingMercadoPago.js';
import { registerBillingTrialRoutes } from './billingTrial.js';
import { assertAdminFromBearer, registerAdminAuthRoutes } from './adminAuth.js';
import { registerAdminAppConfigRoutes } from './adminAppConfigRoutes.js';
import { registerAdminSystemAnnouncementRoutes } from './adminSystemAnnouncementRoutes.js';
import { registerAdminOpsRoutes } from './adminOpsRoutes.js';
import { registerAdminConnectionsRoutes } from './adminConnectionsRoutes.js';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getAuth } from 'firebase-admin/auth';
import { filterByConnectionScope, ownsConnectionForTenant as ownsConnectionForUid } from './connectionScopeServer.js';
import { conversationsPayloadForViewer, socketConversationsPayload } from './conversationsEmit.js';
import { resolveConnectionOwnerUid } from './evolutionService.js';
import { ensureAssignmentsLoaded, getWorkspaceMemberUidSet } from './inboxAssignments.js';
import {
  WHATSAPP_AUDIO_MAX_BYTES,
  WHATSAPP_IMAGE_MAX_BYTES,
  WHATSAPP_VIDEO_MAX_BYTES,
  classifyWhatsAppAttachmentKind
} from '../src/utils/whatsappMediaLimits.js';
import {
  evaluateMayCreateWaConnection,
  readUserSubscriptionForLimits,
  isUidTreatedAsServerAdmin
} from './connectionLimits.js';
import {
  getSessionLiveStats,
  getSessionRouterMetrics,
  getWhatsappProcessWorkerCount,
  isSessionBusRemote,
  startSessionControlPlane,
  stopSessionControlPlane,
  submitCreateConnection,
  submitDeleteConnection,
  submitForceQr,
  submitReconnectConnection,
  submitRenameConnection,
  submitRequestPairingCode,
  submitSendMedia,
  submitSendMessage
} from './sessionControlPlane.js';
import {
  fetchConversationPictureViaRedis,
  hydrateFirestoreChatArchiveViaRedis,
  loadChatHistoryViaRedis,
  loadMessageMediaViaRedis
} from './waWorkerRedisRpc.js';
import {
  collectMetrics,
  metricsContentType,
  refreshFirebaseProbeForMetrics,
  setConnectedSessionsGauge,
  updateOpsResourceGauges
} from './observability.js';
import { metricsAccessMiddleware } from './metricsAccess.js';
import { subscriptionEnforceFromEnv, userHasFullAppAccess } from './subscriptionAccess.js';
import { getSystemMetrics } from './systemMetricsShared.js';
import { getChatOpsMetricsSnapshot, recordInboxSyncDuration } from './chatOpsMetrics.js';
import { getEvolutionWebhookQueueMetrics } from './evolutionWebhookQueue.js';
import { startScheduledCampaignRunner } from './scheduledCampaignRunner.js';
import { startOwnerEmitRedisSubscriber } from './redisOwnerEmitBridge.js';
import { persistUserNotification } from './userNotificationsFirestore.js';
import { registerWorkspaceRoutes } from './workspaceRoutes.js';
import { registerPublicInboxSurveyRoutes } from './publicInboxSurveyRoutes.js';
import { registerWorkspaceStaffPasswordRoutes } from './workspaceStaffPasswordRoutes.js';
import { registerVpsAuthRoutes } from './vpsAuthRoutes.js';
import { registerVpsProfileRoutes } from './vpsProfileRoutes.js';
import { registerVpsWorkspaceStaffRoutes } from './vpsWorkspaceStaffRoutes.js';
import { runZapmassMigrations } from './db/migrate.js';
import { resolveAuthPrincipal, getWorkspaceMembersForPrincipal } from './resolveAuth.js';
import { vpsAuthEnabled, vpsAuthRequired } from './auth/authMode.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { registerContactsDataRoutes } from './contactsRoutes.js';
import { registerLeadsGeoRoutes } from './leadsGeoRoutes.js';
import { registerOperatingLocationRoutes } from './operatingLocationRoutes.js';
import { warmupLeadsGeoCache } from './leadsGeoService.js';
import { ensureIbgeMunicipiosIndex } from './ibgeMunicipios.js';
import { registerCampaignsDataRoutes } from './campaignsRoutes.js';
import { registerCampaignLibraryRoutes } from './campaignLibraryRoutes.js';
import { registerPlatformDataRoutes } from './platformRoutes.js';
import { registerProductSuggestionRoutes } from './productSuggestionRoutes.js';
import { registerConnectionsSyncRoutes } from './connectionsSyncRoutes.js';
import { registerSupportBotRoutes } from './supportBotRoutes.js';
import { registerAiAssistantRoutes } from './aiAssistantRoutes.js';
import { registerAssistantRoutes } from './assistantRoutes.js';
import { structuredLog } from './structuredLog.js';
import { incrementTenantUsageMs } from './usageStatsHeartbeat.js';
import { redisPing, redisPingWithFallback } from './redisPing.js';
import { getRedisUrlCandidates, getRedisUrlMisconfigHint, parseRedisHost } from './redisConfig.js';
import { configureTrustProxy } from './trustProxySetup.js';
import { evolutionWebhookLimiter } from './httpRateLimit.js';
import { securityHeadersMiddleware } from './securityHeaders.js';
import { getUploadsDir } from './mediaStorage.js';
import {
    loadTenantSettings,
    saveTenantSettings,
    settingsToClientPayload,
    type TenantSettingsClientPayload,
} from './tenantSettings.js';

const whatsappEngine = () => String(process.env.ZAPMASS_WHATSAPP_ENGINE || 'evolution').toLowerCase();
const useEvolutionChat = () => whatsappEngine() === 'evolution';
const useEvolutionEngine = () => whatsappEngine() === 'evolution';

function notifyCampaignSocketError(
  uid: string,
  error: string,
  campaignId?: string
): void {
  void persistUserNotification(uid, {
    title: 'Campanha não iniciou',
    body: error,
    kind: 'error',
    category: 'campaign',
    campaignId
  }).catch(() => {});
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Capturar erros não tratados para evitar crash silencioso
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException:', err?.message || err, err?.stack?.split('\n')[1] || '');
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[CRASH] unhandledRejection:', msg);
});

const app = express();
app.use(securityHeadersMiddleware);
configureTrustProxy(app);
app.use('/public/uploads', express.static(getUploadsDir()) as any);
const httpServer = createServer(app);
const serverStartedAt = new Date();
// Upload de mídia (send-media) chega via socket em base64. Base64 infla ~33%
// o tamanho do binário, por isso este buffer precisa ser maior que o limite
// do cliente (VITE_CHAT_UPLOAD_LIMIT_MB, padrão 200 MB).
// 320 MB cobre 200 MB reais com folga (200 * 1.33 ≈ 266 MB).
// Para documentos enormes (>500 MB), suba SOCKET_MAX_HTTP_BUFFER_MB e
// VITE_CHAT_UPLOAD_LIMIT_MB no .env — atenção à RAM da VPS.
const socketMaxHttpBufferMb = (() => {
  const raw = Number(process.env.SOCKET_MAX_HTTP_BUFFER_MB ?? 320);
  if (!Number.isFinite(raw)) return 320;
  return Math.max(1, Math.min(2048, Math.round(raw)));
})();
const jsonBodyLimitMb = (() => {
  const raw = Number(process.env.JSON_BODY_LIMIT_MB ?? 25);
  if (!Number.isFinite(raw)) return 25;
  return Math.max(1, Math.min(512, Math.round(raw)));
})();

const approxBytesFromBase64 = (base64: string): number => {
  if (!base64) return 0;
  const cleaned = base64.replace(/\s+/g, '');
  const len = cleaned.length;
  if (len === 0) return 0;
  let padding = 0;
  if (cleaned.endsWith('==')) padding = 2;
  else if (cleaned.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
};

const normalizeCampaignMediaAttachment = (mediaAttachment?: {
  dataBase64?: string;
  mimeType?: string;
  fileName?: string;
  sendMediaAsDocument?: boolean;
}) => {
  if (
    !mediaAttachment ||
    typeof mediaAttachment.dataBase64 !== 'string' ||
    mediaAttachment.dataBase64.length === 0 ||
    typeof mediaAttachment.mimeType !== 'string' ||
    mediaAttachment.mimeType.length === 0
  ) {
    return undefined;
  }

  const kind = classifyWhatsAppAttachmentKind(mediaAttachment.mimeType);
  const bytes = approxBytesFromBase64(mediaAttachment.dataBase64);
  let forceAsDocument = mediaAttachment.sendMediaAsDocument === true;
  if (!forceAsDocument) {
    if (kind === 'image' && bytes > WHATSAPP_IMAGE_MAX_BYTES) forceAsDocument = true;
    else if (kind === 'audio' && bytes > WHATSAPP_AUDIO_MAX_BYTES) forceAsDocument = true;
    else if (kind === 'video' && bytes > WHATSAPP_VIDEO_MAX_BYTES) forceAsDocument = true;
  }

  return {
    dataBase64: mediaAttachment.dataBase64,
    mimeType: mediaAttachment.mimeType,
    fileName: String(mediaAttachment.fileName || 'anexo'),
    ...(forceAsDocument ? { sendMediaAsDocument: true } : {})
  };
};

// Origens extras em producao: lista separada por virgula (URL publica do app, com porta se precisar)
// Ex.: ALLOWED_ORIGINS=http://2.24.210.220:3001,https://app.seudominio.com
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Hosting Firebase ZapMass — lista fechada (sem wildcard). Acrescente URL se criar outro site Firebase do produto. */
const KNOWN_FIREBASE_PANEL_ORIGINS: readonly string[] = [
  'https://zapflow25.web.app',
  'https://zapflow25.firebaseapp.com',
  'https://zapmass25.web.app',
  'https://zapmass25.firebaseapp.com'
];

const parseExtraOrigins = (): string[] =>
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const extraOrigins = parseExtraOrigins();

if (process.env.NODE_ENV === 'production' && extraOrigins.length === 0) {
  console.warn(
    '[CORS] ALLOWED_ORIGINS nao definido. Defina no .env ou no systemd (ex.: URL publica http(s)://IP ou dominio). Sem isso o navegador pode bloquear API e Socket.IO.'
  );
}

/** Hostname do cabecalho Host / X-Forwarded-Host (porta IPv4 removida; IPv6 entre []). */
function hostnameFromHostHeader(raw: string): string {
  const h = raw.split(',')[0].trim();
  if (!h) return '';
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 1 ? h.slice(1, end).toLowerCase() : h.toLowerCase();
  }
  const colon = h.indexOf(':');
  return (colon === -1 ? h : h.slice(0, colon)).toLowerCase();
}

/** Mesmo site que o pedido (ex.: Origin https://zap-mass.com e Host zap-mass.com atras do Nginx). */
function originMatchesRequestHost(origin: string, headers: IncomingHttpHeaders): boolean {
  try {
    const o = new URL(origin);
    const xf = headers['x-forwarded-host'];
    const raw =
      (typeof xf === 'string' ? xf : Array.isArray(xf) ? xf[0] : '') ||
      headers.host ||
      '';
    const reqHost = hostnameFromHostHeader(raw);
    return Boolean(reqHost && o.hostname.toLowerCase() === reqHost);
  } catch {
    return false;
  }
}

/** Domínios padrão do Hosting Firebase (HTTPS). O handshake Socket.IO ainda exige JWT Firebase válido. */
function isFirebaseDefaultHostingOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (h.includes('..')) return false;
    return h.endsWith('.web.app') || h.endsWith('.firebaseapp.com');
  } catch {
    return false;
  }
}

function isOriginAllowed(origin: string | undefined, req: { headers: IncomingHttpHeaders }): boolean {
  if (!origin) return true;
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  if (KNOWN_FIREBASE_PANEL_ORIGINS.some((allowed) => origin === allowed)) return true;
  if (isFirebaseDefaultHostingOrigin(origin)) return true;
  if (extraOrigins.some((allowed) => origin === allowed || origin.startsWith(`${allowed}/`))) return true;
  if (originMatchesRequestHost(origin, req.headers)) return true;
  return false;
}

function corsResolve(
  origin: string | undefined,
  req: Request,
  callback: (err: Error | null, allow?: boolean) => void
) {
  if (isOriginAllowed(origin, req)) {
    callback(null, true);
    return;
  }
  console.warn(`[CORS] Origem bloqueada: ${origin}`);
  // Não passar Error ao callback: o pacote `cors` encaminha para next() e vira 500 em rotas simples (ex.: /api/health).
  callback(null, false);
}

app.use((req, res, next) => {
  cors({
    origin: (origin, callback) => corsResolve(origin, req, callback),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
  })(req, res, next);
});

const io = new Server(httpServer, {
  allowRequest: (req, callback) => {
    try {
      const origin = req.headers.origin;
      const o = typeof origin === 'string' ? origin : undefined;
      const ok = isOriginAllowed(o, req);
      if (!ok) {
        console.warn(`[Socket.IO] Origem bloqueada: ${origin ?? '(none)'}`);
      }
      callback(null, ok);
    } catch (e) {
      console.error('[Socket.IO] allowRequest:', e);
      callback(null, false);
    }
  },
  cors: {
    // Handshake validado em allowRequest; reflect origin para o browser receber ACAO correto.
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['ngrok-skip-browser-warning'],
    credentials: true
  },
  transports: ['websocket', 'polling'], // Garante suporte a ambos
  // Upload de mídia base64 via socket exige buffer maior que o padrão.
  maxHttpBufferSize: socketMaxHttpBufferMb * 1024 * 1024,
  // Heartbeat mais tolerante: separador em fundo / CPU sleep / proxies fecham WS cedo demais.
  pingInterval: 20000,
  pingTimeout: 120000
});

app.use(express.json({ limit: `${jsonBodyLimitMb}mb` }) as any);

registerSubscriptionWebhooks(app);
registerBillingMercadoPagoRoutes(app);
registerBillingTrialRoutes(app);
registerAdminAuthRoutes(app);
registerAdminAppConfigRoutes(app);
registerAdminSystemAnnouncementRoutes(app);
registerAdminOpsRoutes(app);
registerAdminConnectionsRoutes(app);
registerPublicInboxSurveyRoutes(app);
registerWorkspaceRoutes(app);
registerVpsAuthRoutes(app);
registerVpsProfileRoutes(app);
registerContactsDataRoutes(app);
registerLeadsGeoRoutes(app);
registerOperatingLocationRoutes(app);
registerPlatformDataRoutes(app);
registerCampaignsDataRoutes(app);
registerCampaignLibraryRoutes(app);
registerVpsWorkspaceStaffRoutes(app);
registerWorkspaceStaffPasswordRoutes(app);
registerProductSuggestionRoutes(app);
registerConnectionsSyncRoutes(app);
registerSupportBotRoutes(app);
registerAiAssistantRoutes(app);
registerAssistantRoutes(app);

// --- API ROUTES ---
app.get('/api/health', async (_req, res) => {
  const mp = await Promise.race([
    getMercadoPagoHealthCached().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500))
  ]);
  res.json({
    status: 'ok',
    serverTime: new Date(),
    version: getAppVersion(),
    mercadopagoConfigured: mp?.configured ?? false,
    mercadopagoCheckoutAvailable: mp?.valid ?? false,
    mercadopagoMode: mp?.mode ?? null
  });
});

/** Verifica Redis rapidamente (sem auth). Usado pelo frontend antes de iniciar disparo. */
app.get('/api/health/redis', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl && getRedisUrlCandidates().length === 0) {
    return res.status(503).json({ ok: false, configured: false, error: 'REDIS_URL não configurado.' });
  }
  let ping = await redisPingWithFallback(redisUrl, {
    connectTimeout: 5000,
    commandTimeout: 5000,
    maxRetriesPerRequest: 1,
  });
  if (!ping.ok && ping.error?.includes('Connection is closed')) {
    evolutionService.resetCampaignRedisConnection();
    ping = await redisPingWithFallback(redisUrl, {
      connectTimeout: 5000,
      commandTimeout: 5000,
      maxRetriesPerRequest: 1,
    });
  }
  const effectiveUrl = ping.usedUrl || redisUrl || '';
  const misconfigHint = effectiveUrl ? getRedisUrlMisconfigHint(effectiveUrl) : null;
  const status = ping.ok ? 200 : 503;
  return res.status(status).json({
    ok: ping.ok,
    pingMs: ping.pingMs,
    error: ping.error ?? misconfigHint ?? null,
    host: effectiveUrl ? parseRedisHost(effectiveUrl) : null,
    misconfigHint,
  });
});

/**
 * Saúde unificada do motor de disparo (Redis + fila).
 * Público — usado pelo Centro de Comando e preview de campanha.
 */
const DISPATCH_HEALTH_CACHE_MS = 8_000;
let dispatchHealthCache: { at: number; status: number; body: Record<string, unknown> } | null = null;

async function buildDispatchHealthBody(): Promise<{ status: number; body: Record<string, unknown> }> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl && getRedisUrlCandidates().length === 0) {
    return {
      status: 503,
      body: {
        ok: false,
        ready: false,
        redis: { ok: false, configured: false, error: 'REDIS_URL não configurado.' },
        fixCommand: 'cd /opt/zapmass && docker compose up -d redis zapmass',
      },
    };
  }
  const pingOpts = { connectTimeout: 5000, commandTimeout: 5000, maxRetriesPerRequest: 1 };
  let ping = await redisPingWithFallback(redisUrl, pingOpts);
  if (!ping.ok && ping.error?.includes('Connection is closed')) {
    evolutionService.resetCampaignRedisConnection();
    ping = await redisPingWithFallback(redisUrl, pingOpts);
  }
  const effectiveUrl = ping.usedUrl || redisUrl || '';
  const misconfigHint = effectiveUrl ? getRedisUrlMisconfigHint(effectiveUrl) : null;
  const ok = ping.ok;
  const fixEnvCommand =
    misconfigHint != null
      ? "sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://redis:6379|' /opt/zapmass/.env && cd /opt/zapmass && docker compose up -d zapmass"
      : 'cd /opt/zapmass && docker compose restart redis && sleep 3 && docker compose restart zapmass';
  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      ready: ok,
      redis: {
        ok: ping.ok,
        configured: true,
        pingMs: ping.pingMs,
        error: ping.error ?? misconfigHint ?? null,
        host: effectiveUrl ? parseRedisHost(effectiveUrl) : null,
        misconfigHint,
      },
      fixCommand: fixEnvCommand,
      checkedAt: new Date().toISOString(),
    },
  };
}

app.get('/api/health/dispatch', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const now = Date.now();
  if (
    dispatchHealthCache &&
    dispatchHealthCache.status === 200 &&
    now - dispatchHealthCache.at < DISPATCH_HEALTH_CACHE_MS
  ) {
    return res.status(dispatchHealthCache.status).json(dispatchHealthCache.body);
  }

  const { status, body } = await buildDispatchHealthBody();
  if (status === 200) {
    dispatchHealthCache = { at: now, status, body };
  } else {
    dispatchHealthCache = null;
  }
  return res.status(status).json(body);
});

/** Recria conexão BullMQ e re-testa Redis (chamado pelo front antes de exibir erro ao usuário). */
app.post('/api/health/dispatch/reconnect', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  dispatchHealthCache = null;
  evolutionService.resetCampaignRedisConnection();
  await new Promise((r) => setTimeout(r, 400));
  const { status, body } = await buildDispatchHealthBody();
  if (status === 200) {
    dispatchHealthCache = { at: Date.now(), status, body };
  }
  return res.status(status).json({ ...body, reconnected: true });
});

/** Redis + router de sessão (útil com API + wa-worker). Em produção: redes não privadas ou METRICS_TOKEN. */
app.get('/api/health/deep', metricsAccessMiddleware, async (_req, res) => {
  const redisUrl = process.env.REDIS_URL?.trim();
  let redis: { configured: boolean; ok?: boolean; pingMs?: number; error?: string } = {
    configured: Boolean(redisUrl)
  };
  if (redisUrl) {
    const ping = await redisPing(redisUrl);
    redis = { configured: true, ok: ping.ok, pingMs: ping.pingMs, error: ping.error };
  }
  const sessionRouter = getSessionRouterMetrics();
  const whatsappWorkers = getWhatsappProcessWorkerCount();
  const evolutionWebhookQueue = await getEvolutionWebhookQueueMetrics();
  res.json({
    status: 'ok',
    version: getAppVersion(),
    sessionProcessMode: process.env.SESSION_PROCESS_MODE || 'monolith',
    sessionBusRemote: isSessionBusRemote(),
    redis,
    evolutionWebhookQueue,
    chatOps: getChatOpsMetricsSnapshot(),
    evolutionImage: process.env.EVOLUTION_IMAGE || null,
    wppLidMode: process.env.WPP_LID_MODE ?? null,
    sessionRouter: {
      ...sessionRouter,
      whatsappProcessWorkers: whatsappWorkers
    }
  });
});

// /api/diagnose expoe instancias Evolution, conexoes mapeadas e amostra de
// conversas (telefones). Antes era publico — agora exige Bearer admin.
app.get('/api/diagnose', async (req, res) => {
  const adminInfo = await assertAdminFromBearer(req, res);
  if (!adminInfo) return;
  try {
    const redisUrl = process.env.REDIS_URL?.trim();
    let redisStatus = 'not_configured';
    let redisError: string | undefined;
    if (redisUrl) {
      const ping = await redisPing(redisUrl);
      redisStatus = ping.ok ? 'ok' : 'failed';
      redisError = ping.error;
    }

    const rawInstances = await evolutionService.fetchRawInstances().catch((err: any) => ({ error: err.message }));
    const mappedConnections = evolutionService.getConnections();
    const chatStoreConversations = evolutionService.getConversations();

    res.json({
      status: 'ok',
      timestamp: new Date(),
      env: {
        NODE_ENV: process.env.NODE_ENV,
        SESSION_PROCESS_MODE: process.env.SESSION_PROCESS_MODE || 'monolith',
        ZAPMASS_WHATSAPP_ENGINE: process.env.ZAPMASS_WHATSAPP_ENGINE || 'evolution',
        EVOLUTION_API_URL: process.env.EVOLUTION_API_URL,
        EVOLUTION_API_KEY_PRESENT: Boolean(process.env.EVOLUTION_API_KEY),
        EVOLUTION_API_KEY_PREFIX: process.env.EVOLUTION_API_KEY ? process.env.EVOLUTION_API_KEY.slice(0, 5) + '...' : undefined,
        ZAPMASS_WEBHOOK_URL: process.env.ZAPMASS_WEBHOOK_URL,
        EVOLUTION_WEBHOOK_TOKEN_PRESENT: Boolean(process.env.EVOLUTION_WEBHOOK_TOKEN),
        STRICT_CONNECTION_SCOPE: process.env.ZAPMASS_STRICT_CONNECTION_SCOPE,
      },
      redis: {
        status: redisStatus,
        error: redisError,
      },
      evolution: {
        rawInstances,
        mappedConnections,
      },
      chatStore: {
        totalConversations: chatStoreConversations.length,
        conversationsSample: chatStoreConversations.slice(0, 15).map(c => ({
          id: c.id,
          connectionId: c.connectionId,
          contactPhone: c.contactPhone,
          unreadCount: c.unreadCount,
          lastMessageTime: c.lastMessageTime,
        })),
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/session-router/metrics', metricsAccessMiddleware, (_req, res) => {
  res.json(getSessionRouterMetrics());
});

app.get('/api/session/live-stats', (_req, res) => {
  res.json(getSessionLiveStats());
});

app.get('/metrics', metricsAccessMiddleware, async (_req, res) => {
  res.setHeader('Content-Type', metricsContentType());
  res.send(await collectMetrics());
});

app.get('/api/version', (req, res) => {
  res.json({
    version: getAppVersion(),
    startedAt: serverStartedAt.toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.post('/api/backup', async (req, res) => {
  const backupKey = process.env.BACKUP_API_KEY;
  if (!backupKey) {
    return res.status(403).json({ error: 'Backup API key not configured.' });
  }

  const providedKey = req.header('x-backup-key');
  if (providedKey !== backupKey) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const result = await runBackup('api');
    return res.json(result);
  } catch (error) {
    console.error('Erro ao gerar backup via API:', error);
    return res.status(500).json({ error: 'Backup failed.' });
  }
});

const handleEvolutionWebhookPost = async (req: express.Request, res: express.Response) => {
  try {
    const tok = process.env.EVOLUTION_WEBHOOK_TOKEN?.trim();
    if (tok) {
      const auth = String(req.headers.authorization || '');
      const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      const headerAlt = String(req.headers['x-evolution-webhook-token'] || '');
      const queryToken = String(req.query.token || '');
      if (bearer !== tok && headerAlt !== tok && queryToken !== tok) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    const outcome = await evolutionService.dispatchWebhook(req.body);
    res.status(200).json({
      received: true,
      queued: outcome.queued,
      processedSync: outcome.processedSync ?? false,
    });
  } catch (error) {
    console.error('[webhook/evolution]', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// Rota principal + sufixos quando byEvents=true (Evolution appenda ex.: /qrcode-updated).
const evolutionWebhookPostPaths = [
  '/webhook/evolution',
  '/webhook/evolution/qrcode-updated',
  '/webhook/evolution/connection-update',
  '/webhook/evolution/messages-upsert',
  '/webhook/evolution/messages-update',
  '/webhook/evolution/send-message',
  '/webhook/qrcode-updated',
  '/webhook/connection-update',
  '/webhook/messages-upsert',
  '/webhook/messages-update',
  '/webhook/send-message',
];
for (const webhookPath of evolutionWebhookPostPaths) {
  app.post(webhookPath, evolutionWebhookLimiter, handleEvolutionWebhookPost);
}

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist');
  // index.html nunca com cache agressivo (evita apontar para /assets/index-HASH.js antigo).
  // Ficheiros em /assets/* tem hash no nome: podem ser immutable.
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.replace(/\\/g, '/').endsWith('/index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (filePath.replace(/\\/g, '/').includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }) as any
  );
  app.get('*', (req, res) => {
    // Se o ficheiro estatico nao existir, o catch-all nao deve servir index.html
    // (o browser trataria HTML como JS/CSS → falha silenciosa / tela preta).
    const p = req.path || '';
    // Rotas /api devem estar registadas antes; se cair aqui, e 404 explicito — nunca index.html com 200.
    if (p.startsWith('/api/')) {
      res.status(404).type('application/json').json({ error: 'Not found', path: p });
      return;
    }
    if (p.startsWith('/assets/')) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    if (/\.(js|mjs|css|map|json|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico|wasm)$/i.test(p)) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Métricas para UI + Prometheus (processo / contentor)
const emitSystemAndPromMetrics = () => {
  if (io) io.emit('system-metrics', getSystemMetrics());
  const connected = waService.getConnections().filter((conn) => conn.status === 'CONNECTED').length;
  setConnectedSessionsGauge(connected);
  updateOpsResourceGauges(connected);
  void getEvolutionWebhookQueueMetrics();
};
emitSystemAndPromMetrics();
setInterval(emitSystemAndPromMetrics, 60_000);

/** Stats de concorrência/workers para a UI mostrar "X workers · Y/Z ocupados · N na fila". */
const emitSessionLiveStats = () => {
  if (!io) return;
  try {
    io.emit('session-live-stats', getSessionLiveStats());
  } catch {
    /* broadcast falhou; voltamos a tentar daqui a 60s */
  }
};
emitSessionLiveStats();
setInterval(emitSessionLiveStats, 60_000);

/** Ping Firebase Auth para gauges / alertas Prometheus (~60s; evita martelar a API Google). */
void refreshFirebaseProbeForMetrics();
setInterval(() => {
  void refreshFirebaseProbeForMetrics();
}, 60_000);

/**
 * Cada clique dispara `create-connection`; com `await` na leitura do Firestore, varias
 * invocacoes em paralelo veem o mesmo count (ex.: 0) antes de qualquer `push` — o teto
 * nunca e aplicado. Enfileiramos por uid para a contagem e o create serem atomicos.
 */
const createConnectionTailByKey = new Map<string, Promise<unknown>>();

function enqueuePerKey(key: string, run: () => Promise<void>): void {
  const next = (createConnectionTailByKey.get(key) ?? Promise.resolve())
    .then(() => run())
    .catch((e) => console.error('[create-connection] encadeado', e));
  // Antes o Map crescia indefinidamente (1 entrada por uid distinto) e
  // promises encadeadas retinham closures - leak lento em SaaS. Agora
  // limpamos a entrada quando essa promise terminar, se ainda for a tail.
  const tail = next.finally(() => {
    if (createConnectionTailByKey.get(key) === tail) {
      createConnectionTailByKey.delete(key);
    }
  });
  createConnectionTailByKey.set(key, tail);
}

const logEvent = (event: string, payload?: Record<string, unknown>) => {
  const timestamp = new Date().toISOString();
  const data = payload ? ` ${JSON.stringify(payload)}` : '';
  console.log(`[${timestamp}] ${event}${data}`);
  const targetUid = typeof payload?.uid === 'string' ? payload.uid : '';
  if (targetUid && targetUid !== 'anonymous') {
    io.to(`user:${targetUid}`).emit('system-log', { timestamp, event, payload });
    return;
  }
  io.emit('system-log', { timestamp, event, payload });
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const hasVisibleWaWorker = (): boolean => getWhatsappProcessWorkerCount() >= 1;

/**
 * Dá tempo do stream Redis entregar eventos de heartbeat do `wa-worker` (arranque / rede).
 */
const waitForWhatsappProcessWorkerHint = async (): Promise<void> => {
  if (!isSessionBusRemote() || hasVisibleWaWorker()) return;
  const maxWaitMs = Number(process.env.SESSION_WORKER_WAIT_MS || 20000);
  const stepMs = 2000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(stepMs);
    if (hasVisibleWaWorker()) {
      console.log('[session] wa-worker com heartbeat (apos aguardar stream Redis).');
      return;
    }
  }
};

/**
 * Com `SESSION_PROCESS_MODE=api` + Redis, o barramento manda o comando a outro processo. Se
 * nao houver `wa-worker` a consumir o stream, o `submit` fica "no ar" e o QR nunca corre.
 * Fallback: executar no processo desta instancia (contentor `api` tem Chromium no Dockerfile).
 */
const runSessionCommandOrLocal = async (opts: { submit: () => Promise<void>; local: () => Promise<void> }): Promise<void> => {
  await waitForWhatsappProcessWorkerHint();
  if (isSessionBusRemote() && !hasVisibleWaWorker()) {
    console.warn(
      '[session] Nenhum worker visivel; a executar localmente (fallback). Ajuste WA_WORKER_REPLICAS ou use monolith (sem ZAPMASS_API_SESSION_MODE) se nao quiser o Chromium no servico `api`.'
    );
    await opts.local();
    return;
  }
  await opts.submit();
};

/** Com Evolution API, nunca enviar create/QR/reconnect para o wa-worker (wwebjs). */
const runConnectionCommand = async (opts: { submit: () => Promise<void>; local: () => Promise<void> }): Promise<void> => {
  if (useEvolutionEngine()) {
    await opts.local();
    return;
  }
  await runSessionCommandOrLocal(opts);
};

const registerSocketHandlers = () => {
  // waService.init configura o io global (publishOwnerEvent) e as métricas de funil.
  // Já tem lógica interna para não iniciar Puppeteer quando ENGINE=evolution.
  waService.init(io);
  evolutionService.init(io);

  const allowAnonymousSocket = (() => {
    if (process.env.NODE_ENV === 'production') return false;
    const raw = String(process.env.ALLOW_ANONYMOUS_SOCKET || '').toLowerCase();
    return raw === '1' || raw === 'true';
  })();

  io.use(async (socket, next) => {
    try {
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      const principal = token ? await resolveAuthPrincipal(token) : null;
      if (principal) {
        socket.data.authUid = principal.authUid;
        socket.data.uid = principal.tenantUid;
        if (principal.tenantUid !== 'anonymous') {
          try {
            (socket.data as { workspaceMemberUids?: Set<string> }).workspaceMemberUids =
              await getWorkspaceMembersForPrincipal(principal);
          } catch (e) {
            console.warn('[socket] workspaceMemberUids:', (e as Error)?.message || e);
          }
        }
        next();
        return;
      }
      const adminApp = getFirebaseAdmin();
      if (!vpsAuthRequired() && adminApp && token) {
        const decoded = await getAuth(adminApp).verifyIdToken(token);
        const authUid = decoded.uid;
        socket.data.authUid = authUid;
        let tenantUid = authUid;
        try {
          const lk = await adminApp.firestore().collection('userWorkspaceLinks').doc(authUid).get();
          if (lk.exists) {
            const ou = lk.data()?.ownerUid;
            if (typeof ou === 'string' && ou.trim().length > 0) {
              tenantUid = ou.trim();
            }
          }
        } catch (e) {
          console.warn('[socket] userWorkspaceLinks:', (e as Error)?.message || e);
        }
        socket.data.uid = tenantUid;
        if (tenantUid !== 'anonymous') {
          try {
            (socket.data as { workspaceMemberUids?: Set<string> }).workspaceMemberUids =
              await getWorkspaceMemberUidSet(adminApp, tenantUid);
          } catch (e) {
            console.warn('[socket] workspaceMemberUids:', (e as Error)?.message || e);
          }
        }
        next();
        return;
      }
      if (allowAnonymousSocket) {
        socket.data.uid = 'anonymous';
        next();
        return;
      }
      next(new Error('unauthorized'));
    } catch (err) {
      next(new Error('unauthorized'));
    }
  });

  // --- SOCKET.IO EVENTS ---
  io.on('connection', (socket) => {
    const uid = String(socket.data.uid || 'anonymous');
    const authOp = String((socket.data as { authUid?: string }).authUid || uid);
    let lastUiLogKey = '';
    let lastUiLogAt = 0;
    let lastUsageBeatAt = Date.now();
    const workspaceMembers = (socket.data as { workspaceMemberUids?: ReadonlySet<string> })
      .workspaceMemberUids;
    const ownsConnectionId = (connectionId: string) => {
      if (useEvolutionEngine()) {
        return evolutionService.ensureTenantOwnsConnection(uid, connectionId, workspaceMembers);
      }
      const meta = waService.getConnections().find((c) => c.id === connectionId)?.ownerUid;
      return ownsConnectionForUid(uid, connectionId, meta);
    };
    const userLog = (event: string, payload?: Record<string, unknown>) =>
      logEvent(event, { uid, ...(payload || {}) });
    const denyCrossTenant = (action: string, payload?: Record<string, unknown>) => {
      userLog('security:cross-tenant-blocked', { action, ...(payload || {}) });
      structuredLog('warn', 'security.cross_tenant_blocked', {
        action,
        tenantUid: uid,
        authUid: authOp,
        socketId: socket.id,
        ...(payload || {})
      });
      socket.emit('security-warning', { action, error: 'Operacao bloqueada por isolamento de conta.' });
    };
    const canControlActiveCampaign = async (campaignId: string) => {
      const candidateUids = authOp !== uid ? [uid, authOp] : [uid];
      for (const candidateUid of candidateUids) {
        if (
          await evolutionService.canControlCampaign(
            candidateUid,
            campaignId,
            workspaceMembers,
            authOp
          ) ||
          await waService.canControlCampaign(
            candidateUid,
            campaignId,
            workspaceMembers,
            authOp
          )
        ) {
          return true;
        }
      }
      return false;
    };
    const reportSocketAsyncError = (op: string, err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      structuredLog('error', 'socket.async_handler_failed', {
        op,
        tenantUid: uid,
        socketId: socket.id,
        message
      });
      socket.emit('socket-operation-error', { op, error: message });
    };
    // Métricas reais da sessão atual do motor (não zeros).
    const getLiveMetrics = () => {
      try { return evolutionService.getMetrics(); } catch { return { totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0 }; }
    };
    const getWarmupStateForUid = () => {
      const state = evolutionService.getWarmupState();
      const pending = Array.isArray(state?.pending)
        ? state.pending.filter((item: { connectionId?: string }) =>
            ownsConnectionId(item?.connectionId || '')
          )
        : [];
      return { pending, warmedCount: state?.warmedCount ?? 0 };
    };
    if (uid && uid !== 'anonymous') {
      socket.join(`user:${uid}`);
    }
    const requireActiveSubscription = async (): Promise<boolean> => {
      if (!subscriptionEnforceFromEnv()) return true;
      if (!uid || uid === 'anonymous') return true;
      if (await isUidTreatedAsServerAdmin(authOp)) return true;
      const sub = await readUserSubscriptionForLimits(uid);
      if (userHasFullAppAccess(sub, Date.now())) return true;
      socket.emit('subscription-required', {
        message:
          'Plano ativo ou teste valido e necessario. Abra Minha assinatura para assinar o ZapMass Pro e liberar o uso.'
      });
      return false;
    };
    userLog('socket:connected', { socketId: socket.id });

    const emitScopedConnections = () => {
      socket.emit('connections-update', filterByConnectionScope(uid, evolutionService.getConnections()));
    };
    socket.emit('metrics-update', getLiveMetrics());
    void (async () => {
      if (uid && uid !== 'anonymous') {
        await ensureAssignmentsLoaded(uid).catch(() => undefined);
        await evolutionService.ensureConnectionsHydratedForOwner(uid).catch(() => undefined);
        try {
          const tenantSettings = await loadTenantSettings(uid);
          socket.emit('tenant-settings', settingsToClientPayload(tenantSettings));
        } catch {
          /* defaults no cliente */
        }
      }
      emitScopedConnections();
      if (useEvolutionChat() && uid && uid !== 'anonymous') {
        await evolutionService.reemitConversationsForOwner(uid).catch(() => undefined);
      } else {
        socket.emit(
          'conversations-update',
          await socketConversationsPayload(
            uid,
            authOp,
            evolutionService.getConversations(),
            resolveConnectionOwnerUid
          )
        );
      }
    })();
    socket.emit('warmup-update', getWarmupStateForUid());
    socket.emit('system-metrics', getSystemMetrics());
    // Envia funil por usuario autenticado para manter dashboard consistente
    // entre reconexoes/reloads sem vazar dados entre contas.
    const persistedFunnel =
      uid === 'anonymous' ? waService.getFunnelStats() : waService.getFunnelStatsForUid(uid);
    socket.emit('funnel-stats-update', {
      totalSent: Number(persistedFunnel.totalSent) || 0,
      totalDelivered: Number(persistedFunnel.totalDelivered) || 0,
      totalRead: Number(persistedFunnel.totalRead) || 0,
      totalReplied: Number(persistedFunnel.totalReplied) || 0,
      updatedAt: Number(persistedFunnel.updatedAt) || Date.now(),
      clearedAt: persistedFunnel.clearedAt,
      sentByDay:
        persistedFunnel.sentByDay && typeof persistedFunnel.sentByDay === 'object'
          ? { ...persistedFunnel.sentByDay }
          : {},
      deliveredByDay:
        persistedFunnel.deliveredByDay && typeof persistedFunnel.deliveredByDay === 'object'
          ? { ...persistedFunnel.deliveredByDay }
          : {},
      readByDay:
        persistedFunnel.readByDay && typeof persistedFunnel.readByDay === 'object'
          ? { ...persistedFunnel.readByDay }
          : {},
      repliedByDay:
        persistedFunnel.repliedByDay && typeof persistedFunnel.repliedByDay === 'object'
          ? { ...persistedFunnel.repliedByDay }
          : {},
      sentByDayByCampaign:
        persistedFunnel.sentByDayByCampaign && typeof persistedFunnel.sentByDayByCampaign === 'object'
          ? Object.fromEntries(
              Object.entries(persistedFunnel.sentByDayByCampaign).map(([dk, row]) => [dk, { ...row }])
            )
          : {}
    });
    socket.emit('warmup-chip-stats-update', filterByConnectionScope(uid, waService.getWarmupChipStats()));
    waService.hydrateCampaignGeoForSocket(socket);

    // Ping/pong para medir latência real no cliente
    socket.on('ping-latency', (ts: number) => {
      socket.emit('pong-latency', ts);
    });

    /** Carrega próxima página da inbox (cursor = lastMessageTimestamp da última linha). */
    socket.on(
      'request-inbox-page',
      async (
        opts: { cursor?: number | null; limit?: number } | undefined,
        callback?: (page: Awaited<ReturnType<typeof evolutionService.getInboxPageForOwner>>) => void
      ) => {
        if (!uid || uid === 'anonymous') {
          callback?.({
            conversations: [],
            nextCursor: null,
            hasMore: false,
            total: 0,
          });
          return;
        }
        await ensureAssignmentsLoaded(uid).catch(() => undefined);
        const page = useEvolutionChat()
          ? await evolutionService.getInboxPageForOwner(uid, authOp, {
              cursor: opts?.cursor ?? null,
              limit: opts?.limit,
            })
          : await (async () => {
              const { socketInboxPagePayload } = await import('./conversationsEmit.js');
              return socketInboxPagePayload(
                uid,
                authOp,
                waService.getConversations(),
                resolveConnectionOwnerUid,
                { cursor: opts?.cursor ?? null, limit: opts?.limit }
              );
            })();
        socket.emit('inbox-page', page);
        callback?.(page);
      }
    );

    /** Re-sincroniza conversas: `full` = findChats na Evolution; padrão = só reemit RAM (leve). */
    socket.on('request-conversations-sync', (opts?: { full?: boolean }) => {
      void (async () => {
        const syncStarted = Date.now();
        const fullSync = opts?.full === true;
        try {
          if (uid && uid !== 'anonymous') {
            await ensureAssignmentsLoaded(uid).catch(() => undefined);
          }
          if (useEvolutionChat()) {
            if (fullSync && uid && uid !== 'anonymous') {
              await evolutionService.syncConnectionsForOwner(uid).catch(() => undefined);
              return;
            }
            if (fullSync) {
              await evolutionService.syncAllOpenChats().catch(() => undefined);
              return;
            }
            if (uid && uid !== 'anonymous') {
              await evolutionService.reemitConversationsForOwner(uid).catch(() => undefined);
              return;
            }
            socket.emit(
              'conversations-update',
              await socketConversationsPayload(
                uid,
                authOp,
                evolutionService.getConversations(),
                resolveConnectionOwnerUid
              )
            );
            return;
          }
          socket.emit(
            'conversations-update',
            await socketConversationsPayload(uid, authOp, waService.getConversations(), resolveConnectionOwnerUid)
          );
        } finally {
          recordInboxSyncDuration(Date.now() - syncStarted, fullSync);
        }
      })();
    });

    /** Arquivo Firestore → estado da conversa (sem fetch WhatsApp); ao abrir o chat. */
    socket.on(
      'hydrate-firestore-chat-archive',
      async (
        { conversationId, limit }: { conversationId?: string; limit?: number },
        callback?: (resp: { ok: boolean; total: number; error?: string }) => void
      ) => {
        if (!conversationId) {
          callback?.({ ok: false, total: 0, error: 'conversationId ausente.' });
          return;
        }
        if (!ownsConnectionId(conversationId.split(':')[0] || '')) {
          denyCrossTenant('hydrate-firestore-chat-archive', { conversationId });
          callback?.({ ok: false, total: 0, error: 'Conversa nao pertence a esta conta.' });
          return;
        }
        userLog('ui:hydrate-firestore-chat-archive', { conversationId, limit });
        const redisUrl = process.env.REDIS_URL?.trim();
        const useWorkerRpc =
          (process.env.SESSION_PROCESS_MODE || 'monolith') === 'api' && Boolean(redisUrl);
        const cap = Math.min(1500, Math.max(80, Number(limit) || 400));
        const resp = useWorkerRpc
          ? await hydrateFirestoreChatArchiveViaRedis(redisUrl!, conversationId, cap)
          : useEvolutionChat()
            ? await evolutionService.hydrateFirestoreChatArchiveForConversation(conversationId, cap)
            : await waService.hydrateFirestoreChatArchiveForConversation(conversationId, cap);
        callback?.(resp);
      }
    );
    
    socket.on('create-connection', ({ name, proxy }: { name?: string; proxy?: evolutionService.ConnectionProxyConfig }) => {
      const queueKey = uid;
      enqueuePerKey(queueKey, async () => {
        const decision = await evaluateMayCreateWaConnection(uid, evolutionService.getConnections());
        if (decision.ok === false) {
          if (decision.reason === 'subscription-required') {
            socket.emit('subscription-required', {
              message:
                'Plano ativo ou teste valido e necessario. Abra Minha assinatura para assinar o ZapMass Pro e liberar o uso.'
            });
          } else {
            socket.emit('connection-limit-reached', {
              current: decision.current,
              max: decision.max,
              message: decision.message
            });
          }
          return;
        }
        userLog('ui:create-connection', { name });
        const connName = typeof name === 'string' && name.trim() ? name.trim() : 'WhatsApp';
        const owner = uid && uid !== 'anonymous' ? uid : undefined;
        try {
          await runConnectionCommand({
            submit: () => submitCreateConnection(connName, authOp, owner),
            local: async () => {
              await evolutionService.createConnection(connName, proxy, owner);
            }
          });
        } catch (e: any) {
          const message = e?.message || 'Falha ao criar canal WhatsApp.';
          socket.emit('connection-init-failure', { message });
          socket.emit('send-message-error', { error: message });
          return;
        }
        emitScopedConnections();
      });
    });

    socket.on('claim-connection', ({ id }: { id?: string }) => {
      void (async () => {
        const connId = String(id || '').trim();
        if (!connId) {
          socket.emit('socket-operation-error', { op: 'claim-connection', error: 'Canal inválido.' });
          return;
        }
        if (uid === 'anonymous') {
          socket.emit('socket-operation-error', { op: 'claim-connection', error: 'Faça login para vincular o canal.' });
          return;
        }
        const ok = evolutionService.assignConnectionOwner(connId, uid);
        if (!ok) {
          socket.emit('socket-operation-error', {
            op: 'claim-connection',
            error: 'Não foi possível vincular este canal à sua conta (já pertence a outro usuário ou não existe).'
          });
          return;
        }
        emitScopedConnections();
        await evolutionService.syncOpenChatsForOwner(uid).catch(() => undefined);
        socket.emit(
          'conversations-update',
          await socketConversationsPayload(
            uid,
            authOp,
            evolutionService.getConversations(),
            resolveConnectionOwnerUid
          )
        );
      })();
    });

    socket.on('delete-connection', async ({ id }) => {
      if (!ownsConnectionId(id)) {
        denyCrossTenant('delete-connection', { id });
        return;
      }
      userLog('ui:delete-connection', { id });
      try {
        await runConnectionCommand({
          submit: () => submitDeleteConnection(id, authOp),
          local: () => evolutionService.deleteConnection(id)
        });
        socket.emit('connections-update', filterByConnectionScope(uid, evolutionService.getConnections()));
      } catch (e: any) {
        console.error('[delete-connection]', e);
        const message = e?.message || 'Falha ao remover canal';
        socket.emit('socket-operation-error', { op: 'delete-connection', error: message });
      }
    });

    socket.on('reconnect-connection', ({ id }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (!ownsConnectionId(id)) {
            denyCrossTenant('reconnect-connection', { id });
            return;
          }
          userLog('ui:reconnect-connection', { id });
          await runConnectionCommand({
            submit: () => submitReconnectConnection(id, authOp),
            local: () => evolutionService.reconnectConnection(id)
          });
          socket.emit('connections-update', filterByConnectionScope(uid, evolutionService.getConnections()));
        } catch (e) {
          reportSocketAsyncError('reconnect-connection', e);
        }
      })();
    });

    socket.on('set-connection-proxy', ({ id, proxy }: { id?: string; proxy?: evolutionService.ConnectionProxyConfig | null }) => {
      void (async () => {
        try {
          const connId = String(id || '').trim();
          if (!connId) {
            socket.emit('socket-operation-error', { op: 'set-connection-proxy', error: 'Canal inválido.' });
            return;
          }
          if (!ownsConnectionId(connId)) {
            denyCrossTenant('set-connection-proxy', { id: connId });
            return;
          }
          userLog('ui:set-connection-proxy', { id: connId, host: proxy?.host });
          await evolutionService.setConnectionProxy(connId, proxy || null);
          socket.emit('connections-update', filterByConnectionScope(uid, evolutionService.getConnections()));
        } catch (e) {
          reportSocketAsyncError('set-connection-proxy', e);
        }
      })();
    });

    socket.on('rename-connection', ({ id, name }: { id?: string; name?: string }) => {
      void (async () => {
        try {
          const connId = String(id || '').trim();
          const newName = String(name || '').trim();
          if (!connId || !newName) {
            socket.emit('socket-operation-error', { op: 'rename-connection', error: 'Parâmetros inválidos' });
            return;
          }
          if (newName.length > 60) {
            socket.emit('socket-operation-error', { op: 'rename-connection', error: 'Nome muito longo (máx 60).' });
            return;
          }
          if (!ownsConnectionId(connId)) {
            denyCrossTenant('rename-connection', { id: connId });
            return;
          }
          userLog('ui:rename-connection', { id: connId, name: newName });
          if (useEvolutionEngine()) {
            // Evolution API não tem endpoint de rename; persiste localmente e emite update.
            evolutionService.renameConnection(connId, newName);
          } else {
            await runSessionCommandOrLocal({
              submit: () => submitRenameConnection(connId, newName, authOp),
              local: async () => {}
            });
          }
          socket.emit('connections-update', filterByConnectionScope(uid, evolutionService.getConnections()));
        } catch (e) {
          reportSocketAsyncError('rename-connection', e);
        }
      })();
    });

    socket.on('update-connection-settings', ({ id, settings }: { id: string, settings: any }) => {
      void (async () => {
        try {
          const connId = String(id || '').trim();
          if (!connId || !settings) {
            socket.emit('socket-operation-error', { op: 'update-connection-settings', error: 'Parâmetros inválidos.' });
            return;
          }
          if (!ownsConnectionId(connId)) {
            denyCrossTenant('update-connection-settings', { id: connId });
            return;
          }
          userLog('ui:update-connection-settings', { id: connId, settings });
          await evolutionService.updateConnectionSettings(connId, settings);
          socket.emit('connections-update', filterByConnectionScope(uid, evolutionService.getConnections()));
        } catch (e: any) {
          reportSocketAsyncError('update-connection-settings', e);
        }
      })();
    });

    socket.on('force-qr', ({ id }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (!ownsConnectionId(id)) {
            denyCrossTenant('force-qr', { id });
            return;
          }
          userLog('ui:force-qr', { id });
          await runConnectionCommand({
            submit: () => submitForceQr(id, authOp),
            local: async () => { await evolutionService.forceQr(id); }
          });
          socket.emit('connections-update', filterByConnectionScope(uid, evolutionService.getConnections()));
        } catch (e) {
          reportSocketAsyncError('force-qr', e);
        }
      })();
    });

    // Pairing code (8 dígitos) — alternativa ao QR.
    // O cliente envia { id, phone }; validamos posse, sanitizamos telefone,
    // e enviamos ao control plane (ou execução local em monolítico).
    socket.on('request-pairing-code', ({ id, phone }: { id: string; phone: string }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (!ownsConnectionId(id)) {
            denyCrossTenant('request-pairing-code', { id });
            return;
          }
          const digits = String(phone || '').replace(/\D/g, '');
          if (digits.length < 8 || digits.length > 16) {
            socket.emit('pairing-code-failed', {
              connectionId: id,
              message: 'Telefone inválido. Use formato internacional (ex.: 5511999998888).'
            });
            return;
          }
          userLog('ui:request-pairing-code', { id, phone: `${digits.slice(0, 4)}…${digits.slice(-2)}` });
          await runSessionCommandOrLocal({
            submit: () => submitRequestPairingCode(id, digits, authOp),
            local: async () => {
              const r = await waService.requestPairingCode(id, digits);
              if (!r.ok) {
                socket.emit('pairing-code-failed', {
                  connectionId: id,
                  message:
                    r.reason === 'invalid-phone'
                      ? 'Telefone inválido.'
                      : r.reason === 'not-found'
                        ? 'Conexão não encontrada.'
                        : 'Não foi possível obter o código de pareamento. Tente novamente.'
                });
              }
            }
          });
        } catch (e) {
          reportSocketAsyncError('request-pairing-code', e);
        }
      })();
    });

    // Start Campaign: Agora aceita connectionIds (array) para balanceamento
    socket.on(
      'start-campaign',
      async (
        {
          numbers,
          message,
          messageStages,
          replyFlow,
          connectionIds,
          campaignId,
          delaySeconds,
          recipients,
          channelWeights,
          mediaAttachment,
          followUpMediaAttachment,
          stageConfigs,
          skipFrequencyCap
        }: {
          numbers?: string[];
          message?: string;
          messageStages?: string[];
          replyFlow?: {
            enabled?: boolean;
            steps?: Array<{
              body?: string;
              acceptAnyReply?: boolean;
              validTokens?: string[];
              invalidReplyBody?: string;
            }>;
          };
          connectionIds?: string[];
          campaignId?: string;
          delaySeconds?: number;
          recipients?: Array<{ phone: string; vars: Record<string, string> }>;
          channelWeights?: Record<string, number>;
          mediaAttachment?: {
            dataBase64?: string;
            mimeType?: string;
            fileName?: string;
            sendMediaAsDocument?: boolean;
          };
          followUpMediaAttachment?: {
            dataBase64?: string;
            mimeType?: string;
            fileName?: string;
            sendMediaAsDocument?: boolean;
          };
          stageConfigs?: Array<{
            body: string;
            trigger_type: string;
            trigger_condition?: { contains?: string; regex?: string };
            timeout_hours?: number;
            timeout_action?: string;
            next_step_on_match?: number;
            next_step_on_no_match?: number;
          }>;
          skipFrequencyCap?: boolean;
        },
        callback?: (response: { ok: boolean; error?: string }) => void
      ) => {
      if (!connectionIds || connectionIds.length === 0) {
          const err = 'Nenhuma conexao selecionada.';
          callback?.({ ok: false, error: err });
          socket.emit('campaign-error', { error: err, campaignId });
          notifyCampaignSocketError(uid, err, campaignId);
          return;
      }
      if (!numbers || numbers.length === 0) {
        userLog('campaign:error', { campaignId, reason: 'Nenhum numero informado' });
        const err = 'Nenhum número informado para disparo.';
        callback?.({ ok: false, error: err });
        socket.emit('campaign-error', { error: err, campaignId });
        notifyCampaignSocketError(uid, err, campaignId);
        return;
      }

      if (connectionIds.some((id: string) => !ownsConnectionId(id))) {
        denyCrossTenant('start-campaign', { connectionIds });
        const err = 'Conexao invalida para esta conta.';
        callback?.({ ok: false, error: err });
        socket.emit('campaign-error', { error: err, campaignId });
        return;
      }
      if (!(await requireActiveSubscription())) {
        const err = 'Assine o Pro ou renove o periodo para disparar campanhas.';
        callback?.({ ok: false, error: err });
        socket.emit('campaign-error', { error: err, campaignId });
        void persistUserNotification(uid, {
          title: 'Assinatura necessária',
          body: err,
          kind: 'warning',
          category: 'billing'
        }).catch(() => {});
        return;
      }
      userLog('ui:start-campaign', { campaignId, connections: connectionIds.length, total: numbers?.length || 0, delaySeconds });
      try {
        const stages =
          Array.isArray(messageStages) && messageStages.length > 0
            ? messageStages.map((s) => String(s ?? '').trim()).filter((s) => s.length > 0)
            : [String(message ?? '').trim()].filter((s) => s.length > 0);
        const useReplyFlow = Boolean(
          replyFlow?.enabled && Array.isArray(replyFlow.steps) && replyFlow.steps.length > 0
        );
        if (!useReplyFlow && stages.length === 0) {
          const err = 'Nenhuma mensagem definida para a campanha.';
          callback?.({ ok: false, error: err });
          socket.emit('campaign-error', { error: err, campaignId });
          notifyCampaignSocketError(uid, err, campaignId);
          return;
        }
        const sanitizedMedia = normalizeCampaignMediaAttachment(mediaAttachment);
        const sanitizedFollowUpMedia = normalizeCampaignMediaAttachment(followUpMediaAttachment);
        const campaignMedia = sanitizedMedia
          ? {
              base64: sanitizedMedia.dataBase64,
              mimeType: sanitizedMedia.mimeType,
              fileName: sanitizedMedia.fileName,
              ...(sanitizedMedia.sendMediaAsDocument ? { sendMediaAsDocument: true } : {}),
            }
          : undefined;
        const followUpMedia = sanitizedFollowUpMedia
          ? {
              base64: sanitizedFollowUpMedia.dataBase64,
              mimeType: sanitizedFollowUpMedia.mimeType,
              fileName: sanitizedFollowUpMedia.fileName,
              ...(sanitizedFollowUpMedia.sendMediaAsDocument ? { sendMediaAsDocument: true } : {}),
            }
          : undefined;

        // 1. Verificar Redis PRIMEIRO (rápido, 5s) — se estiver fora, não tenta checar chips
        //    porque a Evolution API também usa Redis e ficaria pendurada, causando timeout no cliente.
        const redisUrl = process.env.REDIS_URL?.trim();
        if (redisUrl) {
          const ping = await redisPing(redisUrl);
          if (!ping.ok) {
            const redisErr = 'Redis indisponível na VPS — reinicie o container: docker compose restart redis';
            userLog('campaign:error', { campaignId, reason: redisErr });
            callback?.({ ok: false, error: redisErr });
            socket.emit('campaign-error', { error: redisErr, campaignId });
            notifyCampaignSocketError(uid, redisErr, campaignId);
            return;
          }
        }

        // 2. Com Redis ok, verificar chips com timeout protegido (evita pendurar o handler).
        //    Não chamar callback({ ok: true }) antes — isso remove os listeners de campaign-error.
        //    O campaign-started emitido pelo startCampaign resolve o Promise do frontend.
        void (async () => {
          try {
            // Chip check com timeout de 15s para não travar o handler indefinidamente
            const chipCheckTimeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 15_000));
            const chipCheckResult = async (): Promise<boolean> => {
              if (!evolutionService.anySelectedConnectionsOpenInMemory(connectionIds)) {
                await evolutionService.refreshConnectionsForCampaign(connectionIds).catch(() => undefined);
              }
              return (
                evolutionService.anySelectedConnectionsOpenInMemory(connectionIds) ||
                (await evolutionService.anySelectedConnectionsOpen(connectionIds))
              );
            };
            const hasConnected = await Promise.race([chipCheckResult(), chipCheckTimeout]);
            if (!hasConnected) {
              userLog('campaign:error', { campaignId, reason: 'Nenhum canal conectado', connectionIds });
              const err =
                'Canal offline no servidor. Abra Conexões, reconecte o chip ou atualize a página (F5) e tente de novo.';
              callback?.({ ok: false, error: err });
              socket.emit('campaign-error', { error: err, campaignId });
              notifyCampaignSocketError(uid, err, campaignId);
              return;
            }
            const ok = await evolutionService.startCampaign(
              numbers,
              stages,
              connectionIds,
              campaignId,
              recipients,
              replyFlow,
              uid,
              channelWeights,
              campaignMedia,
              followUpMedia,
              typeof delaySeconds === 'number' && Number.isFinite(delaySeconds) && delaySeconds > 0
                ? delaySeconds
                : undefined,
              Array.isArray(stageConfigs) && stageConfigs.length > 0
                ? (stageConfigs as import('../src/types.js').CampaignStageConfig[])
                : undefined,
              skipFrequencyCap === true
            );
            if (!ok) {
              const errMsg =
                'Não foi possível iniciar: verifique se os canais estão conectados e responsivos.';
              callback?.({ ok: false, error: errMsg });
              socket.emit('campaign-error', { error: errMsg, campaignId });
              notifyCampaignSocketError(uid, errMsg, campaignId);
            }
            // ok === true: 'campaign-started' já foi emitido pelo startCampaign internamente
          } catch (error: any) {
            const messageText = error?.message || 'Falha ao iniciar campanha.';
            userLog('campaign:error', { campaignId, reason: messageText, connectionIds });
            callback?.({ ok: false, error: messageText });
            socket.emit('campaign-error', { error: messageText, campaignId });
            notifyCampaignSocketError(uid, messageText, campaignId);
          }
        })();
      } catch (error: any) {
        const messageText = error?.message || 'Falha ao iniciar campanha.';
        userLog('campaign:error', { campaignId, reason: messageText, connectionIds });
        callback?.({ ok: false, error: messageText });
        socket.emit('campaign-error', { error: messageText, campaignId });
        notifyCampaignSocketError(uid, messageText, campaignId);
      }
    });

    socket.on('send-message', async ({ conversationId, text }) => {
      if (typeof conversationId === 'string' && !ownsConnectionId(conversationId.split(':')[0] || '')) {
        denyCrossTenant('send-message', { conversationId });
        return;
      }
      if (!(await requireActiveSubscription())) return;
      userLog('ui:send-message', { conversationId });
      try {
        if (useEvolutionChat()) {
          await evolutionService.sendMessage(conversationId, text);
        } else {
          await runSessionCommandOrLocal({
            submit: () => submitSendMessage(conversationId, text, authOp),
            local: () => waService.sendMessage(conversationId, text) as any
          });
        }
        logEvent('wa:send-message', { conversationId });
      } catch (error: any) {
        logEvent('wa:send-message-error', { conversationId, error: error?.message || 'Erro desconhecido' });
        socket.emit('send-message-error', { conversationId, error: error?.message || 'Falha ao enviar mensagem' });
      }
    });

    socket.on(
      'send-media',
      async (
        {
          conversationId,
          dataBase64,
          mimeType,
          fileName,
          caption,
          sendMediaAsDocument
        }: {
          conversationId: string;
          dataBase64: string;
          mimeType: string;
          fileName: string;
          caption?: string;
          sendMediaAsDocument?: boolean;
        },
        callback?: (resp: { ok: boolean; error?: string }) => void
      ) => {
        if (typeof conversationId === 'string' && !ownsConnectionId(conversationId.split(':')[0] || '')) {
          denyCrossTenant('send-media', { conversationId });
          callback?.({ ok: false, error: 'Conversa nao pertence a esta conta.' });
          return;
        }
        if (!(await requireActiveSubscription())) {
          callback?.({ ok: false, error: 'Plano ativo necessario para enviar midia.' });
          return;
        }
        // Estimativa do tamanho real do arquivo (base64 ≈ 4/3 do binário).
        const base64Len = typeof dataBase64 === 'string' ? dataBase64.length : 0;
        const approxBytes = Math.floor((base64Len * 3) / 4);
        const approxMb = +(approxBytes / (1024 * 1024)).toFixed(2);
        const startedAt = Date.now();
        logEvent('wa:send-media:start', {
          conversationId,
          fileName,
          mimeType,
          sizeMb: approxMb,
          sendMediaAsDocument: Boolean(sendMediaAsDocument)
        });
        try {
          if (useEvolutionChat()) {
            await evolutionService.sendMedia(conversationId, {
              dataBase64,
              mimeType,
              fileName,
              caption,
              sendMediaAsDocument
            });
          } else {
            await runSessionCommandOrLocal({
              submit: () =>
                submitSendMedia(
                  { conversationId, dataBase64, mimeType, fileName, caption, sendMediaAsDocument },
                  authOp
                ),
              local: () =>
                waService.sendMedia(conversationId, {
                  dataBase64,
                  mimeType,
                  fileName,
                  caption,
                  sendMediaAsDocument
                }) as any
            });
          }
          logEvent('wa:send-media:done', {
            conversationId,
            fileName,
            sizeMb: approxMb,
            elapsedMs: Date.now() - startedAt
          });
          callback?.({ ok: true });
        } catch (error: any) {
          const message = error?.message || 'Falha ao enviar arquivo.';
          logEvent('wa:send-media:error', {
            conversationId,
            fileName,
            sizeMb: approxMb,
            elapsedMs: Date.now() - startedAt,
            error: message
          });
          socket.emit('send-message-error', { conversationId, error: message });
          callback?.({ ok: false, error: message });
        }
      }
    );

    socket.on('ui-log', (data) => {
      const payload = (data || {}) as Record<string, unknown>;
      const action = typeof payload.action === 'string' ? payload.action : 'unknown';
      const view = typeof payload.view === 'string' ? payload.view : '';
      const key = `${action}:${view}`;
      const now = Date.now();

      // Evita spam de logs idênticos em trocas rápidas de tela.
      if (key === lastUiLogKey && now - lastUiLogAt < 2000) {
        return;
      }
      lastUiLogKey = key;
      lastUiLogAt = now;
      userLog('ui:event', payload);
    });

    /** Heartbeat do cliente: aba visível + socket ligado; atribui ao tenant (conta ZapMass). */
    socket.on('usage-heartbeat', () => {
      if (!uid || uid === 'anonymous') return;
      const now = Date.now();
      const raw = now - lastUsageBeatAt;
      lastUsageBeatAt = now;
      if (raw < 8_000) return;
      const delta = Math.min(Math.max(0, raw), 180_000);
      void incrementTenantUsageMs(uid, delta);
    });

    socket.on('fetch-tenant-settings', () => {
      void (async () => {
        try {
          if (!uid || uid === 'anonymous') return;
          const tenantSettings = await loadTenantSettings(uid);
          socket.emit('tenant-settings', settingsToClientPayload(tenantSettings));
        } catch (e) {
          reportSocketAsyncError('fetch-tenant-settings', e);
        }
      })();
    });

    socket.on('update-settings', (settings: TenantSettingsClientPayload) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (!uid || uid === 'anonymous') {
            socket.emit('settings-saved', { ok: false, error: 'Faça login para salvar configurações.' });
            return;
          }
          userLog('ui:update-settings', { ...settings });
          const saved = await saveTenantSettings(uid, settings);
          if (!useEvolutionChat()) {
            await waService.applySettingsForTenant(uid, settings);
          }
          const payload = settingsToClientPayload(saved);
          socket.emit('settings-saved', { ok: true, settings: payload });
          socket.emit('tenant-settings', payload);
        } catch (e) {
          reportSocketAsyncError('update-settings', e);
          socket.emit('settings-saved', {
            ok: false,
            error: (e as Error)?.message || 'Falha ao salvar configurações.'
          });
        }
      })();
    });

    socket.on('pause-campaign', ({ campaignId }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (!(await canControlActiveCampaign(campaignId))) {
            denyCrossTenant('pause-campaign', { campaignId });
            return;
          }
          userLog('ui:pause-campaign', { campaignId });
          evolutionService.pauseCampaign(campaignId, uid);
          // Garante feedback na UI mesmo se publishOwnerEvent falhar (ownerUid ausente em RAM).
          socket.emit('campaign-paused', { campaignId });
        } catch (e) {
          reportSocketAsyncError('pause-campaign', e);
        }
      })();
    });

    socket.on('resume-campaign', ({ campaignId }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (!(await canControlActiveCampaign(campaignId))) {
            denyCrossTenant('resume-campaign', { campaignId });
            return;
          }
          userLog('ui:resume-campaign', { campaignId });
          evolutionService.resumeCampaign(campaignId, uid);
          socket.emit('campaign-resumed', { campaignId });
        } catch (e) {
          reportSocketAsyncError('resume-campaign', e);
        }
      })();
    });

    socket.on('mark-as-read', ({ conversationId }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (typeof conversationId === 'string' && !ownsConnectionId(conversationId.split(':')[0] || '')) {
            denyCrossTenant('mark-as-read', { conversationId });
            return;
          }
          userLog('ui:mark-as-read', { conversationId });
          if (useEvolutionChat()) {
            await evolutionService.markAsRead(conversationId);
          } else {
            await waService.markAsRead(conversationId);
          }
        } catch (e) {
          reportSocketAsyncError('mark-as-read', e);
        }
      })();
    });

    socket.on('fetch-conversation-picture', async ({ conversationId }: { conversationId: string }) => {
      if (!conversationId) return;
      if (!ownsConnectionId(conversationId.split(':')[0] || '')) {
        denyCrossTenant('fetch-conversation-picture', { conversationId });
        return;
      }
      try {
        const redisUrl = process.env.REDIS_URL?.trim();
        const useWorkerRpc =
          !useEvolutionChat() &&
          (process.env.SESSION_PROCESS_MODE || 'monolith') === 'api' &&
          Boolean(redisUrl);
        const pic = useWorkerRpc
          ? await fetchConversationPictureViaRedis(redisUrl!, conversationId)
          : useEvolutionChat()
            ? await evolutionService.fetchConversationPicture(conversationId)
            : await waService.fetchConversationPicture(conversationId);
        socket.emit('conversation-picture', { conversationId, profilePicUrl: pic });
      } catch (e: any) {
        console.error('[fetch-conversation-picture] erro:', e?.message || e);
        // Notifica o cliente para não deixar o spinner de foto preso.
        socket.emit('conversation-picture', { conversationId, profilePicUrl: null });
      }
    });

    socket.on('warmup-marked', async ({ numbers }) => {
      if (!numbers || !Array.isArray(numbers) || numbers.length === 0) return;
      if (!(await requireActiveSubscription())) return;
      userLog('ui:warmup-marked', { count: numbers.length });
        await evolutionService.markWarmupReady(numbers);
      socket.emit('warmup-update', getWarmupStateForUid());
    });

    socket.on('warmup-send', async ({ from, to, message }) => {
      if (!from || !to || !message) return;
      if (!(await requireActiveSubscription())) return;
      if (!ownsConnectionId(from)) {
        denyCrossTenant('warmup-send', { from });
        return;
      }
      userLog('warmup:send', { from, to });
      try {
        await evolutionService.sendMessage(`${from}:${to}`, message);
        waService.recordWarmupExchange(from, to, evolutionService.getConnections());
        socket.emit(
          'warmup-chip-stats-update',
          filterByConnectionScope(uid, waService.getWarmupChipStats())
        );
      } catch (e: any) {
        waService.recordWarmupFailed(from);
        socket.emit(
          'warmup-chip-stats-update',
          filterByConnectionScope(uid, waService.getWarmupChipStats())
        );
        const errMsg = e?.message || String(e);
        console.error(`[Warmup] Erro ao enviar de ${from} para ${to}:`, errMsg);
        socket.emit('warmup-send-error', { from, to, error: errMsg });
      }
    });

    socket.on('test-dispatch', async ({ fromConnectionId, toPhone, message }) => {
      if (!(await requireActiveSubscription())) return;
      if (!ownsConnectionId(fromConnectionId)) {
        denyCrossTenant('test-dispatch', { fromConnectionId });
        return;
      }
      console.log('[TestDispatch] Iniciando teste de disparo:', { fromConnectionId, toPhone, message });
      try {
        await evolutionService.sendMessage(`${fromConnectionId}:${toPhone}`, message);
        socket.emit('test-dispatch-result', { success: true, message: 'Teste enviado com sucesso' });
      } catch (e: any) {
        console.error('[TestDispatch] Erro:', e?.message || e);
        socket.emit('test-dispatch-result', { success: false, error: e?.message || 'Erro desconhecido' });
      }
    });

    socket.on('load-chat-history', async (
      { conversationId, limit, includeMedia }: { conversationId: string; limit?: number; includeMedia?: boolean },
      callback?: (resp: { ok: boolean; total: number; error?: string }) => void
    ) => {
      if (!conversationId) {
        callback?.({ ok: false, total: 0, error: 'conversationId ausente.' });
        return;
      }
      if (!ownsConnectionId(conversationId.split(':')[0] || '')) {
        denyCrossTenant('load-chat-history', { conversationId });
        callback?.({ ok: false, total: 0, error: 'Conversa nao pertence a esta conta.' });
        return;
      }
      userLog('ui:load-chat-history', { conversationId, limit, includeMedia });
      const redisUrl = process.env.REDIS_URL?.trim();
      const useWorkerRpc =
        !useEvolutionChat() &&
        (process.env.SESSION_PROCESS_MODE || 'monolith') === 'api' &&
        Boolean(redisUrl);
      const resp = useWorkerRpc
        ? await loadChatHistoryViaRedis(redisUrl!, conversationId, limit ?? 500, !includeMedia)
        : useEvolutionChat()
          ? await evolutionService.loadChatHistory(conversationId, limit ?? 500, !includeMedia)
          : await waService.loadChatHistory(conversationId, limit ?? 500, !includeMedia);
      callback?.(resp);
    });

    socket.on('load-message-media', async (
      { conversationId, messageId }: { conversationId: string; messageId: string },
      callback?: (resp: { ok: boolean; mediaUrl?: string; error?: string }) => void
    ) => {
      if (!conversationId || !messageId) {
        callback?.({ ok: false, error: 'Parametros ausentes.' });
        return;
      }
      if (!ownsConnectionId(conversationId.split(':')[0] || '')) {
        denyCrossTenant('load-message-media', { conversationId });
        callback?.({ ok: false, error: 'Conversa nao pertence a esta conta.' });
        return;
      }
      const redisUrl = process.env.REDIS_URL?.trim();
      const useWorkerRpc =
        !useEvolutionChat() &&
        (process.env.SESSION_PROCESS_MODE || 'monolith') === 'api' &&
        Boolean(redisUrl);
      const resp = useWorkerRpc
        ? await loadMessageMediaViaRedis(redisUrl!, conversationId, messageId)
        : useEvolutionChat()
          ? await evolutionService.loadMessageMedia(conversationId, messageId)
          : await waService.loadMessageMedia(conversationId, messageId);
      callback?.(resp);
    });

    socket.on('delete-local-conversations', ({ conversationIds }: { conversationIds: string[] }, callback?: (resp: { ok: boolean; removed: number }) => void) => {
      if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
        callback?.({ ok: false, removed: 0 });
        return;
      }
      if (conversationIds.some((id) => !ownsConnectionId(String(id).split(':')[0] || ''))) {
        denyCrossTenant('delete-local-conversations', { count: conversationIds.length });
        callback?.({ ok: false, removed: 0 });
        return;
      }
      userLog('ui:delete-local-conversations', { count: conversationIds.length });
      const removed = useEvolutionChat()
        ? evolutionService.deleteLocalConversations(conversationIds)
        : waService.deleteLocalConversations(conversationIds);
      callback?.({ ok: true, removed });
    });

    socket.on('clear-funnel-stats', () => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          userLog('ui:clear-funnel-stats', { socketId: socket.id });
          waService.clearFunnelStats(uid);
        } catch (e) {
          reportSocketAsyncError('clear-funnel-stats', e);
        }
      })();
    });

    socket.on('clear-warmup-chip-stats', (connectionId?: string) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (connectionId && !ownsConnectionId(connectionId)) {
            denyCrossTenant('clear-warmup-chip-stats', { connectionId });
            return;
          }
          userLog('ui:clear-warmup-chip-stats', { socketId: socket.id, connectionId });
          waService.clearWarmupChipStats(connectionId);
        } catch (e) {
          reportSocketAsyncError('clear-warmup-chip-stats', e);
        }
      })();
    });

    socket.on('start-auto-warmup', ({ connectionIds, intervalMinutes }: { connectionIds?: string[]; intervalMinutes?: number }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          const ids = Array.isArray(connectionIds) ? connectionIds.filter(id => ownsConnectionId(id)) : [];
          if (ids.length === 0) return;
          const interval = Math.max(5, Math.min(120, Number(intervalMinutes) || 10));
          userLog('warmup:auto-start', { connectionIds: ids, intervalMinutes: interval });
          await waService.startAutoWarmup(uid, ids, interval);
          socket.emit('auto-warmup-state', { active: true, connectionIds: ids, intervalMinutes: interval });
        } catch (e) {
          reportSocketAsyncError('start-auto-warmup', e);
        }
      })();
    });

    socket.on('stop-auto-warmup', () => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          userLog('warmup:auto-stop', {});
          waService.stopAutoWarmup(uid);
          socket.emit('auto-warmup-state', { active: false });
        } catch (e) {
          reportSocketAsyncError('stop-auto-warmup', e);
        }
      })();
    });

    socket.on('disconnect', () => {
      userLog('socket:disconnected', { socketId: socket.id });
    });
  });
};

const BASE_PORT = Number(process.env.PORT || 3001);

const isPortOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net
      .createConnection({ port }, () => {
        socket.end();
        resolve(true);
      })
      .on('error', () => resolve(false));
    socket.unref();
  });

const keepProcessAlive = () => {
  setInterval(() => {}, 1 << 30);
};

const startServer = async (port: number): Promise<boolean> => {
  const portOpen = await isPortOpen(port);
  if (portOpen) {
    console.error(`❌ Porta ${port} em uso. Aguardando liberação...`);
    // Tentar esperar a porta liberar (o kill script pode estar rodando)
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const stillOpen = await isPortOpen(port);
      if (!stillOpen) {
        console.log(`✅ Porta ${port} liberada após ${(i + 1) * 2}s`);
        break;
      }
      if (i === 4) {
        console.error(`❌ Porta ${port} ainda em uso. Encerrando.`);
        keepProcessAlive();
        return false;
      }
    }
  }

  // 0.0.0.0: acessível de fora do container e em IPv4 (evita bind só em :: em alguns ambientes).
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${port}`);
    console.log(`📦 Versão ativa: ${getAppVersion()}`);
    void (async () => {
      const ping = await redisPingWithFallback(process.env.REDIS_URL, {
        connectTimeout: 5000,
        commandTimeout: 5000,
        maxRetriesPerRequest: 1,
      });
      if (ping.ok) {
        console.log(`[Redis] fila de disparo OK (${ping.pingMs ?? '?'}ms via ${parseRedisHost(ping.usedUrl || '')})`);
      } else {
        console.error('[Redis] fila de disparo indisponível:', ping.error);
      }
    })().catch((e) => {
      console.error('[Redis] falha no probe de startup:', e);
    });
    void ensureIbgeMunicipiosIndex().catch((e) => {
      console.warn('[ibge] Falha ao carregar municípios:', e instanceof Error ? e.message : e);
    });
    console.log(
      `[WhatsApp] engine=${whatsappEngine()} evolutionUrl=${process.env.EVOLUTION_API_URL || 'http://evolution:8080'} webhook=${process.env.ZAPMASS_WEBHOOK_URL || 'http://api:3001/webhook/evolution'}`
    );
    console.log(
      `[Socket.IO] maxHttpBufferSize=${socketMaxHttpBufferMb} MB (SOCKET_MAX_HTTP_BUFFER_MB; campanhas/chat em base64)`
    );
    const mpOkListen = verifyMercadoPagoAccessTokenLive();
    void mpOkListen.then((health) => {
      if (!health.configured) {
        console.warn(
          `[billing] MERCADOPAGO_ACCESS_TOKEN ausente — checkout MP falhará. Use .env na raiz, env no stack/compose, ou ficheiro em /run/secrets/mercadopago_access_token (volume ./secrets).`
        );
        return;
      }
      if (!health.valid) {
        console.error(
          `[billing] MERCADOPAGO_ACCESS_TOKEN REJEITADO pelo Mercado Pago (${health.error || 'invalid access token'}). Prefixo ${health.prefix ?? '?'}… — regenere em https://www.mercadopago.com.br/developers/panel (Credenciais de produção, Access Token APP_USR-…).`
        );
        return;
      }
      console.log(
        `💳 Mercado Pago: token válido (${health.mode}, user ${health.userId ?? '?'}, prefixo ${health.prefix ?? '?'}…)`
      );
    }).catch((err: unknown) => {
      console.error('[billing] Falha ao validar MERCADOPAGO_ACCESS_TOKEN:', err);
    });
  });

  httpServer.once('error', (err: NodeJS.ErrnoException) => {
    console.error('Falha ao iniciar servidor:', err);
    process.exit(1);
  });

  return true;
};

const bootstrap = async () => {
  if (vpsAuthEnabled() || vpsDataEnabled()) {
    try {
      await runZapmassMigrations();
      console.log('[ZapmassDB] Migrations OK (auth/data VPS)');
    } catch (e) {
      console.error('[ZapmassDB] Falha nas migrations:', (e as Error)?.message || e);
      const authVps = (process.env.ZAPMASS_AUTH_PROVIDER || '').trim().toLowerCase() === 'vps';
      const dataVps = (process.env.ZAPMASS_DATA_PROVIDER || '').trim().toLowerCase() === 'vps';
      if (authVps || dataVps) {
        console.error('[ZapmassDB] Modo vps exige Postgres — verifique ZAPMASS_DATABASE_URL.');
      }
    }
  }

  const started = await startServer(BASE_PORT);
  if (!started) {
    return;
  }

  registerSocketHandlers();
  startScheduledCampaignRunner();
  setTimeout(() => { void warmupLeadsGeoCache(); }, 45_000);
  await startSessionControlPlane();
  if (isSessionBusRemote()) {
    const w = getWhatsappProcessWorkerCount();
    console.log(
      `[session] Modo API + Redis: WhatsApp (Chromium) roda so no \`wa-worker\`. Processos nao-API com heartbeat: ${w}.` +
        (w < 1 ? ' Sem o worker, o QR nao e gerado. `npm run worker:dev` (com REDIS) ou comente api+redis no .env.' : '')
    );
  }

  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl && process.env.SESSION_PROCESS_MODE !== 'worker') {
    startOwnerEmitRedisSubscriber(io, redisUrl, {
      onBridged: (msg) => {
        waService.ingestOwnerBridgedSocketEvent(msg.event, msg.payload);
      }
    });
  }

  const backupOnStart = process.env.BACKUP_ON_START === 'true';
  const backupIntervalMinutes = Number(process.env.BACKUP_INTERVAL_MINUTES || 0);

  if (backupOnStart) {
    runBackup('startup').catch((error) => {
      console.error('Falha ao executar backup inicial:', error);
    });
  }

  if (backupIntervalMinutes > 0) {
    const intervalMs = backupIntervalMinutes * 60 * 1000;
    setInterval(() => {
      runBackup('interval').catch((error) => {
        console.error('Falha ao executar backup agendado:', error);
      });
    }, intervalMs);
  }
};

// --- GRACEFUL SHUTDOWN ---
// Docker manda SIGTERM no `compose up -d --build`. Sem este handler, o Node sai
// abruptamente e o Chromium (Puppeteer / whatsapp-web.js) e morto com SIGKILL
// apos 10s — as sessoes nao sao flushadas e na proxima subida o QR volta.
// Aqui fechamos os clientes em paralelo (com timeout) e so entao sairmos.
let gracefulExiting = false;
const handleGracefulShutdown = (signal: string) => {
  if (gracefulExiting) return;
  gracefulExiting = true;
  console.log(`\n🛑 ${signal} recebido — encerrando com graça...`);

  // Fecha o servidor HTTP para nao aceitar novas conexoes
  try {
    httpServer?.close(() => {
      console.log('📪 HTTP fechado.');
    });
  } catch { /* ignore */ }

  // Timeout duro: se demorar mais de 40s (abaixo do stop_grace_period de 45s),
  // forcamos saida. Isso evita que o Docker mande SIGKILL no meio do flush.
  const hardTimeout = setTimeout(() => {
    console.warn('⏱️ Shutdown demorou demais — saindo forcado.');
    process.exit(0);
  }, 40000);
  hardTimeout.unref();

  waService
    .shutdownAll(signal)
    .catch((e) => console.error('Erro no shutdownAll:', e))
    .finally(() => {
      void stopSessionControlPlane()
        .catch((e) => console.error('Erro no stopSessionControlPlane:', e))
        .finally(() => {
          try { io?.close(); } catch { /* ignore */ }
          clearTimeout(hardTimeout);
          console.log('👋 Bye.');
          process.exit(0);
        });
    });
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGHUP', () => handleGracefulShutdown('SIGHUP'));
// Nao derruba por uncaughtException — loga e segue (o servidor ja tem reconnect
// automatico em varios pontos). Se o erro for irreversivel, o healthcheck
// eventualmente devolve 500 e o compose reinicia o container.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

void bootstrap();

