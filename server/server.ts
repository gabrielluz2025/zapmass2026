import { PROJECT_ROOT } from './bootstrapEnv.js';
import { isMercadoPagoAccessTokenConfigured } from './mercadoPagoAccess.js';

import express from 'express';
import { createServer } from 'http';
import net from 'net';
import os from 'os';
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
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getAuth } from 'firebase-admin/auth';
import { filterByConnectionScope, ownsConnectionForUid } from '../src/utils/connectionScope.js';
import {
  BASE_CONNECTION_SLOTS,
  countUserScopedConnections,
  getMaxConnectionSlots,
  readUserSubscriptionForLimits,
  isUidTreatedAsServerAdmin
} from './connectionLimits.js';
import {
  getSessionRouterMetrics,
  startSessionControlPlane,
  stopSessionControlPlane,
  submitCreateConnection,
  submitDeleteConnection,
  submitForceQr,
  submitReconnectConnection,
  submitSendMedia,
  submitSendMessage
} from './sessionControlPlane.js';
import { collectMetrics, metricsContentType, setConnectedSessionsGauge } from './observability.js';
import { metricsAccessMiddleware } from './metricsAccess.js';

// --- REAL SYSTEM METRICS ---
let _lastCpuInfo = os.cpus();

const getCpuUsage = (): number => {
  const current = os.cpus();
  let idle = 0, total = 0;
  for (let i = 0; i < current.length; i++) {
    const prev = _lastCpuInfo[i];
    const times = current[i].times;
    for (const t of Object.keys(times) as (keyof typeof times)[]) {
      const diff = times[t] - (prev?.times[t] ?? 0);
      total += diff;
      if (t === 'idle') idle += diff;
    }
  }
  _lastCpuInfo = current;
  return total > 0 ? Math.max(0, Math.min(100, Math.round(100 - (100 * idle / total)))) : 0;
};

const getSystemMetrics = () => {
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedMem  = totalMem - freeMem;
  const ram      = Math.round((usedMem / totalMem) * 100);
  const secs     = Math.floor(process.uptime());
  const h        = Math.floor(secs / 3600);
  const m        = Math.floor((secs % 3600) / 60);
  const uptime   = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const toGb = (bytes: number) => Math.round((bytes / (1024 ** 3)) * 10) / 10;
  return {
    cpu: getCpuUsage(),
    ram,
    uptime,
    ramTotalGb: toGb(totalMem),
    ramFreeGb: toGb(freeMem),
    ramUsedGb: toGb(usedMem),
    platform: process.platform
  };
};

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

const allowedOrigins = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) {
    callback(null, true);
    return;
  }
  if (LOCAL_ORIGIN_RE.test(origin)) {
    callback(null, true);
    return;
  }
  const ok = extraOrigins.some((allowed) => origin === allowed || origin.startsWith(`${allowed}/`));
  if (ok) {
    callback(null, true);
    return;
  }
  console.warn(`[CORS] Origem bloqueada: ${origin}`);
  callback(new Error('Not allowed by CORS'));
};

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"]
}));

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    allowedHeaders: ["ngrok-skip-browser-warning"],
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

