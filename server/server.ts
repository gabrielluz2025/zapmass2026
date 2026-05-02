import { PROJECT_ROOT } from './bootstrapEnv.js';
import { isMercadoPagoAccessTokenConfigured } from './mercadoPagoAccess.js';

import express, { type Request } from 'express';
import { createServer } from 'http';
import type { IncomingHttpHeaders } from 'http';
import net from 'net';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
// Usando whatsapp-web.js (Evolution API requer PostgreSQL não disponível)
import * as waService from './whatsappService.js';
import { getAppVersion } from './version.js';
import { runBackup } from './backup.js';
import { registerSubscriptionWebhooks } from './subscriptionWebhooks.js';
import { registerBillingMercadoPagoRoutes } from './billingMercadoPago.js';
import { registerBillingInfinitePayRoutes } from './billingInfinitePay.js';
import { registerBillingTrialRoutes } from './billingTrial.js';
import { registerAdminAppConfigRoutes } from './adminAppConfigRoutes.js';
import { registerAdminOpsRoutes } from './adminOpsRoutes.js';
import { registerAdminConnectionsRoutes } from './adminConnectionsRoutes.js';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getAuth } from 'firebase-admin/auth';
import { filterByConnectionScope, ownsConnectionForUid } from '../src/utils/connectionScope.js';
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
import { startScheduledCampaignRunner } from './scheduledCampaignRunner.js';
import { startOwnerEmitRedisSubscriber } from './redisOwnerEmitBridge.js';
import { persistUserNotification } from './userNotificationsFirestore.js';
import { registerWorkspaceRoutes } from './workspaceRoutes.js';
import { registerWorkspaceStaffPasswordRoutes } from './workspaceStaffPasswordRoutes.js';
import { registerProductSuggestionRoutes } from './productSuggestionRoutes.js';
import { structuredLog } from './structuredLog.js';
import { incrementTenantUsageMs } from './usageStatsHeartbeat.js';
import { redisPing } from './redisPing.js';
import { configureTrustProxy } from './trustProxySetup.js';
import { evolutionWebhookLimiter } from './httpRateLimit.js';

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
configureTrustProxy(app);
const httpServer = createServer(app);
const serverStartedAt = new Date();
const socketMaxHttpBufferMb = (() => {
  const raw = Number(process.env.SOCKET_MAX_HTTP_BUFFER_MB ?? 80);
  if (!Number.isFinite(raw)) return 80;
  return Math.max(1, Math.min(512, Math.round(raw)));
})();
const jsonBodyLimitMb = (() => {
  const raw = Number(process.env.JSON_BODY_LIMIT_MB ?? 25);
  if (!Number.isFinite(raw)) return 25;
  return Math.max(1, Math.min(512, Math.round(raw)));
})();

// Origens extras em producao: lista separada por virgula (URL publica do app, com porta se precisar)
// Ex.: ALLOWED_ORIGINS=http://2.24.210.220:3001,https://app.seudominio.com
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
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

function isOriginAllowed(origin: string | undefined, req: { headers: IncomingHttpHeaders }): boolean {
  if (!origin) return true;
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
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
  callback(new Error('Not allowed by CORS'));
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
  // Heartbeat mais tolerante para evitar quedas falsas sob carga/rede instavel.
  pingInterval: 25000,
  pingTimeout: 60000
});

app.use(express.json({ limit: `${jsonBodyLimitMb}mb` }) as any);

registerSubscriptionWebhooks(app);
registerBillingMercadoPagoRoutes(app);
registerBillingInfinitePayRoutes(app);
registerBillingTrialRoutes(app);
registerAdminAppConfigRoutes(app);
registerAdminOpsRoutes(app);
registerAdminConnectionsRoutes(app);
registerWorkspaceRoutes(app);
registerWorkspaceStaffPasswordRoutes(app);
registerProductSuggestionRoutes(app);

