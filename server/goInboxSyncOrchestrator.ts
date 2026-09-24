/**
 * Orquestrador único de sync da inbox (Evolution Go).
 * Coalesce pedidos (F5, recovery, pós-campanha) e evita restart em conflito com campanha.
 */

import type { InboxSyncPolicyPayload } from '../shared/inboxSyncPolicy.js';
import { defaultInboxSyncPolicy } from '../shared/inboxSyncPolicy.js';
import {
  getGoHistorySyncOpsForOwner,
  markHistorySyncDeferredForOwner,
  schedulePostCampaignInboxSync,
} from './goHistorySyncOps.js';

export type InboxSyncIntentMode = 'light' | 'phone_full';

type QueuedIntent = { mode: InboxSyncIntentMode; source: string; at: number };

const COALESCE_MS = Math.max(
  2_000,
  Math.min(30_000, Number(process.env.GO_INBOX_SYNC_COALESCE_MS ?? 8_000))
);
const BLOCKED_RETRY_MS = Math.max(
  30_000,
  Math.min(10 * 60_000, Number(process.env.GO_INBOX_SYNC_BLOCKED_RETRY_MS ?? 90_000))
);
const DRAIN_SWEEP_MS = Math.max(60_000, Number(process.env.GO_INBOX_SYNC_DRAIN_SWEEP_MS ?? 120_000));

const queueByOwner = new Map<string, QueuedIntent>();
const inflightByOwner = new Map<string, Promise<void>>();
const coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const blockedRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const nextAutoAttemptSecByOwner = new Map<string, number>();
const maxConcurrentPerOwner = Math.max(
  1,
  Math.min(3, Number(process.env.GO_HISTORY_SYNC_MAX_CONCURRENT_PER_OWNER ?? 1))
);

export type InboxSyncExecutor = {
  reemitLight: (ownerUid: string) => Promise<void>;
  syncFromPhone: (
    ownerUid: string,
    opts?: { force?: boolean; userInitiated?: boolean }
  ) => Promise<unknown>;
  isCampaignBlocking: (ownerUid: string) => boolean;
  isWarmupBlocking?: (ownerUid: string) => boolean;
  /** Proteção de chip (quiet/storm/ban) — bloqueia restart automático do celular. */
  isChipProtectionBlocking?: (ownerUid: string) => boolean | Promise<boolean>;
  publishPolicy: (ownerUid: string, payload: InboxSyncPolicyPayload) => void;
};

let executor: InboxSyncExecutor | null = null;

export function registerInboxSyncExecutor(ex: InboxSyncExecutor): void {
  executor = ex;
}

function uidNorm(raw: string): string {
  return String(raw || '').trim();
}

function mergeIntent(prev: QueuedIntent | undefined, next: QueuedIntent): QueuedIntent {
  if (!prev) return next;
  const mode =
    prev.mode === 'phone_full' || next.mode === 'phone_full' ? 'phone_full' : 'light';
  return { mode, source: next.source, at: Math.max(prev.at, next.at) };
}

function enqueue(ownerUid: string, mode: InboxSyncIntentMode, source: string): void {
  const uid = uidNorm(ownerUid);
  if (!uid || uid === 'anonymous') return;
  const next: QueuedIntent = { mode, source, at: Date.now() };
  queueByOwner.set(uid, mergeIntent(queueByOwner.get(uid), next));
  if (mode === 'phone_full') markHistorySyncDeferredForOwner(uid);
}

export function getInboxSyncQueueDepth(ownerUid: string): number {
  const uid = uidNorm(ownerUid);
  return queueByOwner.has(uid) ? 1 : 0;
}

/** Atualiza cache de proteção e emite política (socket boot). */
export async function emitInboxSyncPolicyForOwner(ownerUid: string): Promise<void> {
  const uid = uidNorm(ownerUid);
  if (!uid || !executor) return;
  await resolveChipPhoneSyncBlocked(uid);
  executor.publishPolicy(uid, buildInboxSyncPolicy(uid));
}

const chipPhoneBlockCache = new Map<string, boolean>();

async function resolveChipPhoneSyncBlocked(uid: string): Promise<boolean> {
  if (!executor?.isChipProtectionBlocking) {
    chipPhoneBlockCache.set(uid, false);
    return false;
  }
  const blocked = Boolean(await Promise.resolve(executor.isChipProtectionBlocking(uid)));
  chipPhoneBlockCache.set(uid, blocked);
  return blocked;
}

function chipPhoneSyncBlockedSync(uid: string): boolean {
  return chipPhoneBlockCache.get(uid) ?? false;
}

async function isPhoneFullBlocked(uid: string): Promise<boolean> {
  if (!executor) return false;
  if (executor.isCampaignBlocking(uid)) return true;
  if (executor.isWarmupBlocking?.(uid)) return true;
  return resolveChipPhoneSyncBlocked(uid);
}

export function buildInboxSyncPolicy(ownerUid: string): InboxSyncPolicyPayload {
  const uid = uidNorm(ownerUid);
  const base = defaultInboxSyncPolicy();
  if (!uid || !executor) return base;

  const campaign = executor.isCampaignBlocking(uid);
  const warmup = executor.isWarmupBlocking?.(uid) ?? false;
  const chipBlocked = chipPhoneSyncBlockedSync(uid);
  const pending = queueByOwner.has(uid);
  const blockReason = campaign
    ? 'campaign'
    : warmup
      ? 'warmup'
      : chipBlocked
        ? 'chip_protection'
        : 'none';

  return {
    phoneFullBlocked: campaign || warmup || chipBlocked,
    blockReason,
    pendingPhoneFull: pending,
    nextAutoAttemptSec: nextAutoAttemptSecByOwner.get(uid) ?? 0,
    updatedAt: Date.now(),
  };
}

