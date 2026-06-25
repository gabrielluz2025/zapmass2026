import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getEvolutionPool } from './db/postgres.js';

export type VpsHealthSnapshot = {
  at: string;
  source?: string;
  ok: boolean;
  issueCount: number;
  fixCount: number;
  evolutionRecovered?: boolean;
  load1: number;
  load15: number;
  cpus: number;
  diskPct: number;
  diskFree: string;
  evolutionUp: boolean;
  indexOk: boolean;
  healthHttp: number;
  postgresCpuPct: number | null;
  containers: { name: string; up: boolean }[];
  alerts: string[];
  cronSchedule: string;
  cronMarker: string;
};

export type VpsMaintenanceAlert = {
  level: 'warn' | 'critical';
  code: string;
  message: string;
};

const LOAD_ALERT = Number(process.env.VPS_LOAD_ALERT_THRESHOLD || 4);
const PG_CPU_ALERT = Number(process.env.VPS_PG_CPU_ALERT_PCT || 80);
const SNAPSHOT_STALE_MS = 8 * 24 * 60 * 60 * 1000;

const HEALTH_PATHS = [
  process.env.VPS_HEALTH_JSON_PATH?.trim(),
  '/app/data/vps-health.json',
  path.join(process.cwd(), 'data', 'vps-health.json')
].filter(Boolean) as string[];

export const VPS_MAINTENANCE_META = {
  incidentNote: 'Incidente de performance encerrado (24/jun/2026). Pode operar normalmente.',
  automatic: {
    cronName: 'zapmass-monitor-producao',
    schedule: '0 9 * * 1',
    scheduleHuman: 'Segunda-feira, 09:00 UTC',
    logPath: '/var/log/zapmass-monitor.log',
    alertLogPath: '/var/log/zapmass-monitor-alerts.log',
    cronMarker: '/etc/cron.d/zapmass-monitor-producao'
  },
  manual: {
    description: 'Opcional — 1×/semana ou após mudanças na VPS',
    fullMonitor: 'sudo bash /opt/zapmass/deployment/vps-monitor-producao.sh',
    quickCheck:
      "uptime && docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}' && docker exec zapmass-postgres-1 psql -U postgres -d evolution_db -tAc \"SELECT 'indice OK' FROM pg_indexes WHERE indexname='idx_message_instance_remote_jid_ts';\""
  },
  alertRules: [
    `Load 1 min > ${LOAD_ALERT}`,
    `Postgres CPU > ${PG_CPU_ALERT}% com Evolution Up (medido no check semanal/manual)`,
    'Índice idx_message_instance_remote_jid_ts ausente'
  ],
  targets: {
    load15Ideal: 2.5,
    postgresCpuNormal: 50
  }
};

export async function readVpsHealthSnapshot(): Promise<VpsHealthSnapshot | null> {
  for (const p of HEALTH_PATHS) {
    try {
      const raw = await fs.readFile(p, 'utf8');
      const parsed = JSON.parse(raw) as VpsHealthSnapshot;
      if (parsed?.at) return parsed;
    } catch {
      /* try next path */
    }
  }
  return null;
}

export async function checkEvolutionIndexLive(): Promise<boolean | null> {
  const pool = getEvolutionPool();
  if (!pool) return null;
  try {
    const r = await pool.query<{ ok: string }>(
      `SELECT 1 AS ok FROM pg_indexes WHERE indexname = 'idx_message_instance_remote_jid_ts' LIMIT 1`
    );
    return r.rows.length > 0;
  } catch {
    return null;
  }
}

