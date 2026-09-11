import axios from 'axios';
import type IORedis from 'ioredis';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getSharedRedis } from './redisShared.js';
import { emitAntiBanAlert } from './antiBanProactiveNotifications.js';

export type ConnectionProxyConfig = {
  host: string;
  port: string | number;
  protocol?: 'http' | 'https' | 'socks4' | 'socks5';
  username?: string;
  password?: string;
};

export type ProxyHealthStatus = 'OK' | 'PROXY_DOWN' | 'DATACENTER' | 'DRIFT' | 'UNKNOWN';

export type ProxyCheckResult = {
  ok: boolean;
  egressIp?: string;
  isp?: string;
  asLabel?: string;
  isDatacenter?: boolean;
  latencyMs?: number;
  driftDetected?: boolean;
  error?: string;
};

export type ProxyHealthSnapshot = {
  status: ProxyHealthStatus;
  egressIp?: string;
  isp?: string;
  asLabel?: string;
  isDatacenter?: boolean;
  latencyMs?: number;
  driftDetected?: boolean;
  checkedAt?: number;
  error?: string;
};

const STATUS_KEY_PREFIX = 'zapmass:proxy:status:';
const EGRESS_KEY_PREFIX = 'zapmass:proxy:egress:';
const STICKY_IP_KEY_PREFIX = 'zapmass:proxy:sticky:';
const LAST_CHECK_KEY_PREFIX = 'zapmass:proxy:last_check:';

const STICKY_LOCK_DAYS = Number(process.env.PROXY_STICKY_LOCK_DAYS ?? 7);
const CHECK_TIMEOUT_MS = Number(process.env.PROXY_CHECK_TIMEOUT_MS ?? 5000);
const STATUS_TTL_SEC = 86400;

const DC_PATTERNS = [
  /amazon/i,
  /aws/i,
  /hetzner/i,
  /digital\s*ocean/i,
  /linode/i,
  /akamai/i,
  /google cloud/i,
  /microsoft/i,
  /azure/i,
  /ovh/i,
  /vultr/i,
  /hostinger/i,
  /contabo/i,
];

const proxyHealthByConnection = new Map<string, ProxyHealthSnapshot>();

export function buildProxyUrl(proxy: ConnectionProxyConfig): string {
  const protocol = proxy.protocol || 'http';
  const auth =
    proxy.username && String(proxy.username).trim()
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
      : '';
  return `${protocol}://${auth}${proxy.host}:${proxy.port}`;
}

export function isDatacenterEgress(data: {
  hosting?: boolean;
  as?: string;
  isp?: string;
  org?: string;
}): boolean {
  if (data.hosting === true) return true;
  const blob = `${data.as || ''} ${data.isp || ''} ${data.org || ''}`;
  return DC_PATTERNS.some((pattern) => pattern.test(blob));
}

export function getProxyHealthSnapshot(connectionId: string): ProxyHealthSnapshot | null {
  const id = String(connectionId || '').trim();
  if (!id) return null;
  return proxyHealthByConnection.get(id) ?? null;
}

export function isProxyDispatchBlocked(connectionId: string): boolean {
  const snap = getProxyHealthSnapshot(connectionId);
  return snap?.status === 'PROXY_DOWN';
}

export function getProxyEditLock(params: {
  connectedSinceMs?: number | null;
  hasProxy: boolean;
}): { locked: boolean; reason?: string; daysLeft?: number } {
  if (!params.hasProxy) return { locked: false };
  const since = params.connectedSinceMs;
  if (!since || since <= 0) return { locked: false };
  const minAgeMs = STICKY_LOCK_DAYS * 86_400_000;
  const ageMs = Date.now() - since;
  if (ageMs >= minAgeMs) return { locked: false };
  const daysLeft = Math.max(1, Math.ceil((minAgeMs - ageMs) / 86_400_000));
  return {
    locked: true,
    daysLeft,
    reason: `Proxy bloqueado por governança sticky: chip com menos de ${STICKY_LOCK_DAYS} dias neste IP. Aguarde ${daysLeft} dia(s).`,
  };
}

export async function assertProxyEditAllowed(
  connectionId: string,
  connectedSinceMs: number | undefined | null,
  hasProxy: boolean
): Promise<void> {
  const lock = getProxyEditLock({ connectedSinceMs, hasProxy });
  if (lock.locked) {
    throw new Error(lock.reason || 'Edição de proxy bloqueada temporariamente.');
  }
}

function statusKey(connectionId: string): string {
  return `${STATUS_KEY_PREFIX}${connectionId}`;
}

function egressKey(connectionId: string): string {
  return `${EGRESS_KEY_PREFIX}${connectionId}`;
}

function stickyKey(connectionId: string): string {
  return `${STICKY_IP_KEY_PREFIX}${connectionId}`;
}

function lastCheckKey(connectionId: string): string {
  return `${LAST_CHECK_KEY_PREFIX}${connectionId}`;
}

function setMemorySnapshot(connectionId: string, snap: ProxyHealthSnapshot): void {
  proxyHealthByConnection.set(connectionId, snap);
}

async function persistSnapshot(redis: IORedis, connectionId: string, snap: ProxyHealthSnapshot): Promise<void> {
  await redis.set(statusKey(connectionId), snap.status, 'EX', STATUS_TTL_SEC);
  await redis.set(
    egressKey(connectionId),
    JSON.stringify({
      egressIp: snap.egressIp,
      isp: snap.isp,
      asLabel: snap.asLabel,
      isDatacenter: snap.isDatacenter,
      latencyMs: snap.latencyMs,
      driftDetected: snap.driftDetected,
      checkedAt: snap.checkedAt,
      error: snap.error,
    }),
    'EX',
    STATUS_TTL_SEC
  );
  await redis.set(lastCheckKey(connectionId), String(snap.checkedAt || Date.now()), 'EX', STATUS_TTL_SEC);
}