function publishPolicy(ownerUid: string): void {
  if (!executor) return;
  const uid = uidNorm(ownerUid);
  void resolveChipPhoneSyncBlocked(uid).finally(() => {
    if (executor) executor.publishPolicy(uid, buildInboxSyncPolicy(uid));
  });
}

function scheduleCoalescedProcess(ownerUid: string, delayMs = COALESCE_MS): void {
  const uid = uidNorm(ownerUid);
  if (!uid) return;
  const prev = coalesceTimers.get(uid);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    coalesceTimers.delete(uid);
    void drainOwnerQueue(uid).catch(() => undefined);
  }, delayMs);
  coalesceTimers.set(uid, t);
}

function scheduleBlockedRetry(ownerUid: string): void {
  const uid = uidNorm(ownerUid);
  if (!uid) return;
  const sec = Math.ceil(BLOCKED_RETRY_MS / 1000);
  nextAutoAttemptSecByOwner.set(uid, sec);
  publishPolicy(uid);
  const prev = blockedRetryTimers.get(uid);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    blockedRetryTimers.delete(uid);
    nextAutoAttemptSecByOwner.delete(uid);
    scheduleCoalescedProcess(uid, 500);
  }, BLOCKED_RETRY_MS);
  blockedRetryTimers.set(uid, t);
}

async function drainOwnerQueue(ownerUid: string): Promise<void> {
  const uid = uidNorm(ownerUid);
  if (!uid || !executor) return;
  if (inflightByOwner.has(uid)) return;

  const intent = queueByOwner.get(uid);
  if (!intent) {
    publishPolicy(uid);
    return;
  }

  if (
    executor.isCampaignBlocking(uid) ||
    executor.isWarmupBlocking?.(uid) ||
    (await isPhoneFullBlocked(uid))
  ) {
    markHistorySyncDeferredForOwner(uid);
    scheduleBlockedRetry(uid);
    return;
  }

  queueByOwner.delete(uid);
  const run = (async () => {
    if (intent.mode === 'light') {
      await executor!.reemitLight(uid);
    } else {
      const userInitiated = intent.source === 'socket';
      await executor!.syncFromPhone(uid, {
        force: userInitiated,
        userInitiated,
      });
    }
    publishPolicy(uid);
    if (queueByOwner.has(uid)) scheduleCoalescedProcess(uid, 1_500);
  })();

  inflightByOwner.set(uid, run);
  try {
    await run;
  } finally {
    if (inflightByOwner.get(uid) === run) inflightByOwner.delete(uid);
  }
}

/** Socket `request-conversations-sync` — ponto único de entrada. */
export async function handleOwnerInboxSyncRequest(ownerUid: string, fullSync: boolean): Promise<void> {
  const uid = uidNorm(ownerUid);
  if (!uid || uid === 'anonymous' || !executor) return;

  if (!fullSync) {
    await executor.reemitLight(uid);
    publishPolicy(uid);
    return;
  }

  enqueue(uid, 'phone_full', 'socket');
  void resolveChipPhoneSyncBlocked(uid);
  if (
    executor.isCampaignBlocking(uid) ||
    executor.isWarmupBlocking?.(uid) ||
    (await isPhoneFullBlocked(uid))
  ) {
    await executor.reemitLight(uid);
    publishPolicy(uid);
    scheduleBlockedRetry(uid);
    return;
  }

  scheduleCoalescedProcess(uid);
}

/** Recovery automático (reemit/sparse) — enfileira em vez de restart direto. */
export function enqueueAutomatedPhoneFullSync(ownerUid: string, source: string): void {
  const uid = uidNorm(ownerUid);
  if (!uid) return;
  enqueue(uid, 'phone_full', source);
  publishPolicy(uid);
  if (!executor) return;
  void resolveChipPhoneSyncBlocked(uid);
  void (async () => {
    if (await isPhoneFullBlocked(uid)) {
      scheduleBlockedRetry(uid);
      return;
    }
    if (executor!.isCampaignBlocking(uid) || executor!.isWarmupBlocking?.(uid)) {
      scheduleBlockedRetry(uid);
      return;
    }
    scheduleCoalescedProcess(uid);
  })();
}

export function notifyCampaignBlocking(ownerUid: string, blocking: boolean): void {
  const uid = uidNorm(ownerUid);
  if (!uid || !executor) return;
  publishPolicy(uid);
  if (!blocking) {
    if (queueByOwner.has(uid) || getGoHistorySyncOpsForOwner(uid, maxConcurrentPerOwner).deferredPostCampaign) {
      scheduleCoalescedProcess(uid, 2_000);
    }
  }
}

/** Campanha terminou — fila pós-disparo com atraso configurável. */
export function onCampaignEnded(ownerUid: string): void {
  const uid = uidNorm(ownerUid);
  if (!uid) return;
  notifyCampaignBlocking(uid, false);
  schedulePostCampaignInboxSync(uid, async () => {
    enqueue(uid, 'phone_full', 'post_campaign');
    await drainOwnerQueue(uid);
  });
}

export function getInboxSyncOpsExtras(ownerUid: string): {
  queuePending: boolean;
  policy: InboxSyncPolicyPayload;
} {
  const uid = uidNorm(ownerUid);
  return {
    queuePending: getInboxSyncQueueDepth(uid) > 0,
    policy: buildInboxSyncPolicy(uid),
  };
}

let sweepStarted = false;
export function startInboxSyncOrchestratorSweep(): void {
  if (sweepStarted) return;
  sweepStarted = true;
  setInterval(() => {
    for (const uid of queueByOwner.keys()) {
      void drainOwnerQueue(uid).catch(() => undefined);
    }
  }, DRAIN_SWEEP_MS);
}
