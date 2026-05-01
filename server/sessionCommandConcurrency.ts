import type { SessionCommand } from './sessionContracts.js';

/** Máximo de comandos pesados (Chromium / sessão) em paralelo por processo worker. */
export const maxConcurrentSessionCommands = Math.max(
  1,
  Math.min(16, Number(process.env.SESSION_COMMAND_CONCURRENCY || '3') || 3)
);

let inFlight = 0;
type WaitEntry = { go: () => void; cmd: SessionCommand; onPos?: (pos: number) => void };
const globalWait: WaitEntry[] = [];

function notifyQueuePositions(): void {
  for (let i = 0; i < globalWait.length; i++) {
    const entry = globalWait[i];
    if (entry?.onPos) {
      try {
        entry.onPos(i + 1);
      } catch {
        /* ignore listener throws */
      }
    }
  }
}

function acquireGlobal(cmd: SessionCommand, onPos?: (pos: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const tryGo = () => {
      if (inFlight < maxConcurrentSessionCommands) {
        inFlight++;
        resolve();
      } else {
        globalWait.push({ go: tryGo, cmd, onPos });
        notifyQueuePositions();
      }
    };
    tryGo();
  });
}

function releaseGlobal(): void {
  inFlight--;
  const next = globalWait.shift();
  if (next) next.go();
  notifyQueuePositions();
}

function connectionQueueKey(command: SessionCommand): string {
  if ('connectionId' in command && command.connectionId) return command.connectionId;
  if ('payload' in command && command.payload && 'conversationId' in command.payload) {
    return String(command.payload.conversationId || '').split(':')[0] || '';
  }
  return '';
}

const connectionTails = new Map<string, Promise<unknown>>();

export interface SessionCommandRunOptions {
  /**
   * Recebe a posição actual na fila global (1 = próximo a entrar) sempre que mudar.
   * Não é chamado se o comando entra logo (sem espera).
   */
  onQueuePosition?: (position: number) => void;
}

/**
 * Limita concorrência global (evita N Chromium ao mesmo tempo) e serializa por `connectionId`
 * para não misturar reconnect / force-qr / envio no mesmo canal.
 * `create-connection` não tem id — só participa do limite global.
 */
export async function runWithSessionCommandLimits(
  command: SessionCommand,
  work: () => Promise<void>,
  options?: SessionCommandRunOptions
): Promise<void> {
  const connId = connectionQueueKey(command);

  const runBody = async () => {
    await acquireGlobal(command, options?.onQueuePosition);
    try {
      await work();
    } finally {
      releaseGlobal();
    }
  };

  if (!connId) {
    await runBody();
    return;
  }

  const prev = connectionTails.get(connId) ?? Promise.resolve();
  const current = prev.then(runBody, runBody);
  connectionTails.set(connId, current);
  try {
    await current;
  } finally {
    if (connectionTails.get(connId) === current) {
      connectionTails.delete(connId);
    }
  }
}

/** Snapshot atual: usado em métricas/UI. */
export function getSessionCommandConcurrencyStats(): { inFlight: number; waiting: number; max: number } {
  return { inFlight, waiting: globalWait.length, max: maxConcurrentSessionCommands };
}
