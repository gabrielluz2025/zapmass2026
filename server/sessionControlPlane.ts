import * as waService from './whatsappService.js';
import { SessionCommandBus } from './sessionCommandBus.js';
import { SessionRouter } from './sessionRouter.js';
import type { SessionCommand, SessionEvent } from './sessionContracts.js';
import { markSessionCommandPublished, markSessionCommandResult } from './observability.js';

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
    await waService.createConnection(command.payload.name, command.payload.ownerUid);
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

  if (PROCESS_MODE !== 'api') {
    commandUnsub = bus.onCommand(async (command) => {
      const targetWorker = router.assignWorker(command);
      if (targetWorker !== WORKER_ID && PROCESS_MODE === 'api') return;
      await publishWorkerEvent('command-accepted', command, { targetWorker });
      try {
        await executeLocally(command);
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
};

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
