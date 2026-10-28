import type IORedis from 'ioredis';
import {
  defaultInboxWebhookHealth,
  type InboxWebhookHealthPayload,
  type InboxWebhookHealthStatus,
} from '../shared/inboxWebhookHealth.js';
import { isEvolutionGoEngine } from './evolutionConfig.js';

export type WebhookActivityKind = 'inbox' | 'connection' | 'other';

type ConnectionActivity = {
  lastAnyMs: number;
  lastInboxMs: number;
};

const mem = new Map<string, ConnectionActivity>();

/** Após re-registrar webhook, UI fica em “aguardando” em vez de loop “reparando”. */
const WEBHOOK_REPAIR_GRACE_MS = Math.max(
  20 * 60_000,
  parseHoursEnv('GO_WEBHOOK_REPAIR_GRACE_MINUTES', 90) * 60_000
);

const webhookRepairAt = new Map<string, number>();

const REDIS_KEY_PREFIX = 'zapmass:evo:wh:last:';
const REDIS_REPAIR_PREFIX = 'zapmass:evo:wh:repair:';
const REDIS_TTL_SEC = 30 * 24 * 3600;

function parseHoursEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Sem MESSAGES_UPSERT/HistorySync neste intervalo → re-registrar webhook (Go). */
export const WEBHOOK_INBOX_STALE_MS =
  parseHoursEnv('GO_WEBHOOK_INBOX_STALE_HOURS', 6) * 3600_000;

/** Chip open sem nenhum webhook de inbox — grace após conectar. */
const OPEN_GRACE_MS = Math.max(
  5 * 60_000,
  parseHoursEnv('GO_WEBHOOK_OPEN_GRACE_MINUTES', 45) * 60_000
);

/** UI: “aguardando mensagens” se inbox quieto mas chip online. */
export const WEBHOOK_UI_WAITING_MS = 2 * 3600_000;

const SWEEP_INTERVAL_MS = 15 * 60_000;

let redisGetter: (() => IORedis | null) | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function bindEvolutionWebhookHealthRedis(getConn: () => IORedis | null): void {
  redisGetter = getConn;
}

function redisKey(connectionId: string): string {
  return `${REDIS_KEY_PREFIX}${connectionId}`;
}

async function persistActivity(connectionId: string, row: ConnectionActivity): Promise<void> {
  const conn = redisGetter?.();
  if (!conn) return;
  try {
    await conn.set(
      redisKey(connectionId),
      JSON.stringify({ lastAnyMs: row.lastAnyMs, lastInboxMs: row.lastInboxMs }),
      'EX',
      REDIS_TTL_SEC
    );
  } catch {
    /* best-effort */
  }
}

export async function hydrateWebhookActivityFromRedis(connectionId: string): Promise<void> {
  const conn = redisGetter?.();
  if (!conn || mem.has(connectionId)) return;
  try {
    const raw = await conn.get(redisKey(connectionId));
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<ConnectionActivity>;
    if (
      typeof parsed.lastAnyMs === 'number' &&
      typeof parsed.lastInboxMs === 'number'
    ) {
      mem.set(connectionId, {
        lastAnyMs: parsed.lastAnyMs,
        lastInboxMs: parsed.lastInboxMs,
      });
    }
  } catch {
    /* ignore */
  }
}

export function recordEvolutionWebhookActivity(
  connectionId: string,
  kind: WebhookActivityKind
): void {
  const id = String(connectionId || '').trim();
  if (!id) return;
  const now = Date.now();
  const prev = mem.get(id) ?? { lastAnyMs: 0, lastInboxMs: 0 };
  const next: ConnectionActivity = {
    lastAnyMs: now,
    lastInboxMs: kind === 'inbox' ? now : prev.lastInboxMs,
  };
  mem.set(id, next);
  void persistActivity(id, next);
}

export function classifyWebhookEventKind(eventNameUpper: string): WebhookActivityKind {
  const ev = String(eventNameUpper || '').toUpperCase().replace(/\./g, '_');
  if (
    ev === 'MESSAGES_UPSERT' ||
    ev === 'MESSAGES_UPDATE' ||
    ev === 'MESSAGES_SET' ||
    ev === 'PRESENCE_UPDATE' ||
    ev === 'HISTORY_SYNC' ||
    ev === 'CHATS_UPSERT' ||
    ev === 'CHATS_UPDATE'
  ) {
    return 'inbox';
  }
  if (ev === 'CONNECTION_UPDATE' || ev === 'QRCODE_UPDATED') {
    return 'connection';
  }
  return 'other';
}

/** Chamado após POST /instance/connect reaplicar webhookUrl (Go). */
export async function markEvolutionWebhookRepairAttempt(connectionId: string): Promise<void> {
  const id = String(connectionId || '').trim();
  if (!id) return;
  const now = Date.now();
  webhookRepairAt.set(id, now);
  const conn = redisGetter?.();
  if (!conn) return;
  try {
    await conn.set(`${REDIS_REPAIR_PREFIX}${id}`, String(now), 'EX', REDIS_TTL_SEC);
  } catch {
    /* best-effort */
  }
}

