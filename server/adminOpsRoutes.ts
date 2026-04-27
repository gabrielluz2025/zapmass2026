import type { Express, Request, Response } from 'express';
import os from 'os';
import { assertAdminFromBearer } from './adminAuth.js';
import { isFirebaseAdminConfigured } from './firebaseAdmin.js';
import { getSystemMetrics } from './systemMetricsShared.js';
import { getSessionRouterMetrics } from './sessionControlPlane.js';
import * as waService from './whatsappService.js';
import { getChannelCapacityHeuristic, buildAlerts, type AdminOpsAlert } from './opsHealth.js';
import { pingFirebaseAdmin } from './firebaseAdminProbe.js';

const HISTORY_MAX = 288;
const HISTORY_INTERVAL_MS = 5 * 60 * 1000;

export type { AdminOpsAlert, AdminOpsAlertLevel } from './opsHealth.js';

type HistoryPoint = {
  t: number;
  ramPct: number;
  load1: number;
  cpu: number;
  heapMb: number;
};

const opsHistory: HistoryPoint[] = [];

function pushHistorySample(): void {
  const m = getSystemMetrics();
  const [load1] = os.loadavg();
  const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  opsHistory.push({
    t: Date.now(),
    ramPct: m.ram,
    load1,
    cpu: m.cpu,
    heapMb
  });
  while (opsHistory.length > HISTORY_MAX) opsHistory.shift();
}

pushHistorySample();
const histTimer = setInterval(pushHistorySample, HISTORY_INTERVAL_MS);
if (typeof (histTimer as NodeJS.Timeout).unref === 'function') (histTimer as NodeJS.Timeout).unref();

export function registerAdminOpsRoutes(app: Express): void {
  app.get('/api/admin/ops-snapshot', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    const m = getSystemMetrics();
    const [load1, load5, load15] = os.loadavg();
    const cpus = os.cpus().length || 1;
    const mem = process.memoryUsage();
    const heapMb = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMb = Math.round(mem.rss / 1024 / 1024);
    const sessionMetrics = getSessionRouterMetrics();
    const connected = waService
      .getConnections()
      .filter((c) => String(c.status).toUpperCase() === 'CONNECTED').length;
    const cap = getChannelCapacityHeuristic(m.ramTotalGb);

    const fbConfigured = isFirebaseAdminConfigured();
    const fb = await pingFirebaseAdmin();

    const alerts = buildAlerts({
      ramPct: m.ram,
      load1,
      cpuCount: cpus,
      heapMb,
      firebaseConfigured: fbConfigured,
      firebasePingOk: fb.ok,
      firebaseError: !fb.ok ? fb.error : undefined,
      connectedSessions: connected,
      safeSessionRef: cap.safe
    });

    res.json({
      ok: true,
      at: new Date().toISOString(),
      scopeNote:
        'Memoria/CPU vistos pelo processo Node (contentor). Em Docker reflete limites do contentor, nao necessariamente a VPS inteira.',
      system: {
        ...m,
        load1,
        load5,
        load15,
        cpus,
        processHeapMb: heapMb,
        processRssMb: rssMb,
        processUptimeSec: Math.floor(process.uptime())
      },
      sessionRouter: sessionMetrics,
      whatsapp: { connectedSessions: connected, capacityHint: cap },
      firebase: {
        configured: fbConfigured,
        pingOk: fb.ok,
        latencyMs: fb.ms,
        projectId: fb.projectId,
        error: fb.error
      },
      alerts,
      history: opsHistory.map((p) => ({ ...p })),
      historyMeta: { intervalMs: HISTORY_INTERVAL_MS, maxPoints: HISTORY_MAX, windowApproxHours: 24 }
    });
  });
}