export function buildVpsMaintenanceAlerts(input: {
  load1: number;
  snapshot: VpsHealthSnapshot | null;
  indexOkLive: boolean | null;
}): VpsMaintenanceAlert[] {
  const alerts: VpsMaintenanceAlert[] = [];
  const { load1, snapshot, indexOkLive } = input;

  if (load1 > LOAD_ALERT) {
    alerts.push({
      level: 'critical',
      code: 'load',
      message: `Load 1 min elevado: ${load1.toFixed(2)} (limite ${LOAD_ALERT})`
    });
  }

  if (snapshot?.evolutionUp && snapshot.postgresCpuPct != null && snapshot.postgresCpuPct > PG_CPU_ALERT) {
    alerts.push({
      level: 'critical',
      code: 'postgres_cpu',
      message: `Postgres CPU ${snapshot.postgresCpuPct.toFixed(1)}% com Evolution Up (limite ${PG_CPU_ALERT}%) — último check ${formatWhen(snapshot.at)}`
    });
  }

  if (indexOkLive === false || snapshot?.indexOk === false) {
    alerts.push({
      level: 'critical',
      code: 'index',
      message: 'Índice idx_message_instance_remote_jid_ts ausente — risco de load alto no Postgres'
    });
  }

  if (snapshot && !snapshot.ok && snapshot.alerts.length > 0) {
    const evolutionRecovered =
      snapshot.evolutionRecovered === true ||
      (snapshot.fixCount > 0 && snapshot.containers.some((c) => c.name === 'zapmass-evolution-1' && c.up));
    for (const msg of snapshot.alerts.slice(0, 5)) {
      if (evolutionRecovered && /evolution-1.*não está up/i.test(msg)) continue;
      if (alerts.some((a) => a.message === msg)) continue;
      alerts.push({
        level: 'warn',
        code: 'snapshot',
        message: `${msg} (check ${formatWhen(snapshot.at)})`
      });
    }
  }

  return alerts;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) + ' UTC';
  } catch {
    return iso;
  }
}

export function resolveOperatingStatus(
  alerts: VpsMaintenanceAlert[],
  snapshot: VpsHealthSnapshot | null,
  indexOkLive: boolean | null
): 'normal' | 'alert' | 'unknown' {
  if (alerts.length > 0) return 'alert';
  if (snapshot || indexOkLive !== null) return 'normal';
  return 'unknown';
}

export function snapshotAgeMs(snapshot: VpsHealthSnapshot | null): number | null {
  if (!snapshot?.at) return null;
  const t = Date.parse(snapshot.at);
  if (Number.isNaN(t)) return null;
  return Date.now() - t;
}

export async function buildVpsMaintenancePayload(): Promise<{
  ok: true;
  at: string;
  operatingStatus: 'normal' | 'alert' | 'unknown';
  incidentNote: string;
  maintenance: typeof VPS_MAINTENANCE_META;
  lastSnapshot: VpsHealthSnapshot | null;
  snapshotStale: boolean;
  snapshotAgeHours: number | null;
  live: {
    load1: number;
    load5: number;
    load15: number;
    cpus: number;
    indexOk: boolean | null;
  };
  alerts: VpsMaintenanceAlert[];
}> {
  const [load1, load5, load15] = os.loadavg();
  const cpus = os.cpus().length || 1;
  const snapshot = await readVpsHealthSnapshot();
  const indexOkLive = await checkEvolutionIndexLive();
  const alerts = buildVpsMaintenanceAlerts({ load1, snapshot, indexOkLive });
  const ageMs = snapshotAgeMs(snapshot);

  return {
    ok: true,
    at: new Date().toISOString(),
    operatingStatus: resolveOperatingStatus(alerts, snapshot, indexOkLive),
    incidentNote: VPS_MAINTENANCE_META.incidentNote,
    maintenance: VPS_MAINTENANCE_META,
    lastSnapshot: snapshot,
    snapshotStale: ageMs != null ? ageMs > SNAPSHOT_STALE_MS : !snapshot,
    snapshotAgeHours: ageMs != null ? Math.round(ageMs / 3_600_000) : null,
    live: {
      load1,
      load5,
      load15,
      cpus,
      indexOk: indexOkLive
    },
    alerts
  };
}
