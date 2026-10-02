import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { zapmassAuthProvider } from './auth/authMode.js';
import { zapmassDataProvider } from './auth/dataMode.js';
import { evolutionEngineConfig } from './evolutionEngineConfig.js';
import { listCampaigns } from './repositories/campaignsRepository.js';
import { filterByConnectionScope } from './connectionScopeServer.js';
import * as evolutionService from './evolutionService.js';
import {
  DIAGNOSTICS_BUNDLE_SCHEMA,
  type DiagnosticsBundle,
  sanitizeDiagnosticsRecord,
} from '../shared/diagnosticsBundle.js';
import { listTenantDiagnosticEvents } from './tenantDiagnosticBuffer.js';

function readGitRef(): string {
  const env = String(process.env.GIT_SHA || process.env.GITHUB_SHA || '').trim();
  if (env) return env.slice(0, 12);
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    return fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

function readAppVersion(): string {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    return fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  } catch {
    return process.env.APP_VERSION || 'unknown';
  }
}

function resolveVpsOnlyFlag(): boolean {
  return zapmassAuthProvider() === 'vps' && zapmassDataProvider() === 'vps';
}

export async function buildTenantDiagnosticsExport(
  tenantId: string,
  clientHints?: Record<string, unknown>
): Promise<DiagnosticsBundle> {
  const tid = String(tenantId || '').trim();
  const campaignsDb = await listCampaigns(tid).catch(() => []);
  const runtime = evolutionService.getTenantCampaignRuntimeSnapshots(tid);
  const queueJobsByCampaign = await evolutionService.collectTenantCampaignQueueJobCounts(tid).catch(
    () => new Map<string, number>()
  );

  const runtimeById = new Map(runtime.map((r) => [r.campaignId, r]));
  const dbIds = new Set(campaignsDb.map((c) => c.id));

  const mapCampaignSummary = (
    id: string,
    name: string,
    status: string | undefined,
    rt: (typeof runtime)[0] | undefined,
    runtimeOnly?: boolean
  ): DiagnosticsBundle['campaigns'][0] => {
    const queueJobs = queueJobsByCampaign.get(id);
    return {
      id,
      name: String(name || id).slice(0, 120),
      status,
      isRunning: rt?.isRunning,
      processed: rt?.processed,
      successCount: rt?.successCount,
      failCount: rt?.failCount,
      pendingJobs: rt?.pendingJobs,
      queueJobs,
      paused: rt?.paused,
      runtimeOnly,
    };
  };

  const campaigns = campaignsDb.slice(0, 15).map((c) =>
    mapCampaignSummary(c.id, String(c.name || c.id), c.status, runtimeById.get(c.id))
  );

  for (const rt of runtime) {
    if (dbIds.has(rt.campaignId)) continue;
    if (campaigns.length >= 20) break;
    campaigns.push(
      mapCampaignSummary(rt.campaignId, `(runtime) ${rt.campaignId.slice(0, 8)}`, 'RUNNING', rt, true)
    );
  }

  const connections = filterByConnectionScope(tid, evolutionService.getConnections()).map((c) => ({
    id: c.id,
    label: String(c.name || c.id).slice(0, 80),
    status: String(c.status || 'UNKNOWN'),
    engine: evolutionEngineConfig.engine,
  }));

  let queue: DiagnosticsBundle['queue'];
  try {
    const m = await evolutionService.getCampaignBullmqQueueMetrics();
    const delayedLen = m.delayed ?? null;
    const connectedChips = connections.filter((c) =>
      /^(CONNECTED|OPEN)$/i.test(String(c.status || ''))
    ).length;
    let note: string | undefined;
    if ((delayedLen ?? 0) > 50 && connectedChips === 0) {
      note =
        'Muitos jobs delayed no cluster e nenhum chip CONNECTED neste tenant — envios aguardam reconexão (~2 min/ciclo) ou redistribuição pelo pool.';
    } else if ((m.failed ?? 0) > 30 && campaignsDb.some((c) => c.status === 'FAILED')) {
      note =
        'Muitos jobs na aba failed do Redis (histórico BullMQ). Se recentErrors está vazio e chips estão CONNECTED, faça deploy ≥2.3.283, limpe failed antigos (Admin fila) e use Retomar ou crie campanha nova.';
    } else if ((delayedLen ?? 0) > 100) {
      note =
        'Fila delayed elevada: pode incluir intervalo entre mensagens, limite diário ou chips offline; veja queueJobs por campanha.';
    }
    queue = {
      waitLen: m.waiting ?? null,
      delayedLen,
      activeJobs: m.active ?? null,
      failedLen: m.failed ?? null,
      channelQueues: m.channelQueues ?? null,
      note,
    };
  } catch {
    queue = {
      waitLen: null,
      delayedLen: null,
      activeJobs: null,
      failedLen: null,
      channelQueues: null,
    };
  }

  const recentErrors = listTenantDiagnosticEvents(tid, 80);
  const campaignIdsInBundle = new Set(campaigns.map((c) => c.id));
  const orphanCampaignIdsFromErrors = [
    ...new Set(
      recentErrors
        .map((e) => e.campaignId)
        .filter((cid): cid is string => Boolean(cid && !campaignIdsInBundle.has(cid)))
    ),
  ].slice(0, 10);

  for (const orphanId of orphanCampaignIdsFromErrors) {
    if (campaigns.length >= 22) break;
    const rt = runtimeById.get(orphanId);
    const qj = queueJobsByCampaign.get(orphanId);
    if (rt || qj) {
      campaigns.push(
        mapCampaignSummary(
          orphanId,
          `(erros recentes) ${orphanId.slice(0, 8)}`,
          rt?.isRunning ? 'RUNNING' : undefined,
          rt,
          true
        )
      );
      campaignIdsInBundle.add(orphanId);
    }
  }

  const authProvider = zapmassAuthProvider();
  const dataProvider = zapmassDataProvider();

  return {
    schema: DIAGNOSTICS_BUNDLE_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion: readAppVersion(),
    gitRef: readGitRef(),
    tenantId: tid,
    configFlags: {
      dataProvider,
      authProvider,
      evolutionEngine: evolutionEngineConfig.engine,
      vpsOnly: resolveVpsOnlyFlag(),
    },
    connections,
    campaigns,
    recentErrors,
    queue,
    orphanCampaignIdsFromErrors:
      orphanCampaignIdsFromErrors.length > 0 ? orphanCampaignIdsFromErrors : undefined,
    clientHints: clientHints
      ? (sanitizeDiagnosticsRecord(clientHints) as Record<string, unknown>)
      : undefined,
  };
}
