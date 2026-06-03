/**
 * Métricas operacionais do bate-papo (Prometheus + health/deep).
 */
import client from 'prom-client';

const inboxSyncDuration = new client.Histogram({
  name: 'zapmass_inbox_sync_duration_ms',
  help: 'Duração de request-conversations-sync (ms)',
  labelNames: ['full'],
  buckets: [25, 100, 500, 2000, 8000, 20000, 60000, 120000],
});

const evolutionWebhookLag = new client.Histogram({
  name: 'zapmass_evolution_webhook_queue_lag_ms',
  help: 'Lag entre receção HTTP do webhook e início do worker (ms)',
  buckets: [10, 50, 200, 1000, 3000, 8000, 20000, 60000],
});

const evolutionWebhookProcessed = new client.Counter({
  name: 'zapmass_evolution_webhook_jobs_total',
  help: 'Jobs da fila evolution-webhook processados',
  labelNames: ['result'],
});

const evolutionWebhookQueueDepth = new client.Gauge({
  name: 'zapmass_evolution_webhook_queue_depth',
  help: 'Jobs na fila evolution-webhook (waiting + delayed)',
  labelNames: ['state'],
});

let lastInboxSyncLightMs = 0;
let lastInboxSyncFullMs = 0;

export function registerChatOpsMetrics(register: client.Registry): void {
  register.registerMetric(inboxSyncDuration);
  register.registerMetric(evolutionWebhookLag);
  register.registerMetric(evolutionWebhookProcessed);
  register.registerMetric(evolutionWebhookQueueDepth);
}

export function recordInboxSyncDuration(ms: number, full: boolean): void {
  const n = Math.max(0, Number(ms) || 0);
  if (full) lastInboxSyncFullMs = n;
  else lastInboxSyncLightMs = n;
  inboxSyncDuration.observe({ full: full ? 'true' : 'false' }, n);
}

export function recordEvolutionWebhookLagMs(lagMs: number): void {
  const n = Math.max(0, Number(lagMs) || 0);
  evolutionWebhookLag.observe(n);
}

export function markEvolutionWebhookJobProcessed(ok: boolean): void {
  evolutionWebhookProcessed.labels(ok ? 'ok' : 'error').inc();
}

export function setEvolutionWebhookQueueDepth(counts: {
  waiting?: number;
  active?: number;
  delayed?: number;
  failed?: number;
}): void {
  evolutionWebhookQueueDepth.labels('waiting').set(Math.max(0, counts.waiting ?? 0));
  evolutionWebhookQueueDepth.labels('active').set(Math.max(0, counts.active ?? 0));
  evolutionWebhookQueueDepth.labels('delayed').set(Math.max(0, counts.delayed ?? 0));
  evolutionWebhookQueueDepth.labels('failed').set(Math.max(0, counts.failed ?? 0));
}

export function getChatOpsMetricsSnapshot() {
  return {
    inboxSyncLastLightMs: lastInboxSyncLightMs,
    inboxSyncLastFullMs: lastInboxSyncFullMs,
  };
}
