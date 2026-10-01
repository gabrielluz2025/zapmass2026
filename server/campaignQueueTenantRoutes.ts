import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { tenantScopeUidsMatch } from './auth/tenantUidScopeServer.js';
import { requireTenant } from './httpTenant.js';
import {
  getCampaignDoc,
  listCampaigns,
  resolveCampaignTenantId,
} from './repositories/campaignsRepository.js';
import {
  buildQueueRemoveConfirmPhrase,
  parseQueueRemoveConfirm,
} from '../shared/campaignQueueTenantHelpers.js';
import {
  inferRemoveConfirmScope,
  inspectTenantCampaignQueues,
  promoteTenantDelayedQueueJobs,
  removeTenantCampaignQueueJobs,
  removeTenantDeadChannelQueueJobs,
  removeTenantHumanManualPausedJobs,
  type CampaignQueueRemoveFilters,
} from './campaignQueueTenant.js';
import type { CampaignQueueScanState } from './campaignQueueScan.js';
import * as evolutionService from './evolutionService.js';
import { pushTenantDiagnosticEvent } from './tenantDiagnosticBuffer.js';

function parseFilters(body: Record<string, unknown>): CampaignQueueRemoveFilters {
  const connectionId = String(body.connectionId || '').trim() || undefined;
  const campaignId = String(body.campaignId || '').trim() || undefined;
  const stepRaw = body.stepIndex ?? body.step;
  const stepIndex =
    stepRaw === undefined || stepRaw === null || stepRaw === ''
      ? undefined
      : Number(stepRaw);
  const jobIds = Array.isArray(body.jobIds)
    ? body.jobIds.map((id) => String(id).trim()).filter(Boolean)
    : undefined;
  const states = Array.isArray(body.states)
    ? (body.states.map((s) => String(s).trim()) as CampaignQueueScanState[])
    : undefined;
  return {
    connectionId,
    campaignId,
    stepIndex: Number.isFinite(stepIndex) ? stepIndex : undefined,
    jobIds,
    states,
  };
}

async function assertCampaignTenant(
  tenantId: string,
  campaignId: string | undefined
): Promise<boolean> {
  const cid = String(campaignId || '').trim();
  if (!cid) return true;
  const doc = await getCampaignDoc(tenantId, cid);
  return Boolean(doc);
}

async function assertConnectionTenant(tenantId: string, connectionId: string | undefined): Promise<boolean> {
  const id = String(connectionId || '').trim();
  if (!id) return true;
  const scoped = evolutionService.getConnectionsForTenant(tenantId);
  return scoped.some((c) => c.id === id);
}

function tenantActiveConnectionIds(tenantId: string): Set<string> {
  return new Set(evolutionService.getConnectionsForTenant(tenantId).map((c) => c.id));
}

function queueScanContext(tenantId: string) {
  return {
    activeConnectionIds: tenantActiveConnectionIds(tenantId),
    resolveCampaignOwner: evolutionService.getCampaignOwnerUidForQueue,
    isChannelUsable: evolutionService.isDispatchChannelUsable,
  };
}

function logQueueAction(
  tenantId: string,
  action: string,
  detail: Record<string, unknown>
): void {
  pushTenantDiagnosticEvent({
    tenantId,
    at: new Date().toISOString(),
    source: 'campaign',
    level: 'info',
    message: `[fila] ${action}`,
    campaignId: typeof detail.campaignId === 'string' ? detail.campaignId : undefined,
    connectionId: typeof detail.connectionId === 'string' ? detail.connectionId : undefined,
  });
  console.info('[campaign-queue-tenant]', action, { tenantId, ...detail });
}

export function registerCampaignQueueTenantRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/campaigns/queue/inspect', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const filters = {
        connectionId: String(req.query.connectionId || '').trim() || undefined,
        campaignId: String(req.query.campaignId || '').trim() || undefined,
        stepIndex: req.query.stepIndex != null ? Number(req.query.stepIndex) : undefined,
      };
      if (filters.campaignId && !(await assertCampaignTenant(ctx.tenantId, filters.campaignId))) {
        return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
      }
      await evolutionService.syncConnectionQueueSizesFromRedis().catch(() => undefined);
      const queues = await evolutionService.getCampaignBullmqQueuesForAdmin();
      const scanCtx = queueScanContext(ctx.tenantId);
      const inspect = await inspectTenantCampaignQueues(queues, ctx.tenantId, {
        filters,
        groupLimit: Number(req.query.limit || 80) || 80,
        ...scanCtx,
      });
      const queueCounts = await evolutionService.collectTenantCampaignQueueJobCounts(ctx.tenantId);
      const runtimeSnapshots = evolutionService.getTenantCampaignRuntimeSnapshots(ctx.tenantId);
      const dbCampaignIds = new Set(
        (await listCampaigns(ctx.tenantId).catch(() => [])).map((c) => c.id)
      );
      const runtimeCampaigns = runtimeSnapshots
        .filter((r) => r.isRunning && (r.pendingJobs > 0 || (queueCounts.get(r.campaignId) || 0) > 0))
        .map((r) => ({
          campaignId: r.campaignId,
          isRunning: r.isRunning,
          pendingJobs: r.pendingJobs,
          queueJobs: queueCounts.get(r.campaignId) || 0,
          paused: r.paused,
          runtimeOnly: !dbCampaignIds.has(r.campaignId),
        }));
      return res.json({
        ok: true,
        channelQueues: queues.length,
        ...inspect,
        runtimeCampaigns,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[api/campaigns/queue/inspect]', message);
      return res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/campaigns/queue/remove', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const filters = parseFilters(body);
    const dryRun = body.dryRun !== false;

    if (filters.campaignId && !(await assertCampaignTenant(ctx.tenantId, filters.campaignId))) {
      return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
    }
    if (!(await assertConnectionTenant(ctx.tenantId, filters.connectionId))) {
      return res.status(404).json({ ok: false, error: 'Canal não encontrado na sua conta.' });
    }

    const { scope, scopeId } = inferRemoveConfirmScope(filters);
    if (!dryRun && !parseQueueRemoveConfirm(body, scope, scopeId)) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmação inválida. Use dryRun: true para simular ou envie o texto de confirmação correto.',
        expectedScope: scope,
        expectedScopeId: scopeId,
      });
    }

    try {
      const queues = await evolutionService.getCampaignBullmqQueuesForAdmin();
      if (queues.length === 0) {
        return res.status(503).json({ ok: false, error: 'Filas indisponíveis (Redis).' });
      }

      let paused = false;
      if (!dryRun && filters.campaignId && body.pauseFirst !== false) {
        evolutionService.pauseCampaign(filters.campaignId, ctx.tenantId);
        paused = true;
      }

      const result = await removeTenantCampaignQueueJobs(queues, ctx.tenantId, filters, {
        dryRun,
        resolveCampaignOwner: evolutionService.getCampaignOwnerUidForQueue,
      });
      if (!dryRun) {
        logQueueAction(ctx.tenantId, 'remove', { ...filters, ...result });
      }
      return res.json({ ok: true, paused, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/campaigns/queue/clear-delayed', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const filters = parseFilters(body);
    const dryRun = body.dryRun !== false;

    if (filters.campaignId && !(await assertCampaignTenant(ctx.tenantId, filters.campaignId))) {
      return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
    }

    const { scope, scopeId } = inferRemoveConfirmScope(filters);
    const confirmScope = scope === 'all' ? 'all' : scope;
    if (!dryRun && !parseQueueRemoveConfirm(body, confirmScope, scopeId)) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmação inválida para promover jobs atrasados.',
        expectedScope: confirmScope,
        expectedScopeId: scopeId,
      });
    }

    try {
      const queues = await evolutionService.getCampaignBullmqQueuesForAdmin();
      const result = await promoteTenantDelayedQueueJobs(queues, ctx.tenantId, filters, {
        dryRun,
        resolveCampaignOwner: evolutionService.getCampaignOwnerUidForQueue,
      });
      if (!dryRun) {
        logQueueAction(ctx.tenantId, 'clear-delayed', { ...filters, ...result });
        if (filters.campaignId) {
          await evolutionService.setCampaignDispatchPriorityBoost(
            filters.campaignId,
            true,
            ctx.tenantId
          );
          await evolutionService.repairCampaignDispatchQueueAfterDelayPromote(
            filters.campaignId,
            ctx.tenantId
          );
        }
        await evolutionService.syncConnectionQueueSizesFromRedis().catch(() => undefined);
      }
      return res.json({ ok: true, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/campaigns/queue/purge-runtime-orphans', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const dryRun = body.dryRun !== false;
    if (!dryRun && !parseQueueRemoveConfirm(body, 'runtime-orphans')) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmação inválida.',
        expectedScope: 'runtime-orphans',
        expectedConfirm: buildQueueRemoveConfirmPhrase('runtime-orphans'),
      });
    }
    try {
      const dbIds = new Set(
        (await listCampaigns(ctx.tenantId).catch(() => [])).map((c) => c.id)
      );
      const runtime = evolutionService.getTenantCampaignRuntimeSnapshots(ctx.tenantId);
      const orphans = runtime.filter((r) => !dbIds.has(r.campaignId));
      if (dryRun) {
        const queueCounts = await evolutionService.collectTenantCampaignQueueJobCounts(ctx.tenantId);
        const wouldStop = orphans.length;
        const wouldRemoveJobs = orphans.reduce(
          (sum, r) => sum + (queueCounts.get(r.campaignId) || 0),
          0
        );
        return res.json({
          ok: true,
          dryRun: true,
          orphanCampaignIds: orphans.map((r) => r.campaignId),
          wouldStop,
          wouldRemoveJobs,
        });
      }
      const results: Array<{ campaignId: string; halted: boolean; purgeRemoved?: number }> = [];
      for (const row of orphans) {
        const r = await evolutionService.haltRuntimeOrphanCampaign(ctx.tenantId, row.campaignId, {
          reason: 'api-purge-runtime-orphans',
        });
        results.push({ campaignId: row.campaignId, ...r });
      }
      logQueueAction(ctx.tenantId, 'purge-runtime-orphans', {
        count: results.length,
        removed: results.reduce((s, x) => s + (x.purgeRemoved || 0), 0),
      });
      await evolutionService.syncConnectionQueueSizesFromRedis().catch(() => undefined);
      return res.json({ ok: true, dryRun: false, results });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/campaigns/queue/purge-runtime', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const campaignId = String(body.campaignId || '').trim();
    if (!campaignId) {
      return res.status(400).json({ ok: false, error: 'campaignId obrigatório.' });
    }
    const dryRun = body.dryRun !== false;
    const doc = await getCampaignDoc(ctx.tenantId, campaignId);
    if (doc) {
      return res.status(400).json({
        ok: false,
        error: 'Campanha ainda existe no cadastro — use limpar fila da campanha ou exclua a campanha.',
      });
    }
    const resolvedTenant = await resolveCampaignTenantId(campaignId);
    if (resolvedTenant && !tenantScopeUidsMatch(ctx.tenantId, resolvedTenant)) {
      return res.status(404).json({ ok: false, error: 'Campanha não pertence a esta conta.' });
    }
    const confirmPhrase = buildQueueRemoveConfirmPhrase('runtime-campaign', campaignId);
    if (!dryRun && !parseQueueRemoveConfirm(body, 'runtime-campaign', campaignId)) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmação inválida.',
        expectedScope: 'runtime-campaign',
        expectedConfirm: confirmPhrase,
      });
    }
    try {
      if (dryRun) {
        const purge = await evolutionService.purgeCampaignBullQueuesForId(campaignId, true);
        const pending =
          evolutionService
            .getTenantCampaignRuntimeSnapshots(ctx.tenantId)
            .find((r) => r.campaignId === campaignId)?.pendingJobs ?? 0;
        return res.json({
          ok: true,
          dryRun: true,
          campaignId,
          wouldRemoveJobs: purge.wouldRemove + purge.skippedActive,
          pendingMem: pending,
        });
      }
      const halted = await evolutionService.haltRuntimeOrphanCampaign(ctx.tenantId, campaignId, {
        reason: 'api-purge-runtime',
      });
      if (!halted.halted) {
        return res.status(404).json({ ok: false, error: 'Runtime não encontrado para esta conta.' });
      }
      logQueueAction(ctx.tenantId, 'purge-runtime', { campaignId, ...halted });
      await evolutionService.syncConnectionQueueSizesFromRedis().catch(() => undefined);
      return res.json({ ok: true, dryRun: false, campaignId, ...halted });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/campaigns/queue/purge-dead-channels', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const dryRun = body.dryRun !== false;
    const confirmPhrase = buildQueueRemoveConfirmPhrase('dead-channels');
    if (!dryRun && !parseQueueRemoveConfirm(body, 'dead-channels')) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmação inválida para limpar chips mortos.',
        expectedScope: 'dead-channels',
        expectedConfirm: confirmPhrase,
      });
    }
    try {
      const queues = await evolutionService.getCampaignBullmqQueuesForAdmin();
      const scanCtx = queueScanContext(ctx.tenantId);
      const result = await removeTenantDeadChannelQueueJobs(queues, ctx.tenantId, scanCtx, {
        dryRun,
        resolveCampaignOwner: evolutionService.getCampaignOwnerUidForQueue,
      });
      if (!dryRun) {
        logQueueAction(ctx.tenantId, 'purge-dead-channels', { ...result });
        await evolutionService.syncConnectionQueueSizesFromRedis().catch(() => undefined);
      }
      return res.json({ ok: true, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/campaigns/queue/purge-human-manual', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const dryRun = body.dryRun !== false;
    const confirmPhrase = buildQueueRemoveConfirmPhrase('human-manual');
    if (!dryRun && !parseQueueRemoveConfirm(body, 'human-manual')) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmação inválida para limpar jobs de atendimento manual.',
        expectedScope: 'human-manual',
        expectedConfirm: confirmPhrase,
      });
    }
    try {
      const queues = await evolutionService.getCampaignBullmqQueuesForAdmin();
      const scanCtx = queueScanContext(ctx.tenantId);
      const result = await removeTenantHumanManualPausedJobs(queues, ctx.tenantId, {
        dryRun,
        resolveCampaignOwner: evolutionService.getCampaignOwnerUidForQueue,
      });
      if (!dryRun) {
        logQueueAction(ctx.tenantId, 'purge-human-manual', { ...result });
        await evolutionService.syncConnectionQueueSizesFromRedis().catch(() => undefined);
      }
      return res.json({ ok: true, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/campaigns/queue/priority', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      campaignId?: string;
      priority?: string;
      boosted?: boolean;
    };
    const campaignId = String(body.campaignId || '').trim();
    if (!campaignId) {
      return res.status(400).json({ ok: false, error: 'campaignId obrigatório.' });
    }
    if (!(await assertCampaignTenant(ctx.tenantId, campaignId))) {
      return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
    }
    const boosted =
      body.boosted === true ||
      String(body.priority || '').toLowerCase() === 'high' ||
      String(body.priority || '').toLowerCase() === 'boost';
    try {
      const updated = await evolutionService.setCampaignDispatchPriorityBoost(
        campaignId,
        boosted,
        ctx.tenantId
      );
      logQueueAction(ctx.tenantId, boosted ? 'priority-high' : 'priority-normal', {
        campaignId,
        updated,
      });
      return res.json({ ok: true, campaignId, boosted, updated });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: message });
    }
  });
}
