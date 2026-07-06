/**
 * Proteção contra loop CPU quando Redis está no limite (OOM / stream não gravável).
 * Pausa workers BullMQ com backoff exponencial antes de reconectar.
 */
import type IORedis from 'ioredis';
import type { Worker } from 'bullmq';

const STRESS_PATTERNS = [
  /OOM command not allowed/i,
  /maxmemory/i,
  /Stream isn't writeable/i,
  /enableOfflineQueue/i,
  /READONLY/i,
  /LOADING Redis is loading/i,
];

export function isRedisStressError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '');
  return STRESS_PATTERNS.some((p) => p.test(msg));
}

export type BullmqRecoveryHandler = {
  name: string;
  reset: () => void;
  ensureWorker: () => void;
};

const recoveryAttempts = new Map<string, number>();
const pendingRecovery = new Map<string, NodeJS.Timeout>();

const BASE_BACKOFF_MS = Math.max(
  1000,
  parseInt(process.env.BULLMQ_REDIS_STRESS_BACKOFF_MS || '5000', 10)
);
const MAX_BACKOFF_MS = Math.max(
  BASE_BACKOFF_MS,
  parseInt(process.env.BULLMQ_REDIS_STRESS_MAX_BACKOFF_MS || '60000', 10)
);

function nextBackoffMs(name: string): number {
  const attempt = (recoveryAttempts.get(name) ?? 0) + 1;
  recoveryAttempts.set(name, attempt);
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/** Zera contador de backoff após reconexão estável. */
export function clearBullmqRecoveryAttempts(name: string): void {
  recoveryAttempts.delete(name);
  const timer = pendingRecovery.get(name);
  if (timer) {
    clearTimeout(timer);
    pendingRecovery.delete(name);
  }
}

/** Agenda reset + recriação do worker com backoff (debounced por fila). */
export function scheduleBullmqRecovery(handler: BullmqRecoveryHandler, err?: unknown): void {
  if (err != null && !isRedisStressError(err)) return;
  if (pendingRecovery.has(handler.name)) return;

  const backoffMs = nextBackoffMs(handler.name);
  console.warn(
    `[${handler.name}] Redis sob stress — reset BullMQ e backoff ${backoffMs}ms`,
    err instanceof Error ? err.message : err != null ? String(err) : undefined
  );

  try {
    handler.reset();
  } catch (resetErr) {
    console.warn(`[${handler.name}] falha ao resetar conexão BullMQ:`, resetErr);
  }

  const timer = setTimeout(() => {
    pendingRecovery.delete(handler.name);
    try {
      handler.ensureWorker();
    } catch (ensureErr) {
      console.warn(`[${handler.name}] falha ao recriar worker:`, ensureErr);
    }
  }, backoffMs);

  pendingRecovery.set(handler.name, timer);
}

export function attachRedisStressGuard(redis: IORedis, handler: BullmqRecoveryHandler): void {
  redis.on('error', (err) => {
    if (isRedisStressError(err)) {
      scheduleBullmqRecovery(handler, err);
    }
  });
  redis.on('connect', () => {
    clearBullmqRecoveryAttempts(handler.name);
  });
}

export function attachWorkerStressGuard(worker: Worker, handler: BullmqRecoveryHandler): void {
  worker.on('error', (err) => {
    if (isRedisStressError(err)) {
      scheduleBullmqRecovery(handler, err);
    }
  });
}