// --- API ROUTES ---
app.get('/api/health', (req, res) => {
  const mpOk = isMercadoPagoAccessTokenConfigured();
  res.json({
    status: 'ok',
    serverTime: new Date(),
    version: getAppVersion(),
    mercadopagoConfigured: mpOk
  });
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
  res.json({
    status: 'ok',
    version: getAppVersion(),
    sessionProcessMode: process.env.SESSION_PROCESS_MODE || 'monolith',
    sessionBusRemote: isSessionBusRemote(),
    redis,
    sessionRouter: {
      ...sessionRouter,
      whatsappProcessWorkers: whatsappWorkers
    }
  });
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

// ZapMass usa whatsapp-web.js. Endpoint mantido para compatibilidade (reverse proxies antigos).
// Não processa eventos Evolution — ver `handleWebhook` em whatsappService (no-op).
app.post('/webhook/evolution', evolutionWebhookLimiter, (req, res) => {
  try {
    const tok = process.env.EVOLUTION_WEBHOOK_TOKEN?.trim();
    if (tok) {
      const auth = String(req.headers.authorization || '');
      const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      const headerAlt = String(req.headers['x-evolution-webhook-token'] || '');
      if (bearer !== tok && headerAlt !== tok) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    const ev = (req.body || {}) as { event?: string; instance?: string };
    structuredLog('info', 'webhook.evolution_ignored', {
      event: ev.event,
      instance: ev.instance
    });
    res.status(200).json({ received: true, handled: false, reason: 'evolution-not-integrated' });
  } catch (error) {
    console.error('[webhook/evolution]', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

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
};
emitSystemAndPromMetrics();
setInterval(emitSystemAndPromMetrics, 10000);

/** Stats de concorrência/workers para a UI mostrar "X workers · Y/Z ocupados · N na fila". */
const emitSessionLiveStats = () => {
  if (!io) return;
  try {
    io.emit('session-live-stats', getSessionLiveStats());
  } catch {
    /* broadcast falhou; voltamos a tentar daqui a 10s */
  }
};
emitSessionLiveStats();
setInterval(emitSessionLiveStats, 10000);

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
  createConnectionTailByKey.set(key, next);
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

const registerSocketHandlers = () => {
  waService.init(io);
  const allowAnonymousSocket = (() => {
    if (process.env.NODE_ENV === 'production') return false;
    const raw = String(process.env.ALLOW_ANONYMOUS_SOCKET || '').toLowerCase();
    return raw === '1' || raw === 'true';
  })();

  io.use(async (socket, next) => {
    try {
      const adminApp = getFirebaseAdmin();
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      if (adminApp && token) {
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
    const ownsConnectionId = (connectionId: string) => ownsConnectionForUid(uid, connectionId);
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
    const emptyMetrics = { totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0 };
    const getWarmupStateForUid = () => {
      const state = waService.getWarmupState();
      const pending = Array.isArray(state?.pending)
        ? state.pending.filter((item: { connectionId?: string }) => ownsConnectionId(item?.connectionId || ''))
        : [];
      return { pending, warmedCount: pending.length };
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

    socket.emit('connections-update', filterByConnectionScope(uid, waService.getConnections()));
    socket.emit('metrics-update', emptyMetrics);
    socket.emit('conversations-update', waService.getConversations().filter((c) => ownsConnectionId(c.connectionId)));
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
      clearedAt: persistedFunnel.clearedAt
    });
    socket.emit('warmup-chip-stats-update', filterByConnectionScope(uid, waService.getWarmupChipStats()));
    waService.hydrateCampaignGeoForSocket(socket);

    // Ping/pong para medir latência real no cliente
    socket.on('ping-latency', (ts: number) => {
      socket.emit('pong-latency', ts);
    });
    
    socket.on('create-connection', ({ name }: { name?: string }) => {
      const queueKey = uid;
      enqueuePerKey(queueKey, async () => {
        const decision = await evaluateMayCreateWaConnection(uid, waService.getConnections());
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
        await runSessionCommandOrLocal({
          submit: () => submitCreateConnection(connName, authOp, owner),
          local: async () => {
            await waService.createConnection(connName, owner);
          }
        });
        socket.emit('connections-update', filterByConnectionScope(uid, waService.getConnections()));
      });
    });

    socket.on('delete-connection', async ({ id }) => {
      if (!ownsConnectionId(id)) {
        denyCrossTenant('delete-connection', { id });
        return;
      }
      userLog('ui:delete-connection', { id });
      try {
        await runSessionCommandOrLocal({
          submit: () => submitDeleteConnection(id, authOp),
          local: () => waService.deleteConnection(id)
        });
        socket.emit('connections-update', filterByConnectionScope(uid, waService.getConnections()));
      } catch (e: any) {
        console.error('[delete-connection]', e);
        socket.emit('send-message-error', { error: e?.message || 'Falha ao remover canal' });
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
          await runSessionCommandOrLocal({
            submit: () => submitReconnectConnection(id, authOp),
            local: () => waService.reconnectConnection(id)
          });
        } catch (e) {
          reportSocketAsyncError('reconnect-connection', e);
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
          await runSessionCommandOrLocal({
            submit: () => submitRenameConnection(connId, newName, authOp),
            local: async () => {
              await waService.renameConnection(connId, newName);
            }
          });
          socket.emit('connections-update', filterByConnectionScope(uid, waService.getConnections()));
        } catch (e) {
          reportSocketAsyncError('rename-connection', e);
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
          await runSessionCommandOrLocal({
            submit: () => submitForceQr(id, authOp),
            local: () => waService.forceQr(id)
          });
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
          channelWeights
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
        },
        callback?: (response: { ok: boolean; error?: string }) => void
      ) => {
      if (!connectionIds || connectionIds.length === 0) {
          const err = 'Nenhuma conexao selecionada.';
          callback?.({ ok: false, error: err });
          socket.emit('campaign-error', { error: err });
          notifyCampaignSocketError(uid, err, campaignId);
          return;
      }
      if (!numbers || numbers.length === 0) {
        userLog('campaign:error', { campaignId, reason: 'Nenhum numero informado' });
        const err = 'Nenhum número informado para disparo.';
        callback?.({ ok: false, error: err });
        socket.emit('campaign-error', { error: err });
        notifyCampaignSocketError(uid, err, campaignId);
        return;
      }

      if (connectionIds.some((id: string) => !ownsConnectionId(id))) {
        denyCrossTenant('start-campaign', { connectionIds });
        callback?.({ ok: false, error: 'Conexao invalida para esta conta.' });
        return;
      }
      if (!(await requireActiveSubscription())) {
        const err = 'Assine o Pro ou renove o periodo para disparar campanhas.';
        callback?.({ ok: false, error: err });
        void persistUserNotification(uid, {
          title: 'Assinatura necessária',
          body: err,
          kind: 'warning',
          category: 'billing'
        }).catch(() => {});
        return;
      }
      const connections = filterByConnectionScope(uid, waService.getConnections());
      const connectedIds = connections
        .filter((conn) => conn.status === 'CONNECTED')
        .map((conn) => conn.id);
      const hasConnected = connectionIds.some((id: string) => connectedIds.includes(id));
      if (!hasConnected) {
        userLog('campaign:error', { campaignId, reason: 'Nenhum canal conectado', connectionIds });
        const err = 'Nenhum canal conectado disponível para disparo.';
        callback?.({ ok: false, error: err });
        socket.emit('campaign-error', { error: err });
        notifyCampaignSocketError(uid, err, campaignId);
        return;
      }
      if (typeof delaySeconds === 'number' && Number.isFinite(delaySeconds) && delaySeconds > 0) {
        waService.applySettings({ minDelay: delaySeconds, maxDelay: delaySeconds });
      }
      userLog('ui:start-campaign', { campaignId, connections: connectionIds.length, total: numbers?.length || 0, delaySeconds });
      try {
        const stages =
          Array.isArray(messageStages) && messageStages.length > 0
            ? messageStages.map((s) => String(s ?? '').trim()).filter((s) => s.length > 0)
            : [String(message ?? '').trim()].filter((s) => s.length > 0);
        if (stages.length === 0) {
          const err = 'Nenhuma mensagem definida para a campanha.';
          callback?.({ ok: false, error: err });
          socket.emit('campaign-error', { error: err, campaignId });
          notifyCampaignSocketError(uid, err, campaignId);
          return;
        }
        const ok = await waService.startCampaign(
          numbers,
          stages,
          connectionIds,
          campaignId,
          recipients,
          replyFlow,
          uid,
          channelWeights
        ); // uid = tenant (dono/conta partilhada)
        if (!ok) {
          const errMsg = 'Não foi possível iniciar: verifique se os canais estão conectados e responsivos.';
          callback?.({ ok: false, error: errMsg });
          socket.emit('campaign-error', {
            error: errMsg,
            campaignId
          });
          notifyCampaignSocketError(uid, errMsg, campaignId);
          return;
        }
        callback?.({ ok: true });
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
        await runSessionCommandOrLocal({
          submit: () => submitSendMessage(conversationId, text, authOp),
          local: () => waService.sendMessage(conversationId, text)
        });
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
          caption
        }: {
          conversationId: string;
          dataBase64: string;
          mimeType: string;
          fileName: string;
          caption?: string;
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
        try {
          await runSessionCommandOrLocal({
            submit: () => submitSendMedia({ conversationId, dataBase64, mimeType, fileName, caption }, authOp),
            local: () =>
              waService.sendMedia(conversationId, {
                dataBase64,
                mimeType,
                fileName,
                caption
              })
          });
          callback?.({ ok: true });
        } catch (error: any) {
          const message = error?.message || 'Falha ao enviar arquivo.';
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

    socket.on('update-settings', (settings: { minDelay?: number; maxDelay?: number; dailyLimit?: number; sleepMode?: boolean; webhookUrl?: string; emailNotif?: boolean }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          userLog('ui:update-settings', settings as Record<string, unknown>);
          waService.applySettings(settings);
          socket.emit('settings-saved', { ok: true });
        } catch (e) {
          reportSocketAsyncError('update-settings', e);
        }
      })();
    });

    socket.on('pause-campaign', ({ campaignId }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (!waService.canControlCampaign(uid, campaignId)) {
            denyCrossTenant('pause-campaign', { campaignId });
            return;
          }
          userLog('ui:pause-campaign', { campaignId });
          waService.pauseCampaign(campaignId);
        } catch (e) {
          reportSocketAsyncError('pause-campaign', e);
        }
      })();
    });

    socket.on('resume-campaign', ({ campaignId }) => {
      void (async () => {
        try {
          if (!(await requireActiveSubscription())) return;
          if (!waService.canControlCampaign(uid, campaignId)) {
            denyCrossTenant('resume-campaign', { campaignId });
            return;
          }
          userLog('ui:resume-campaign', { campaignId });
          waService.resumeCampaign(campaignId);
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
          waService.markAsRead(conversationId);
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
          (process.env.SESSION_PROCESS_MODE || 'monolith') === 'api' && Boolean(redisUrl);
        const pic = useWorkerRpc
          ? await fetchConversationPictureViaRedis(redisUrl!, conversationId)
          : await waService.fetchConversationPicture(conversationId);
        socket.emit('conversation-picture', { conversationId, profilePicUrl: pic });
      } catch (e: any) {
        console.error('[fetch-conversation-picture] erro:', e?.message || e);
      }
    });

    socket.on('warmup-marked', async ({ numbers }) => {
      if (!numbers || !Array.isArray(numbers) || numbers.length === 0) return;
      if (!(await requireActiveSubscription())) return;
      userLog('ui:warmup-marked', { count: numbers.length });
      await waService.markWarmupReady(numbers);
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
        await waService.sendWarmupMessage(from, to, message);
      } catch (e: any) {
        console.error(`[Warmup] Erro ao enviar de ${from} para ${to}:`, e?.message || e);
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
        await waService.sendWarmupMessage(fromConnectionId, toPhone, message);
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
        (process.env.SESSION_PROCESS_MODE || 'monolith') === 'api' && Boolean(redisUrl);
      const resp = useWorkerRpc
        ? await loadChatHistoryViaRedis(redisUrl!, conversationId, limit ?? 500, !includeMedia)
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
        (process.env.SESSION_PROCESS_MODE || 'monolith') === 'api' && Boolean(redisUrl);
      const resp = useWorkerRpc
        ? await loadMessageMediaViaRedis(redisUrl!, conversationId, messageId)
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
      const removed = waService.deleteLocalConversations(conversationIds);
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
    const mpOkListen = isMercadoPagoAccessTokenConfigured();
    if (mpOkListen) {
      console.log(`💳 Mercado Pago: token OK (configurado)`);
    } else {
      console.warn(
        `[billing] MERCADOPAGO_ACCESS_TOKEN ausente — checkout MP falhará. Use .env na raiz, env no stack/compose, ou ficheiro em /run/secrets/mercadopago_access_token (volume ./secrets).`
      );
    }
  });

  httpServer.once('error', (err: NodeJS.ErrnoException) => {
    console.error('Falha ao iniciar servidor:', err);
    process.exit(1);
  });

  return true;
};

const bootstrap = async () => {
  const started = await startServer(BASE_PORT);
  if (!started) {
    return;
  }

  registerSocketHandlers();
  startScheduledCampaignRunner();
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

