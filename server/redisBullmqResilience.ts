/**
 * Proteção contra loop CPU quando Redis está no limite (OOM / stream não gravável).
 * Pausa workers BullMQ com backoff exponencial antes de reconectar.
 */
import type IORedis from 'ioredis';
import type { Worker } from 'bullmq';

const STRESS_PATTERNS = [
  /OOM command not allowed/i,
  /Stream isn't writeable/i,
  /READONLY/i,
  /LOADING Redis is loading/i,
];

export function isRedisStressError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '');
  return STRESS_PATTERNS.some((p) => p.test(msg));
}

/** Conexão ioredis/BullMQ morta (comum após restart do Redis ou deploy). */
export function isRedisConnectionClosedError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('connection is closed') ||
    msg.includes('connection closed') ||
    msg.includes('the connection is already closed') ||
    msg.includes('stream isn\'t writeable')
  );
}

export type BullmqRecoveryHandler = {
  name: string;
  reset: () => void;
  ensureWorker: () => void;
};

const recoveryAttempts = new Map<string, number>();
const pendingRecovery = new Map<string, NodeJS.Timeout>();
const ensureDebounce = new Map<string, NodeJS.Timeout>();

const BASE_BACKOFF_MS = Math.max(
  1000,
  parseInt(process.env.BULLMQ_REDIS_STRESS_BACKOFF_MS || '5000', 10)
);
const MAX_BACKOFF_MS = Math.max(
  BASE_BACKOFF_MS,
  parseInt(process.env.BULLMQ_REDIS_STRESS_MAX_BACKOFF_MS || '60000', 10)
);

const ENSURE_DEBOUNCE_MS = Math.max(
  2000,
  parseInt(process.env.BULLMQ_ENSURE_DEBOUNCE_MS || '8000', 10)
);

function nextBackoffMs(name: string): number {
  const attempt = (recoveryAttempts.get(name) ?? 0) + 1;
  recoveryAttempts.set(name, attempt);
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

export function isBullmqRecoveryPending(name: string): boolean {
  return pendingRecovery.has(name);
}

export function clearBullmqRecoveryPending(name: string): void {
  const timer = pendingRecovery.get(name);
  if (timer) {
    clearTimeout(timer);
    pendingRecovery.delete(name);
  }
}

const RECOVERY_POLL_MS = 400;

/** Aguarda backoff de stress; se Redis já está saudável, libera enfileiramento. */
export async function waitForBullmqRecoveryOrProceed(
  name: string,
  opts?: { maxWaitMs?: number; canProceed?: () => Promise<boolean> }
): Promise<void> {
  const maxWaitMs = Math.max(2000, opts?.maxWaitMs ?? 75_000);
  const deadline = Date.now() + maxWaitMs;
  while (isBullmqRecoveryPending(name) && Date.now() < deadline) {
    if (opts?.canProceed && (await opts.canProceed())) {
      clearBullmqRecoveryPending(name);
      clearBullmqRecoveryAttempts(name);
      return;
    }
    await new Promise((r) => setTimeout(r, RECOVERY_POLL_MS));
  }
  if (!isBullmqRecoveryPending(name)) return;
  if (opts?.canProceed && (await opts.canProceed())) {
    clearBullmqRecoveryPending(name);
    clearBullmqRecoveryAttempts(name);
    return;
  }
  throw new Error('Redis sob stress (memória cheia). Aguarde alguns segundos e tente novamente.');
}

/** Zera contador de backoff após worker estável (não cancelar recovery em andamento). */
export function clearBullmqRecoveryAttempts(name: string): void {
  recoveryAttempts.delete(name);
}

/** Agenda reset + recriação do worker com backoff (debounced por fila). */
export function scheduleBullmqRecovery(handler: BullmqRecoveryHandler, err?: unknown): void {
  if (err == null || !isRedisStressError(err)) return;
  if (isRedisConnectionClosedError(err)) return;
  if (pendingRecovery.has(handler.name)) return;

  const pendingEnsure = ensureDebounce.get(handler.name);
  if (pendingEnsure) {
    clearTimeout(pendingEnsure);
    ensureDebounce.delete(handler.name);
  }

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
    recoveryAttempts.delete(handler.name);
    try {
      handler.ensureWorker();
    } catch (ensureErr) {
      console.warn(`[${handler.name}] falha ao recriar worker:`, ensureErr);
    }
  }, backoffMs);

  pendingRecovery.set(handler.name, timer);
}

/** Recria worker após reconexão normal (debounced; não compete com recovery). */
export function scheduleDebouncedBullmqEnsure(
  handler: BullmqRecoveryHandler,
  delayMs = ENSURE_DEBOUNCE_MS
): void {
  if (pendingRecovery.has(handler.name)) return;
  if (ensureDebounce.has(handler.name)) return;

  const timer = setTimeout(() => {
    ensureDebounce.delete(handler.name);
    if (pendingRecovery.has(handler.name)) return;
    try {
      handler.ensureWorker();
    } catch (ensureErr) {
      console.warn(`[${handler.name}] falha ao garantir worker (debounce):`, ensureErr);
    }
  }, delayMs);

  ensureDebounce.set(handler.name, timer);
}

export function attachRedisStressGuard(redis: IORedis, handler: BullmqRecoveryHandler): void {
  redis.on('error', (err) => {
    if (isRedisConnectionClosedError(err)) return;
    if (isRedisStressError(err)) {
      scheduleBullmqRecovery(handler, err);
    }
  });
  // Não chamar ensureWorker no `connect` — ioredis reconecta antes do backoff e causa loop CPU.
  redis.on('ready', () => {
    scheduleDebouncedBullmqEnsure(handler);
  });
}

export function attachWorkerStressGuard(worker: Worker, handler: BullmqRecoveryHandler): void {
  worker.on('error', (err) => {
    if (isRedisConnectionClosedError(err)) return;
    if (isRedisStressError(err)) {
      scheduleBullmqRecovery(handler, err);
    }
  });
}
