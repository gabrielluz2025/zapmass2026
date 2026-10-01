import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { zapmassDataProvider } from './auth/dataMode.js';
import { evolutionEngineConfig } from './evolutionEngineConfig.js';
import { listCampaigns } from './repositories/campaignsRepository.js';
import { filterByConnectionScope } from '../src/utils/connectionScope.js';
import * as waService from './whatsappService.js';
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

export async function buildTenantDiagnosticsExport(
  tenantId: string,
  clientHints?: Record<string, unknown>
): Promise<DiagnosticsBundle> {
  const tid = String(tenantId || '').trim();
  const campaignsDb = await listCampaigns(tid).catch(() => []);
  const runtime = evolutionService.getTenantCampaignRuntimeSnapshots(tid);

  const runtimeById = new Map(runtime.map((r) => [r.campaignId, r]));

  const campaigns = campaignsDb.slice(0, 15).map((c) => {
    const rt = runtimeById.get(c.id);
    return {
      id: c.id,
      name: String(c.name || c.id).slice(0, 120),
      status: c.status,
      isRunning: rt?.isRunning,
      processed: rt?.processed,
      successCount: rt?.successCount,
      failCount: rt?.failCount,
      pendingJobs: rt?.pendingJobs,
      paused: rt?.paused,
    };
  });

  const connections = filterByConnectionScope(tid, waService.getConnections()).map((c) => ({
    id: c.id,
    label: String(c.name || c.id).slice(0, 80),
    status: String(c.status || 'UNKNOWN'),
  }));

  let queue: DiagnosticsBundle['queue'];
  try {
    const m = await evolutionService.getCampaignBullmqQueueMetrics();
    queue = {
      waitLen: m.waiting ?? null,
      delayedLen: m.delayed ?? null,
      activeJobs: m.active ?? null,
    };
  } catch {
    queue = { waitLen: null, delayedLen: null, activeJobs: null };
  }

  const recentErrors = listTenantDiagnosticEvents(tid, 80);

  return {
    schema: DIAGNOSTICS_BUNDLE_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion: readAppVersion(),
    gitRef: readGitRef(),
    tenantId: tid,
    configFlags: {
      dataProvider: zapmassDataProvider(),
      evolutionEngine: evolutionEngineConfig.engine,
      vpsOnly: process.env.ZAPMASS_VPS_ONLY === '1',
    },
    connections,
    campaigns,
    recentErrors,
    queue,
    clientHints: clientHints
      ? (sanitizeDiagnosticsRecord(clientHints) as Record<string, unknown>)
      : undefined,
  };
}
