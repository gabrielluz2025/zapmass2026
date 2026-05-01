import * as waService from './whatsappService.js';
import { evaluateMayCreateWaConnection } from './connectionLimits.js';
import { runWithSessionCommandLimits } from './sessionCommandConcurrency.js';
import { SessionCommandBus } from './sessionCommandBus.js';
import { SessionRouter } from './sessionRouter.js';
import type { SessionCommand, SessionEvent } from './sessionContracts.js';
import { markSessionCommandPublished, markSessionCommandResult } from './observability.js';

/**
 * Notifica o utilizador de que o comando ainda está a aguardar slot livre.
 * - `create-connection` ainda não tem `connectionId` → publicamos para o `ownerUid`.
 * - Outros tipos têm `connectionId` → emitToConnectionOwner descobre o dono.
 */
const emitQueueProgress = (command: SessionCommand, position: number): void => {
  const detail = {
    queue: { position, etaPhase: position <= 1 ? 'about-to-start' : 'waiting' },
    phase: 'queued',
    at: Date.now()
  };
  if (command.type === 'create-connection') {
    waService.publishOwnerEvent(command.payload.ownerUid || command.requestedByUid, 'connection-queue-progress', {
      ...detail,
      pendingFor: 'create-connection'
    });
    return;
  }
  if ('connectionId' in command && command.connectionId) {
    waService.publishOwnerEvent(command.requestedByUid, 'connection-queue-progress', {
      ...detail,
      pendingFor: command.type,
      connectionId: command.connectionId
    });
  }
};

const PROCESS_MODE = process.env.SESSION_PROCESS_MODE || 'monolith';
const WORKER_ID = process.env.WORKER_ID || `api-${process.pid}`;

const bus = new SessionCommandBus();
const router = new SessionRouter();
let commandUnsub: (() => void) | null = null;
let eventUnsub: (() => void) | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let started = false;

const nextId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const extractConnectionId = (command: SessionCommand): string | undefined => {
  if ('connectionId' in command && command.connectionId) return command.connectionId;
  if ('payload' in command && command.payload && 'conversationId' in command.payload) {
    return String(command.payload.conversationId || '').split(':')[0] || undefined;
  }
  return undefined;
};

const executeLocally = async (command: SessionCommand): Promise<void> => {
  if (command.type === 'create-connection') {
    const uid = command.requestedByUid;
    const decision = await evaluateMayCreateWaConnection(uid, waService.getConnections());
    if (decision.ok === false) {
      throw new Error(
        decision.reason === 'subscription-required'
          ? `[policy] subscription-required (uid=${uid})`
          : `[policy] connection-limit-reached ${decision.current}/${decision.max} (uid=${uid})`
      );
    }
    await waService.createConnection(command.payload.name, command.payload.ownerUid);
    return;
  }
  if (command.type === 'delete-connection') {
    await waService.deleteConnection(command.connectionId);
    return;
  }
  if (command.type === 'reconnect-connection') {
    await waService.reconnectConnection(command.connectionId);
    return;
  }
  if (command.type === 'force-qr') {
    await waService.forceQr(command.connectionId);
    return;
  }
  if (command.type === 'rename-connection') {
    await waService.renameConnection(command.connectionId, command.payload.name);
    return;
  }
  if (command.type === 'send-message') {
    await waService.sendMessage(command.payload.conversationId, command.payload.text);
    return;
  }
  await waService.sendMedia(command.payload.conversationId, {
    dataBase64: command.payload.dataBase64,
    mimeType: command.payload.mimeType,
    fileName: command.payload.fileName,
    caption: command.payload.caption
  });
};

const publishWorkerEvent = async (
  type: SessionEvent['type'],
  command: SessionCommand | null,
  details?: Record<string, unknown>
) => {
  await bus.publishEvent({
    eventId: nextId('event'),
    type,
    workerId: WORKER_ID,
    commandId: command?.commandId,
    connectionId: command ? extractConnectionId(command) : undefined,
    emittedAt: Date.now(),
    details
  });
};

