import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import { getCampaignDoc } from './repositories/campaignsRepository.js';
import { parseQueueRemoveConfirm } from '../shared/campaignQueueTenantHelpers.js';
import {
  inferRemoveConfirmScope,
  inspectTenantCampaignQueues,
  promoteTenantDelayedQueueJobs,
  removeTenantCampaignQueueJobs,
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
      const queues = await evolutionService.getCampaignBullmqQueuesForAdmin();
      const inspect = await inspectTenantCampaignQueues(queues, ctx.tenantId, {
        filters,
        groupLimit: Number(req.query.limit || 80) || 80,
      });
      return res.json({ ok: true, channelQueues: queues.length, ...inspect });
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

      const result = await removeTenantCampaignQueueJobs(queues, ctx.tenantId, filters, { dryRun });
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
      const result = await promoteTenantDelayedQueueJobs(queues, ctx.tenantId, filters, { dryRun });
      if (!dryRun) {
        logQueueAction(ctx.tenantId, 'clear-delayed', { ...filters, ...result });
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