export async function hydrateProxyHealthFromRedis(connectionIds: string[]): Promise<void> {
  const redis = getSharedRedis();
  if (!redis) return;
  for (const rawId of connectionIds) {
    const connectionId = String(rawId || '').trim();
    if (!connectionId) continue;
    const [statusRaw, egressRaw] = await Promise.all([
      redis.get(statusKey(connectionId)),
      redis.get(egressKey(connectionId)),
    ]);
    if (!statusRaw) continue;
    let meta: Record<string, unknown> = {};
    if (egressRaw) {
      try {
        meta = JSON.parse(egressRaw) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    }
    setMemorySnapshot(connectionId, {
      status: statusRaw as ProxyHealthStatus,
      egressIp: typeof meta.egressIp === 'string' ? meta.egressIp : undefined,
      isp: typeof meta.isp === 'string' ? meta.isp : undefined,
      asLabel: typeof meta.asLabel === 'string' ? meta.asLabel : undefined,
      isDatacenter: meta.isDatacenter === true,
      latencyMs: typeof meta.latencyMs === 'number' ? meta.latencyMs : undefined,
      driftDetected: meta.driftDetected === true,
      checkedAt: typeof meta.checkedAt === 'number' ? meta.checkedAt : undefined,
      error: typeof meta.error === 'string' ? meta.error : undefined,
    });
  }
}

export async function clearProxyHealthState(connectionId: string): Promise<void> {
  const id = String(connectionId || '').trim();
  if (!id) return;
  proxyHealthByConnection.delete(id);
  const redis = getSharedRedis();
  if (!redis) return;
  await redis.del(statusKey(id), egressKey(id), stickyKey(id), lastCheckKey(id));
}

export async function testProxyEgress(proxyUrl: string): Promise<ProxyCheckResult> {
  const startTime = Date.now();
  const agent = proxyUrl.startsWith('socks')
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);

  try {
    const response = await axios.get(
      'http://ip-api.com/json/?fields=status,message,query,isp,org,as,mobile,proxy,hosting',
      {
        httpAgent: agent,
        httpsAgent: agent,
        timeout: CHECK_TIMEOUT_MS,
        validateStatus: () => true,
      }
    );

    const latencyMs = Date.now() - startTime;
    const data = response.data as {
      status?: string;
      message?: string;
      query?: string;
      isp?: string;
      org?: string;
      as?: string;
      hosting?: boolean;
    };

    if (data.status !== 'success') {
      return { ok: false, error: data.message || 'Falha no ip-api', latencyMs };
    }

    const isDatacenter = isDatacenterEgress(data);
    return {
      ok: true,
      egressIp: data.query,
      isp: data.isp || data.org,
      asLabel: data.as,
      isDatacenter,
      latencyMs,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Timeout/Connection error',
      latencyMs: Date.now() - startTime,
    };
  }
}

export async function runProxyHealthCheck(params: {
  connectionId: string;
  proxy: ConnectionProxyConfig;
  ownerUid?: string;
  connectedSinceMs?: number | null;
}): Promise<ProxyHealthSnapshot> {
  const connectionId = String(params.connectionId || '').trim();
  const ownerUid = String(params.ownerUid || '').trim();
  const proxyUrl = buildProxyUrl(params.proxy);
  const checkedAt = Date.now();

  const result = await testProxyEgress(proxyUrl);
  const redis = getSharedRedis();

  if (!result.ok || (result.latencyMs != null && result.latencyMs > CHECK_TIMEOUT_MS)) {
    const snap: ProxyHealthSnapshot = {
      status: 'PROXY_DOWN',
      latencyMs: result.latencyMs,
      checkedAt,
      error: result.error || 'Proxy timeout',
    };
    setMemorySnapshot(connectionId, snap);
    if (redis) await persistSnapshot(redis, connectionId, snap);
    if (ownerUid) {
      await emitAntiBanAlert(ownerUid, 'proxy-down', {
        connectionId,
        error: snap.error,
      });
    }
    return snap;
  }

  let driftDetected = false;
  if (redis && result.egressIp) {
    const stickyIp = await redis.get(stickyKey(connectionId));
    if (!stickyIp) {
      await redis.set(stickyKey(connectionId), result.egressIp, 'EX', 30 * 86400);
    } else if (stickyIp !== result.egressIp) {
      driftDetected = true;
      if (ownerUid) {
        await emitAntiBanAlert(ownerUid, 'proxy-egress-drift', {
          connectionId,
          previousIp: stickyIp,
          egressIp: result.egressIp,
        });
      }
    }
  }

  let status: ProxyHealthStatus = 'OK';
  if (result.isDatacenter) status = 'DATACENTER';
  else if (driftDetected) status = 'DRIFT';

  const snap: ProxyHealthSnapshot = {
    status,
    egressIp: result.egressIp,
    isp: result.isp,
    asLabel: result.asLabel,
    isDatacenter: result.isDatacenter,
    latencyMs: result.latencyMs,
    driftDetected,
    checkedAt,
  };

  setMemorySnapshot(connectionId, snap);
  if (redis) await persistSnapshot(redis, connectionId, snap);

  if (ownerUid && result.isDatacenter) {
    await emitAntiBanAlert(ownerUid, 'proxy-datacenter-risk', {
      connectionId,
      egressIp: result.egressIp,
      isp: result.isp,
      asLabel: result.asLabel,
    });
  }

  return snap;
}