export const startSessionControlPlane = async (): Promise<void> => {
  if (started) return;
  started = true;
  await bus.start();
  router.heartbeat(WORKER_ID);

  // Com Redis, o processo `api` apenas publica comandos; o `worker` executa.
  // Sem Redis, o barramento é em memória: o mesmo processo tem de subscrever,
  // senão create-connection / force-qr nunca correm (QR não aparece).
  const runSessionCommandsInThisProcess =
    PROCESS_MODE !== 'api' || !process.env.REDIS_URL?.trim();

  if (runSessionCommandsInThisProcess) {
    commandUnsub = bus.onCommand(async (command) => {
      const targetWorker = router.assignWorker(command);
      if (targetWorker !== WORKER_ID && PROCESS_MODE === 'api') return;
      await publishWorkerEvent('command-accepted', command, { targetWorker });
      try {
        await runWithSessionCommandLimits(command, () => executeLocally(command), {
          onQueuePosition: (position) => emitQueueProgress(command, position)
        });
        const connectionId = extractConnectionId(command);
        if (connectionId) router.renewConnectionLease(connectionId, WORKER_ID);
        router.recordCommandCompleted();
        markSessionCommandResult('ok');
        await publishWorkerEvent('command-completed', command, { targetWorker });
      } catch (error: any) {
        router.recordCommandFailed();
        markSessionCommandResult('error');
        await publishWorkerEvent('command-failed', command, {
          targetWorker,
          error: error?.message || 'erro-desconhecido'
        });
      }
    });
  }

  eventUnsub = bus.onEvent(async (event) => {
    if (event.type === 'worker-heartbeat' && event.workerId) router.heartbeat(event.workerId);
    if (event.workerId === WORKER_ID) return;
    if (event.type === 'command-completed') router.recordCommandCompleted();
    if (event.type === 'command-failed') router.recordCommandFailed();
  });

  heartbeatTimer = setInterval(() => {
    router.heartbeat(WORKER_ID);
    void publishWorkerEvent('worker-heartbeat', null);
  }, 10000);

  // Garante que a API (ou outro leitor) ve `worker-*` cedo, nao so daqui a 10s.
  void publishWorkerEvent('worker-heartbeat', null);
};

/** `SESSION_PROCESS_MODE=api` com Redis: comandos vao para o stream; o Chromium so no `wa-worker`. */
export const isSessionBusRemote = (): boolean =>
  (process.env.SESSION_PROCESS_MODE || 'monolith') === 'api' && Boolean(process.env.REDIS_URL?.trim());

export const getWhatsappProcessWorkerCount = (): number => router.countWhatsappProcessWorkersExcludingApi();

export const stopSessionControlPlane = async (): Promise<void> => {
  commandUnsub?.();
  eventUnsub?.();
  commandUnsub = null;
  eventUnsub = null;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  await bus.stop();
};

export const getSessionRouterMetrics = () => router.getMetricsSnapshot();

export const submitDeleteConnection = async (connectionId: string, requestedByUid: string) => {
  const command: SessionCommand = {
    commandId: nextId('cmd'),
    requestedAt: Date.now(),
    requestedByUid,
    type: 'delete-connection',
    connectionId
  };
  router.recordCommandPublished();
  markSessionCommandPublished(command.type);
  await bus.publishCommand(command);
};

export const submitCreateConnection = async (name: string, requestedByUid: string, ownerUid?: string) => {
  const command: SessionCommand = {
    commandId: nextId('cmd'),
    requestedAt: Date.now(),
    requestedByUid,
    type: 'create-connection',
    payload: { name, ownerUid }
  };
  router.recordCommandPublished();
  markSessionCommandPublished(command.type);
  await bus.publishCommand(command);
};

export const submitReconnectConnection = async (connectionId: string, requestedByUid: string) => {
  const command: SessionCommand = {
    commandId: nextId('cmd'),
    requestedAt: Date.now(),
    requestedByUid,
    type: 'reconnect-connection',
    connectionId
  };
  router.recordCommandPublished();
  markSessionCommandPublished(command.type);
  await bus.publishCommand(command);
};

export const submitRenameConnection = async (
  connectionId: string,
  name: string,
  requestedByUid: string
) => {
  const command: SessionCommand = {
    commandId: nextId('cmd'),
    requestedAt: Date.now(),
    requestedByUid,
    type: 'rename-connection',
    connectionId,
    payload: { name }
  };
  router.recordCommandPublished();
  markSessionCommandPublished(command.type);
  await bus.publishCommand(command);
};

export const submitForceQr = async (connectionId: string, requestedByUid: string) => {
  const command: SessionCommand = {
    commandId: nextId('cmd'),
    requestedAt: Date.now(),
    requestedByUid,
    type: 'force-qr',
    connectionId
  };
  router.recordCommandPublished();
  markSessionCommandPublished(command.type);
  await bus.publishCommand(command);
};

export const submitSendMessage = async (conversationId: string, text: string, requestedByUid: string) => {
  const command: SessionCommand = {
    commandId: nextId('cmd'),
    requestedAt: Date.now(),
    requestedByUid,
    type: 'send-message',
    payload: { conversationId, text }
  };
  router.recordCommandPublished();
  markSessionCommandPublished(command.type);
  await bus.publishCommand(command);
};

export const submitSendMedia = async (
  payload: { conversationId: string; dataBase64: string; mimeType: string; fileName: string; caption?: string },
  requestedByUid: string
) => {
  const command: SessionCommand = {
    commandId: nextId('cmd'),
    requestedAt: Date.now(),
    requestedByUid,
    type: 'send-media',
    payload
  };
  router.recordCommandPublished();
  markSessionCommandPublished(command.type);
  await bus.publishCommand(command);
};
