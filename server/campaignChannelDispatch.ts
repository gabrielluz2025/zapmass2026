/**
 * Isolamento por chip: limite de envios ativos simultâneos e vagas "quentes" na fila BullMQ
 * agregadas entre campanhas (não só janela por campanha na largada).
 */
import type Redis from 'ioredis';
import { CAMPAIGN_CHANNEL_WINDOW } from './campaignDispatchWindow.js';

const SEND_ACTIVE_PREFIX = 'zapmass:chan-send-active:';
const HOT_SLOTS_PREFIX = 'zapmass:chan-hot-slots:';
const HOLD_RR_PREFIX = 'zapmass:camp-hold-rr:';
const KEY_TTL_SEC = 6 * 3600;

const memActive = new Map<string, Set<string>>();
const memHot = new Map<string, number>();

export function getChannelActiveSendLimit(): number {
  const raw = parseInt(process.env.CAMPAIGN_CHANNEL_ACTIVE_LIMIT || '1', 10);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(4, raw));
}

export function getChannelHotSlotLimit(): number {
  const raw = parseInt(process.env.CAMPAIGN_CHANNEL_HOT_SLOTS || String(CAMPAIGN_CHANNEL_WINDOW), 10);
  if (!Number.isFinite(raw)) return CAMPAIGN_CHANNEL_WINDOW;
  return Math.max(1, Math.min(8, raw));
}

function normConn(connectionId: string): string {
  return String(connectionId || '').trim();
}

function sendKey(connectionId: string): string {
  return SEND_ACTIVE_PREFIX + normConn(connectionId);
}

function hotKey(connectionId: string): string {
  return HOT_SLOTS_PREFIX + normConn(connectionId);
}

const ACQUIRE_SEND_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local lease = ARGV[2]
local ttl = tonumber(ARGV[3])
if redis.call('HEXISTS', key, lease) == 1 then return 1 end
local n = redis.call('HLEN', key)
if n >= limit then return 0 end
redis.call('HSET', key, lease, '1')
redis.call('EXPIRE', key, ttl)
return 1
`;

const RELEASE_SEND_LUA = `
local key = KEYS[1]
local lease = ARGV[1]
redis.call('HDEL', key, lease)
if redis.call('HLEN', key) == 0 then redis.call('DEL', key) end
return 1
`;

const RESERVE_HOT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local cur = tonumber(redis.call('GET', key) or '0')
if cur >= limit then return 0 end
local next = redis.call('INCR', key)
redis.call('EXPIRE', key, ttl)
if next > limit then
  redis.call('DECR', key)
  return 0
end
return 1
`;

export async function tryAcquireChannelSendSlot(
  redis: Redis | null | undefined,
  connectionId: string,
  leaseId: string
): Promise<boolean> {
  const conn = normConn(connectionId);
  const lease = String(leaseId || '').trim();
  if (!conn || !lease) return true;

  const limit = getChannelActiveSendLimit();
  if (redis) {
    const ok = (await redis.eval(
      ACQUIRE_SEND_LUA,
      1,
      sendKey(conn),
      String(limit),
      lease,
      String(KEY_TTL_SEC)
    )) as number;
    return ok === 1;
  }

  let set = memActive.get(conn);
  if (!set) {
    set = new Set();
    memActive.set(conn, set);
  }
  if (set.has(lease)) return true;
  if (set.size >= limit) return false;
  set.add(lease);
  return true;
}

export async function releaseChannelSendSlot(
  redis: Redis | null | undefined,
  connectionId: string,
  leaseId: string
): Promise<void> {
  const conn = normConn(connectionId);
  const lease = String(leaseId || '').trim();
  if (!conn || !lease) return;

  if (redis) {
    await redis.eval(RELEASE_SEND_LUA, 1, sendKey(conn), lease).catch(() => undefined);
    return;
  }
  memActive.get(conn)?.delete(lease);
}

/** Reserva vaga quente global por chip (massa de campanha). */
export async function tryReserveChannelHotSlot(
  redis: Redis | null | undefined,
  connectionId: string
): Promise<boolean> {
  const conn = normConn(connectionId);
  if (!conn) return true;

  const limit = getChannelHotSlotLimit();
  if (redis) {
    const ok = (await redis.eval(
      RESERVE_HOT_LUA,
      1,
      hotKey(conn),
      String(limit),
      String(KEY_TTL_SEC)
    )) as number;
    return ok === 1;
  }

  const cur = memHot.get(conn) || 0;
  if (cur >= limit) return false;
  memHot.set(conn, cur + 1);
  return true;
}

export async function releaseChannelHotSlot(
  redis: Redis | null | undefined,
  connectionId: string
): Promise<void> {
  const conn = normConn(connectionId);
  if (!conn) return;

  if (redis) {
    const key = hotKey(conn);
    const v = await redis.decr(key);
    if (v < 0) await redis.set(key, '0', 'EX', KEY_TTL_SEC);
    return;
  }
  memHot.set(conn, Math.max(0, (memHot.get(conn) || 0) - 1));
}

/** Alinha contador Redis com jobs reais na BullMQ (evita deadlock após restart/deploy). */
export async function reconcileChannelHotSlotCounter(
  redis: Redis | null | undefined,
  connectionId: string,
  queueDepth: number
): Promise<void> {
  const conn = normConn(connectionId);
  if (!conn) return;
  const limit = getChannelHotSlotLimit();
  const depth = Math.max(0, Math.round(queueDepth));
  const normalized = Math.min(limit, depth);
  if (redis) {
    await redis.set(hotKey(conn), String(normalized), 'EX', KEY_TTL_SEC);
    return;
  }
  memHot.set(conn, normalized);
}

/** Round-robin estável entre campanhas no mesmo chip ao promover held. */
export function pickFairHeldCampaignRoundRobin(
  campaignIds: string[],
  previousIndex: number
): { order: string[]; nextIndex: number } {
  const sorted = [...new Set(campaignIds.map((id) => String(id || '').trim()).filter(Boolean))].sort();
  if (sorted.length === 0) return { order: [], nextIndex: 0 };
  const start = ((previousIndex % sorted.length) + sorted.length) % sorted.length;
  const order = [...sorted.slice(start), ...sorted.slice(0, start)];
  return { order, nextIndex: (start + 1) % sorted.length };
}

export function holdRoundRobinKey(connectionId: string): string {
  return HOLD_RR_PREFIX + normConn(connectionId);
}
