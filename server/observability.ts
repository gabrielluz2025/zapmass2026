import os from 'os';
import client from 'prom-client';
import { getSystemMetrics } from './systemMetricsShared.js';
import { buildAlerts, countAlertLevels, getChannelCapacityHeuristic } from './opsHealth.js';
import { isFirebaseAdminConfigured } from './firebaseAdmin.js';
import { pingFirebaseAdmin } from './firebaseAdminProbe.js';

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'zapmass_' });

const sessionCommandsTotal = new client.Counter({
  name: 'zapmass_session_commands_total',
  help: 'Total de comandos publicados no barramento de sessao',
  labelNames: ['type']
});

const sessionCommandResultsTotal = new client.Counter({
  name: 'zapmass_session_command_results_total',
  help: 'Resultado de processamento de comando por worker',
  labelNames: ['status']
});

const connectedSessionsGauge = new client.Gauge({
  name: 'zapmass_connected_sessions',
  help: 'Quantidade de sessoes conectadas atualmente'
});

/** Memoria vista pelo processo (contentor); 0–1 */
const hostMemoryUsedRatio = new client.Gauge({
  name: 'zapmass_host_memory_used_ratio',
  help: 'Ratio memoria usada / total (os.freemem/totalmem) no ambiente do processo'
});

const hostLoad1 = new client.Gauge({ name: 'zapmass_host_load1', help: 'Load average 1 minuto' });
const hostLoad5 = new client.Gauge({ name: 'zapmass_host_load5', help: 'Load average 5 minutos' });
const hostLoad15 = new client.Gauge({ name: 'zapmass_host_load15', help: 'Load average 15 minutos' });
const hostCpuCores = new client.Gauge({ name: 'zapmass_host_cpu_cores', help: 'Numero de CPUs vistas pelo processo' });

/** Nomes distintos das default metrics do prom-client (evita zapmass_process_* duplicado). */
const opsHeapBytes = new client.Gauge({
  name: 'zapmass_ops_heap_bytes',
  help: 'Heap V8 actualizado pelo painel operacional (process.memoryUsage().heapUsed)'
});

const opsResidentBytes = new client.Gauge({
  name: 'zapmass_ops_resident_bytes',
  help: 'RSS actualizado pelo painel operacional (process.memoryUsage().rss)'
});

const firebaseConfiguredGauge = new client.Gauge({
  name: 'zapmass_firebase_admin_configured',
  help: '1 se credenciais Firebase Admin estao presentes'
});

const firebasePingOkGauge = new client.Gauge({
  name: 'zapmass_firebase_admin_ping_ok',
  help: '1 se ultimo ping ao Auth (listUsers) teve sucesso'
});

const firebasePingMsGauge = new client.Gauge({
  name: 'zapmass_firebase_admin_ping_ms',
  help: 'Latencia ms do ultimo ping ao Firebase Auth'
});

const opsAlertsGauge = new client.Gauge({
  name: 'zapmass_ops_alert_count',
  help: 'Contagem de alertas operacionais activos (mesma logica do painel admin)',
  labelNames: ['level']
});

let lastFirebaseProbe: { ok: boolean; ms?: number } = { ok: false };

register.registerMetric(sessionCommandsTotal);
register.registerMetric(sessionCommandResultsTotal);
register.registerMetric(connectedSessionsGauge);
register.registerMetric(hostMemoryUsedRatio);
register.registerMetric(hostLoad1);
register.registerMetric(hostLoad5);
register.registerMetric(hostLoad15);
register.registerMetric(hostCpuCores);
register.registerMetric(opsHeapBytes);
register.registerMetric(opsResidentBytes);
register.registerMetric(firebaseConfiguredGauge);
register.registerMetric(firebasePingOkGauge);
register.registerMetric(firebasePingMsGauge);
register.registerMetric(opsAlertsGauge);

export const markSessionCommandPublished = (type: string) => {
  sessionCommandsTotal.labels(type).inc();
};

export const markSessionCommandResult = (status: 'ok' | 'error') => {
  sessionCommandResultsTotal.labels(status).inc();
};

export const setConnectedSessionsGauge = (value: number) => {
  connectedSessionsGauge.set(Math.max(0, Number(value) || 0));
};

/** Chamado ~60s: ping Firebase e actualiza gauges de Auth (Prometheus + regras de alerta). */
export async function refreshFirebaseProbeForMetrics(): Promise<void> {
  const configured = isFirebaseAdminConfigured();
  firebaseConfiguredGauge.set(configured ? 1 : 0);
  if (!configured) {
    lastFirebaseProbe = { ok: false };
    firebasePingOkGauge.set(0);
    return;
  }
  const r = await pingFirebaseAdmin();
  lastFirebaseProbe = { ok: r.ok, ms: r.ms };
  firebasePingOkGauge.set(r.ok ? 1 : 0);
  if (r.ms != null && Number.isFinite(r.ms)) firebasePingMsGauge.set(r.ms);
}

/**
 * Chamado ~10s com numero de sessoes WA ligadas: actualiza gauges de carga (Prometheus).
 * Nao bloqueia em rede.
 */
export function updateOpsResourceGauges(connectedSessions: number): void {
  const m = getSystemMetrics();
  const tm = os.totalmem();
  const fm = os.freemem();
  const ratio = tm > 0 ? (tm - fm) / tm : 0;
  hostMemoryUsedRatio.set(ratio);

  const [l1, l5, l15] = os.loadavg();
  hostLoad1.set(l1);
  hostLoad5.set(l5);
  hostLoad15.set(l15);
  hostCpuCores.set(os.cpus().length || 1);

  const mem = process.memoryUsage();
  opsHeapBytes.set(mem.heapUsed);
  opsResidentBytes.set(mem.rss);

  const cpus = os.cpus().length || 1;
  const heapMb = Math.round(mem.heapUsed / 1024 / 1024);
  const cap = getChannelCapacityHeuristic(m.ramTotalGb);
  const fbConfigured = isFirebaseAdminConfigured();

  const alerts = buildAlerts({
    ramPct: m.ram,
    load1: l1,
    cpuCount: cpus,
    heapMb,
    firebaseConfigured: fbConfigured,
    firebasePingOk: fbConfigured ? lastFirebaseProbe.ok : true,
    firebaseError: fbConfigured && !lastFirebaseProbe.ok ? 'ping falhou' : undefined,
    connectedSessions,
    safeSessionRef: cap.safe
  });
  const { critical, warn } = countAlertLevels(alerts);
  opsAlertsGauge.labels('critical').set(critical);
  opsAlertsGauge.labels('warn').set(warn);
}

export const metricsContentType = () => register.contentType;

export const collectMetrics = async (): Promise<string> => register.metrics();
