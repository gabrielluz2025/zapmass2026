export type SessionCommandType =
  | 'create-connection'
  | 'reconnect-connection'
  | 'force-qr'
  | 'send-message'
  | 'send-media'
  | 'delete-connection';

export interface SessionCommandBase {
  commandId: string;
  connectionId?: string;
  requestedByUid: string;
  requestedAt: number;
}

export interface CreateConnectionCommand extends SessionCommandBase {
  type: 'create-connection';
  payload: {
    name: string;
    ownerUid?: string;
  };
}

export interface ReconnectConnectionCommand extends SessionCommandBase {
  type: 'reconnect-connection';
  connectionId: string;
}

export interface ForceQrCommand extends SessionCommandBase {
  type: 'force-qr';
  connectionId: string;
}

export interface SendMessageCommand extends SessionCommandBase {
  type: 'send-message';
  payload: {
    conversationId: string;
    text: string;
  };
}

export interface SendMediaCommand extends SessionCommandBase {
  type: 'send-media';
  payload: {
    conversationId: string;
    dataBase64: string;
    mimeType: string;
    fileName: string;
    caption?: string;
  };
}

export interface DeleteConnectionCommand extends SessionCommandBase {
  type: 'delete-connection';
  connectionId: string;
}

export type SessionCommand =
  | CreateConnectionCommand
  | ReconnectConnectionCommand
  | ForceQrCommand
  | SendMessageCommand
  | SendMediaCommand
  | DeleteConnectionCommand;

export type SessionEventType =
  | 'worker-heartbeat'
  | 'command-accepted'
  | 'command-completed'
  | 'command-failed';

export interface SessionEvent {
  eventId: string;
  type: SessionEventType;
  workerId: string;
  commandId?: string;
  connectionId?: string;
  emittedAt: number;
  details?: Record<string, unknown>;
}

export interface WorkerAssignment {
  workerId: string;
  connectionId: string;
  leaseUntil: number;
}

export interface SessionMetricsSnapshot {
  commandsPublished: number;
  commandsCompleted: number;
  commandsFailed: number;
  pendingAssignments: number;
  aliveWorkers: number;
}
