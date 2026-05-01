import type { SessionCommand } from './sessionContracts.js';

/** Máximo de comandos pesados (Chromium / sessão) em paralelo por processo worker. */
const maxConcurrent = Math.max(
  1,
  Math.min(16, Number(process.env.SESSION_COMMAND_CONCURRENCY || '3') || 3)
);

let inFlight = 0;
const globalWait: Array<() => void> = [];

function acquireGlobal(): Promise<void> {
  return new Promise((resolve) => {
    const tryGo = () => {
      if (inFlight < maxConcurrent) {
        inFlight++;
        resolve();
      } else {
        globalWait.push(tryGo);
      }
    };
    tryGo();
  });
}

function releaseGlobal(): void {
  inFlight--;
  const next = globalWait.shift();
  if (next) next();
}

function connectionQueueKey(command: SessionCommand): string {
  if ('connectionId' in command && command.connectionId) return command.connectionId;
  if ('payload' in command && command.payload && 'conversationId' in command.payload) {
    return String(command.payload.conversationId || '').split(':')[0] || '';
  }
  return '';
}

const connectionTails = new Map<string, Promise<unknown>>();

/**
 * Limita concorrência global (evita N Chromium ao mesmo tempo) e serializa por `connectionId`
 * para não misturar reconnect / force-qr / envio no mesmo canal.
 * `create-connection` não tem id — só participa do limite global.
 */
export async function runWithSessionCommandLimits(
  command: SessionCommand,
  work: () => Promise<void>
): Promise<void> {
  const connId = connectionQueueKey(command);

  const runBody = async () => {
    await acquireGlobal();
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