async function readWebhookRepairAt(connectionId: string): Promise<number> {
  const id = String(connectionId || '').trim();
  const memVal = webhookRepairAt.get(id);
  if (memVal) return memVal;
  const conn = redisGetter?.();
  if (!conn) return 0;
  try {
    const raw = await conn.get(`${REDIS_REPAIR_PREFIX}${id}`);
    if (!raw) return 0;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      webhookRepairAt.set(id, n);
      return n;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

export function isWebhookRepairGraceActive(connectionId: string, now = Date.now()): boolean {
  const at = webhookRepairAt.get(String(connectionId || '').trim()) ?? 0;
  return at > 0 && now - at < WEBHOOK_REPAIR_GRACE_MS;
}

export function getConnectionWebhookActivity(connectionId: string): ConnectionActivity | null {
  return mem.get(String(connectionId || '').trim()) ?? null;
}

/** Diagnóstico admin / export bundle. */
export function snapshotAllWebhookActivity(): Record<
  string,
  { lastAnyMs: number; lastInboxMs: number }
> {
  const out: Record<string, { lastAnyMs: number; lastInboxMs: number }> = {};
  for (const [id, row] of mem.entries()) {
    out[id] = { ...row };
  }
  return out;
}

function resolveStatus(
  openChips: number,
  lastInboxMs: number,
  lastAnyMs: number,
  hasStaleChip: boolean,
  engine: string,
  repairGraceActive: boolean
): InboxWebhookHealthStatus {
  if (engine !== 'evolution-go') return 'n/a';
  if (openChips <= 0) return 'ok';
  const now = Date.now();
  if (lastInboxMs > 0 && now - lastInboxMs < WEBHOOK_UI_WAITING_MS) return 'ok';
  if (lastAnyMs > 0 && now - lastAnyMs < 45 * 60_000) return 'ok';
  if (hasStaleChip && repairGraceActive) return 'waiting';
  if (hasStaleChip) return 'stale';
  return 'waiting';
}

export async function buildInboxWebhookHealthForOwner(
  ownerUid: string,
  openConnections: Array<{ id: string; lastOpenAt?: number }>,
  engine: string
): Promise<InboxWebhookHealthPayload> {
  const uid = String(ownerUid || '').trim();
  if (!uid) return defaultInboxWebhookHealth(engine);

  let lastInboxMs = 0;
  let lastAnyMs = 0;
  const staleConnectionIds: string[] = [];
  let repairGraceActive = false;
  const now = Date.now();

  for (const conn of openConnections) {
    const row = mem.get(conn.id);
    if (row?.lastInboxMs) lastInboxMs = Math.max(lastInboxMs, row.lastInboxMs);
    if (row?.lastAnyMs) lastAnyMs = Math.max(lastAnyMs, row.lastAnyMs);

    const repairedAt = await readWebhookRepairAt(conn.id);
    if (repairedAt > 0 && now - repairedAt < WEBHOOK_REPAIR_GRACE_MS) {
      repairGraceActive = true;
    }

    const openSince = conn.lastOpenAt ?? 0;
    const openAge = openSince > 0 ? now - openSince : OPEN_GRACE_MS + 1;
    const inboxAge = row?.lastInboxMs ? now - row.lastInboxMs : Infinity;
    const inRepairGrace = repairedAt > 0 && now - repairedAt < WEBHOOK_REPAIR_GRACE_MS;
    if (
      isEvolutionGoEngine() &&
      openAge > OPEN_GRACE_MS &&
      inboxAge > WEBHOOK_INBOX_STALE_MS &&
      !inRepairGrace
    ) {
      staleConnectionIds.push(conn.id);
    }
  }

  const status = resolveStatus(
    openConnections.length,
    lastInboxMs,
    lastAnyMs,
    staleConnectionIds.length > 0,
    engine,
    repairGraceActive
  );

  return {
    engine,
    openChips: openConnections.length,
    lastInboxWebhookAt: lastInboxMs > 0 ? new Date(lastInboxMs).toISOString() : null,
    lastAnyWebhookAt: lastAnyMs > 0 ? new Date(lastAnyMs).toISOString() : null,
    status,
    staleConnectionIds: staleConnectionIds.length ? staleConnectionIds : undefined,
  };
}

export type WebhookHealthMonitorDeps = {
  listOpenConnections: () => Array<{ id: string; ownerUid: string; lastOpenAt?: number }>;
  reregisterWebhook: (connectionId: string) => Promise<void>;
  publishOwnerHealth: (ownerUid: string, payload: InboxWebhookHealthPayload) => void;
  engineLabel: () => string;
};

export function startEvolutionWebhookHealthMonitor(deps: WebhookHealthMonitorDeps): void {
  if (sweepTimer) return;
  if (!isEvolutionGoEngine()) return;

  const runSweep = async () => {
    const open = deps.listOpenConnections();
    const byOwner = new Map<string, Array<{ id: string; lastOpenAt?: number }>>();
    const now = Date.now();

    for (const row of open) {
      await hydrateWebhookActivityFromRedis(row.id);
      const activity = mem.get(row.id);
      const openAge =
        row.lastOpenAt && row.lastOpenAt > 0 ? now - row.lastOpenAt : OPEN_GRACE_MS + 1;
      const inboxAge = activity?.lastInboxMs ? now - activity.lastInboxMs : Infinity;

      if (openAge > OPEN_GRACE_MS && inboxAge > WEBHOOK_INBOX_STALE_MS) {
        const repairedAt = await readWebhookRepairAt(row.id);
        const repairCooldown = repairedAt > 0 && now - repairedAt < WEBHOOK_REPAIR_GRACE_MS;
        if (!repairCooldown) {
          await deps.reregisterWebhook(row.id).catch(() => undefined);
        }
      }

      const list = byOwner.get(row.ownerUid) ?? [];
      list.push({ id: row.id, lastOpenAt: row.lastOpenAt });
      byOwner.set(row.ownerUid, list);
    }

    const engine = deps.engineLabel();
    for (const [ownerUid, conns] of byOwner.entries()) {
      const payload = await buildInboxWebhookHealthForOwner(ownerUid, conns, engine);
      deps.publishOwnerHealth(ownerUid, payload);
    }
  };

  void runSweep();
  sweepTimer = setInterval(() => {
    void runSweep();
  }, SWEEP_INTERVAL_MS);
}