app.get('/api/session-router/metrics', metricsAccessMiddleware, (_req, res) => {
  res.json(getSessionRouterMetrics());
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

// Webhook para receber eventos da Evolution API
app.post('/webhook/evolution', (req, res) => {
  try {
    const event = req.body;
    console.log('[Webhook] Evento recebido:', event.event, event.instance);
    
    // Processar evento via evolutionService
    waService.handleWebhook(event);
    
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Webhook] Erro ao processar:', error);
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
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Emit real system metrics every 10s
setInterval(() => {
  if (io) io.emit('system-metrics', getSystemMetrics());
  const connected = waService.getConnections().filter((conn) => conn.status === 'CONNECTED').length;
  setConnectedSessionsGauge(connected);
}, 10000);

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
        socket.data.uid = decoded.uid;
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
    let lastUiLogKey = '';
    let lastUiLogAt = 0;
    const ownsConnectionId = (connectionId: string) => ownsConnectionForUid(uid, connectionId);
    const userLog = (event: string, payload?: Record<string, unknown>) =>
      logEvent(event, { uid, ...(payload || {}) });
    const denyCrossTenant = (action: string, payload?: Record<string, unknown>) => {
      userLog('security:cross-tenant-blocked', { action, ...(payload || {}) });
      socket.emit('security-warning', { action, error: 'Operacao bloqueada por isolamento de conta.' });
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
        let maxAllowed = BASE_CONNECTION_SLOTS;
        if (uid && uid !== 'anonymous') {
          try {
            const [sub, isServAdmin] = await Promise.all([
              readUserSubscriptionForLimits(uid),
              isUidTreatedAsServerAdmin(uid)
            ]);
            maxAllowed = getMaxConnectionSlots(sub, { serverAdmin: isServAdmin });
          } catch (e) {
            console.error('[create-connection] leitura assinatura; aplica teto base', e);
            maxAllowed = BASE_CONNECTION_SLOTS;
          }
        }
        const count = countUserScopedConnections(waService.getConnections(), uid);
        if (count >= maxAllowed) {
          socket.emit('connection-limit-reached', {
            current: count,
            max: maxAllowed,
            message:
              maxAllowed <= BASE_CONNECTION_SLOTS
                ? `Limite de ${maxAllowed} canal(is) do plano atual. Ajuste o plano em Minha assinatura para liberar mais canais (ate 5).`
                : `Voce atingiu o maximo de ${maxAllowed} canal(is) do plano contratado. Em Minha assinatura, selecione um plano com mais canais (ate 5).`
          });
          return;
        }
        userLog('ui:create-connection', { name });
        await submitCreateConnection(
          typeof name === 'string' && name.trim() ? name.trim() : 'WhatsApp',
          uid,
          uid && uid !== 'anonymous' ? uid : undefined
        );
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
        await submitDeleteConnection(id, uid);
        socket.emit('connections-update', filterByConnectionScope(uid, waService.getConnections()));
      } catch (e: any) {
        console.error('[delete-connection]', e);
        socket.emit('send-message-error', { error: e?.message || 'Falha ao remover canal' });
      }
    });

    socket.on('reconnect-connection', ({ id }) => {
      if (!ownsConnectionId(id)) {
        denyCrossTenant('reconnect-connection', { id });
        return;
      }
      userLog('ui:reconnect-connection', { id });
      void submitReconnectConnection(id, uid);
    });

    socket.on('force-qr', ({ id }) => {
      if (!ownsConnectionId(id)) {
        denyCrossTenant('force-qr', { id });
        return;
      }
      userLog('ui:force-qr', { id });
      void submitForceQr(id, uid);
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
          recipients
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
        },
        callback?: (response: { ok: boolean; error?: string }) => void
      ) => {
      if (!connectionIds || connectionIds.length === 0) {
          callback?.({ ok: false, error: 'Nenhuma conexao selecionada.' });
          socket.emit('campaign-error', { error: 'Nenhuma conexao selecionada.' });
          return;
      }
      if (!numbers || numbers.length === 0) {
        userLog('campaign:error', { campaignId, reason: 'Nenhum numero informado' });
        callback?.({ ok: false, error: 'Nenhum numero informado para disparo.' });
        socket.emit('campaign-error', { error: 'Nenhum número informado para disparo.' });
        return;
      }

      if (connectionIds.some((id: string) => !ownsConnectionId(id))) {
        denyCrossTenant('start-campaign', { connectionIds });
        callback?.({ ok: false, error: 'Conexao invalida para esta conta.' });
        return;
      }
      const connections = filterByConnectionScope(uid, waService.getConnections());
      const connectedIds = connections
        .filter((conn) => conn.status === 'CONNECTED')
        .map((conn) => conn.id);
      const hasConnected = connectionIds.some((id: string) => connectedIds.includes(id));
      if (!hasConnected) {
        userLog('campaign:error', { campaignId, reason: 'Nenhum canal conectado', connectionIds });
        callback?.({ ok: false, error: 'Nenhum canal conectado disponível para disparo.' });
        socket.emit('campaign-error', { error: 'Nenhum canal conectado disponível para disparo.' });
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
          callback?.({ ok: false, error: 'Nenhuma mensagem definida para a campanha.' });
          socket.emit('campaign-error', { error: 'Nenhuma mensagem definida para a campanha.', campaignId });
          return;
        }
        await waService.startCampaign(numbers, stages, connectionIds, campaignId, recipients, replyFlow, uid);
        callback?.({ ok: true });
      } catch (error: any) {
        const messageText = error?.message || 'Falha ao iniciar campanha.';
        userLog('campaign:error', { campaignId, reason: messageText, connectionIds });
        callback?.({ ok: false, error: messageText });
        socket.emit('campaign-error', { error: messageText, campaignId });
      }
    });

    socket.on('send-message', async ({ conversationId, text }) => {
      if (typeof conversationId === 'string' && !ownsConnectionId(conversationId.split(':')[0] || '')) {
        denyCrossTenant('send-message', { conversationId });
        return;
      }
      userLog('ui:send-message', { conversationId });
      try {
        await submitSendMessage(conversationId, text, uid);
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
        try {
          await submitSendMedia({ conversationId, dataBase64, mimeType, fileName, caption }, uid);
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

    socket.on('update-settings', (settings: { minDelay?: number; maxDelay?: number; dailyLimit?: number; sleepMode?: boolean; webhookUrl?: string; emailNotif?: boolean }) => {
      userLog('ui:update-settings', settings as Record<string, unknown>);
      waService.applySettings(settings);
      socket.emit('settings-saved', { ok: true });
    });

    socket.on('pause-campaign', ({ campaignId }) => {
      if (!waService.canControlCampaign(uid, campaignId)) {
        denyCrossTenant('pause-campaign', { campaignId });
        return;
      }
      userLog('ui:pause-campaign', { campaignId });
      waService.pauseCampaign(campaignId);
    });

    socket.on('resume-campaign', ({ campaignId }) => {
      if (!waService.canControlCampaign(uid, campaignId)) {
        denyCrossTenant('resume-campaign', { campaignId });
        return;
      }
      userLog('ui:resume-campaign', { campaignId });
      waService.resumeCampaign(campaignId);
    });

    socket.on('mark-as-read', ({ conversationId }) => {
      if (typeof conversationId === 'string' && !ownsConnectionId(conversationId.split(':')[0] || '')) {
        denyCrossTenant('mark-as-read', { conversationId });
        return;
      }
      userLog('ui:mark-as-read', { conversationId });
      waService.markAsRead(conversationId);
    });

    socket.on('fetch-conversation-picture', async ({ conversationId }: { conversationId: string }) => {
      if (!conversationId) return;
      if (!ownsConnectionId(conversationId.split(':')[0] || '')) {
        denyCrossTenant('fetch-conversation-picture', { conversationId });
        return;
      }
      try {
        const pic = await waService.fetchConversationPicture(conversationId);
        socket.emit('conversation-picture', { conversationId, profilePicUrl: pic });
      } catch (e: any) {
        console.error('[fetch-conversation-picture] erro:', e?.message || e);
      }
    });

    socket.on('warmup-marked', async ({ numbers }) => {
      if (!numbers || !Array.isArray(numbers) || numbers.length === 0) return;
      userLog('ui:warmup-marked', { count: numbers.length });
      await waService.markWarmupReady(numbers);
      socket.emit('warmup-update', getWarmupStateForUid());
    });

    socket.on('warmup-send', async ({ from, to, message }) => {
      if (!from || !to || !message) return;
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
      const resp = await waService.loadChatHistory(conversationId, limit ?? 500, !includeMedia);
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
      const resp = await waService.loadMessageMedia(conversationId, messageId);
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
      userLog('ui:clear-funnel-stats', { socketId: socket.id });
      waService.clearFunnelStats(uid);
    });

    socket.on('clear-warmup-chip-stats', (connectionId?: string) => {
      if (connectionId && !ownsConnectionId(connectionId)) {
        denyCrossTenant('clear-warmup-chip-stats', { connectionId });
        return;
      }
      userLog('ui:clear-warmup-chip-stats', { socketId: socket.id, connectionId });
      waService.clearWarmupChipStats(connectionId);
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
  await startSessionControlPlane();

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

