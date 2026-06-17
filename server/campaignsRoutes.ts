import type { Express, Request, Response } from 'express';
import type { Campaign } from '../src/types.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import {
  createCampaign,
  deleteAllCampaigns,
  deleteCampaign,
  deleteCampaigns,
  getCampaignDoc,
  listCampaignLogs,
  listCampaigns,
  mergeUpdateCampaign
} from './repositories/campaignsRepository.js';
import {
  getContactStateSummary,
  listFailedContactsAtStep,
  resetFailedContactsAtStep,
} from './repositories/campaignContactStateRepository.js';
import { buildCampaignInboundRepliesMap } from './campaignInboundReplies.js';
import { recipientKeyForCampaignReport } from '../src/utils/campaignReportDedupe.js';
import {
  buildCampaignReportSnapshot,
  type CampaignReportSnapshot
} from './campaignReportSnapshot.js';
import * as evolutionService from './evolutionService.js';

export function registerCampaignsDataRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/campaigns', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const campaigns = await listCampaigns(ctx.tenantId);
    return res.json({ ok: true, campaigns });
  });

  app.post('/api/campaigns', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Corpo inválido.' });
    }
    try {
      const { id, campaign } = await createCampaign(ctx.tenantId, body);
      return res.json({ ok: true, id, campaign });
    } catch (e) {
      console.error('[api/campaigns POST]', e);
      return res.status(400).json({ ok: false, error: 'Não foi possível criar a campanha.' });
    }
  });

  app.patch('/api/campaigns/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '').trim();
    const ok = await mergeUpdateCampaign(ctx.tenantId, id, req.body as Record<string, unknown>);
    if (!ok) return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
    return res.json({ ok: true });
  });

  app.delete('/api/campaigns/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });
    try {
      const ok = await deleteCampaign(ctx.tenantId, id);
      if (!ok) return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
      evolutionService.purgeCampaignMediaFiles(id);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[api/campaigns DELETE]', id, e);
      return res.status(500).json({ ok: false, error: 'Erro ao remover campanha.' });
    }
  });

  app.post('/api/campaigns/bulk-delete', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as { ids?: unknown };
    const ids = Array.isArray(body?.ids)
      ? body.ids.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'Informe ao menos um id.' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ ok: false, error: 'Máximo de 200 campanhas por vez.' });
    }
    try {
      const { deleted, missing } = await deleteCampaigns(ctx.tenantId, ids);
      for (const id of deleted) {
        evolutionService.purgeCampaignMediaFiles(id);
      }
      return res.json({ ok: true, deleted, missing });
    } catch (e) {
      console.error('[api/campaigns bulk-delete]', e);
      return res.status(500).json({ ok: false, error: 'Erro ao remover campanhas.' });
    }
  });

  app.get('/api/campaigns/:id/logs', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const campaignId = String(req.params.id || '').trim();
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const rows = await listCampaignLogs(ctx.tenantId, campaignId, { limit, offset });
    return res.json({
      ok: true,
      logs: rows.map((r) => {
        const p = r.payload || {};
        return {
          id: r.id,
          level: r.level,
          message: r.message,
          to: String(p.to || p.phoneDigits || ''),
          connectionId: String(p.connectionId || ''),
          error: String(p.error || ''),
          phoneDigits: String(p.phoneDigits || ''),
          replyPreview: p.replyPreview != null ? String(p.replyPreview) : undefined,
          replyFlowStep: p.replyFlowStep != null ? Number(p.replyFlowStep) : undefined,
          currentStep: p.currentStep != null ? Number(p.currentStep) : undefined,
          campaignId: String(p.campaignId || ''),
          createdAt: r.created_at.toISOString()
        };
      }),
      hasMore: rows.length >= limit
    });
  });

  app.get('/api/campaigns/:id/report', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const campaignId = String(req.params.id || '').trim();
    try {
      const snapshot = await buildCampaignReportSnapshot(ctx.tenantId, campaignId);
      if (!snapshot) {
        return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
      }
      const { persistCampaignReportSnapshot } = await import('./campaignReportSnapshot.js');
      void persistCampaignReportSnapshot(ctx.tenantId, campaignId);
      return res.json({ ok: true, snapshot });
    } catch (e) {
      console.error('[api/campaigns/report]', e);
      return res.status(500).json({ ok: false, error: 'Erro ao montar relatório.' });
    }
  });

  app.get('/api/campaigns/:id/inbound-replies', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const campaignId = String(req.params.id || '').trim();
    const doc = await getCampaignDoc(ctx.tenantId, campaignId);
    if (!doc) return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });

    const allowed = Array.isArray(doc.selectedConnectionIds)
      ? (doc.selectedConnectionIds as string[]).filter(Boolean)
      : [];

    const replies: Record<string, { replyText: string; replyTimestampMs: number }> = {};

    const logRows = await listCampaignLogs(ctx.tenantId, campaignId, { limit: 500, offset: 0 });
    const scopedForReply = logRows.map((r) => ({
      timestamp: r.created_at.toISOString(),
      payload: r.payload
    }));

    try {
      const { getConversations } = await import('./evolutionService.js');
      const fromChat = buildCampaignInboundRepliesMap(
        campaignId,
        getConversations(),
        allowed,
        scopedForReply
      );
      Object.assign(replies, fromChat);
    } catch (e) {
      console.warn('[api/campaigns/inbound-replies] evolution:', e);
    }

    const replyLogMessages = new Set([
      'Resposta recebida no fluxo por etapas',
      'Resposta do contato'
    ]);
    for (const row of logRows) {
      if (!replyLogMessages.has(row.message)) continue;
      const p = row.payload || {};
      const rk = recipientKeyForCampaignReport(String(p.to || p.phoneDigits || ''));
      const preview = p.replyPreview != null ? String(p.replyPreview).trim() : '';
      if (!rk) continue;
      const ts = row.created_at.getTime();
      const prev = replies[rk];
      if (!prev || ts >= prev.replyTimestampMs) {
        replies[rk] = {
          replyText:
            preview ||
            '[resposta recebida — sem texto legível na captura]',
          replyTimestampMs: ts
        };
      }
    }

    return res.json({ ok: true, replies });
  });

  app.delete('/api/tenant/campaigns-data', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    if (ctx.principal.role !== 'owner' || ctx.principal.authUid !== ctx.tenantId) {
      return res.status(403).json({ ok: false, error: 'Apenas o dono da conta pode apagar campanhas.' });
    }
    const n = await deleteAllCampaigns(ctx.tenantId);
    return res.json({ ok: true, campaigns: n });
  });

  // ─── Motor multi-etapas: endpoints de progresso por contato ─────────────────

  /** Dashboard de progresso: agrega contagens por etapa e status. */
  app.get('/api/campaigns/:id/contact-states', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const campaignId = String(req.params.id || '').trim();
    try {
      const summary = await getContactStateSummary(campaignId);
      return res.json({ ok: true, summary });
    } catch (e) {
      console.error('[api/campaigns/contact-states]', e);
      return res.status(500).json({ ok: false, error: 'Erro ao obter progresso dos contatos.' });
    }
  });

  /** Lista contatos falhos em uma etapa específica. */
  app.get('/api/campaigns/:id/failed-contacts', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const campaignId = String(req.params.id || '').trim();
    const stepIndex = parseInt(String(req.query.step || '0'), 10);
    try {
      const rows = await listFailedContactsAtStep(campaignId, isNaN(stepIndex) ? 0 : stepIndex);
      return res.json({
        ok: true,
        contacts: rows.map((r) => ({
          contactId: r.contact_id,
          stepIndex: r.current_step_index,
          errorMessage: r.error_message,
          attempts: r.attempts,
          updatedAt: r.updated_at,
        })),
      });
    } catch (e) {
      console.error('[api/campaigns/failed-contacts]', e);
      return res.status(500).json({ ok: false, error: 'Erro ao listar contatos falhos.' });
    }
  });

  /** Anexos de mídia salvos da campanha (para reenvio com foto/vídeo/arquivo). */
  app.get('/api/campaigns/:id/media-attachments', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const campaignId = String(req.params.id || '').trim();
    if (!campaignId) return res.status(400).json({ ok: false, error: 'ID inválido.' });
    try {
      const owned = await evolutionService.ensureTenantOwnsCampaign(ctx.tenantId, campaignId);
      if (!owned) return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
      const attachments = evolutionService.getCampaignMediaAttachmentsForRetry(campaignId);
      return res.json({ ok: true, ...attachments });
    } catch (e) {
      console.error('[api/campaigns/media-attachments]', e);
      return res.status(500).json({ ok: false, error: 'Erro ao carregar anexos da campanha.' });
    }
  });

  /** Reenvio: reseta falhos de uma etapa para pending (permite retentar). */
  app.post('/api/campaigns/:id/retry-failed', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const campaignId = String(req.params.id || '').trim();
    const body = req.body as { stepIndex?: number; connectionIds?: string[] };
    const stepIndex = typeof body.stepIndex === 'number' ? body.stepIndex : 0;
    try {
      const owned = await evolutionService.ensureTenantOwnsCampaign(ctx.tenantId, campaignId);
      if (!owned) return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
      const reset = await resetFailedContactsAtStep(campaignId, stepIndex);
      const redispatch = await evolutionService.redispatchCampaign(ctx.tenantId, campaignId, {
        mode: 'failed',
        stepIndex,
        connectionIds: Array.isArray(body.connectionIds) ? body.connectionIds : undefined,
        skipFrequencyCap: true,
      });
      return res.json({
        ok: true,
        reset,
        enqueued: redispatch.enqueued,
        error: redispatch.ok ? undefined : redispatch.error,
      });
    } catch (e) {
      console.error('[api/campaigns/retry-failed]', e);
      return res.status(500).json({ ok: false, error: 'Erro ao resetar contatos falhos.' });
    }
  });

  /** Reenvio / retomada na mesma campanha (falhos ou pendências por etapa). */
  app.post('/api/campaigns/:id/redispatch', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const campaignId = String(req.params.id || '').trim();
    const body = req.body as {
      mode?: 'failed' | 'resume';
      connectionIds?: string[];
      phones?: string[];
      stepIndex?: number;
    };
    try {
      const owned = await evolutionService.ensureTenantOwnsCampaign(ctx.tenantId, campaignId);
      if (!owned) return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
      const result = await evolutionService.redispatchCampaign(ctx.tenantId, campaignId, {
        mode: body.mode === 'resume' ? 'resume' : 'failed',
        connectionIds: Array.isArray(body.connectionIds) ? body.connectionIds : undefined,
        phones: Array.isArray(body.phones) ? body.phones : undefined,
        stepIndex: typeof body.stepIndex === 'number' ? body.stepIndex : undefined,
        skipFrequencyCap: true,
      });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error || 'Não foi possível reenviar.' });
      }
      return res.json({ ok: true, enqueued: result.enqueued });
    } catch (e) {
      console.error('[api/campaigns/redispatch]', e);
      return res.status(500).json({ ok: false, error: 'Erro ao reenviar campanha.' });
    }
  });

  /**
   * POST /api/campaigns/preflight
   * Verifica se os chips estão prontos para disparo antes de iniciar a campanha.
   * Retorna status detalhado de cada conexão solicitada.
   */
  app.post('/api/campaigns/preflight', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as { connectionIds?: string[]; testNumber?: string };
    const connectionIds: string[] = Array.isArray(body.connectionIds) ? body.connectionIds : [];
    if (connectionIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'Informe ao menos uma conexão.' });
    }
    // Filtra somente conexões do tenant
    const tenantConns = evolutionService.getConnectionsForTenant(ctx.tenantId);
    const ownedIds = new Set(tenantConns.map((c) => c.instanceName || c.id));
    const filtered = connectionIds.filter((id) => ownedIds.has(id));
    if (filtered.length === 0) {
      return res.status(403).json({ ok: false, error: 'Nenhuma conexão pertence a esta conta.' });
    }

    const results = await Promise.all(
      filtered.map(async (connId) => {
        try {
          const stateResult = await evolutionService.getConnectionStatePublic(connId);
          const isOpen = stateResult.status === 'open' || stateResult.status === 'connected';
          return {
            connectionId: connId,
            status: stateResult.status,
            isReady: isOpen,
            error: isOpen ? null : `Chip offline (${stateResult.status})`,
          };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { connectionId: connId, status: 'error', isReady: false, error: msg };
        }
      })
    );

    const allReady = results.every((r) => r.isReady);
    const readyCount = results.filter((r) => r.isReady).length;

    return res.json({
      ok: true,
      allReady,
      readyCount,
      totalChecked: results.length,
      results,
    });
  });

  /**
   * POST /api/campaigns/test-send
   * Envia uma mensagem-teste para um único número sem criar campanha.
   * Útil para validar que o chip está conectado e enviando antes do disparo em massa.
   */
  app.post('/api/campaigns/test-send', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as { connectionId?: string; toNumber?: string; message?: string };
    const { connectionId, toNumber, message } = body;
    if (!connectionId || !toNumber || !message) {
      return res.status(400).json({ ok: false, error: 'Informe connectionId, toNumber e message.' });
    }
    const tenantConns = evolutionService.getConnectionsForTenant(ctx.tenantId);
    const ownedIds = new Set(tenantConns.map((c) => c.instanceName || c.id));
    if (!ownedIds.has(connectionId)) {
      return res.status(403).json({ ok: false, error: 'Conexão não pertence a esta conta.' });
    }
    try {
      const result = await evolutionService.sendTestMessage(connectionId, toNumber, message);
      return res.json({ ok: result.ok, messageId: result.messageId, error: result.error });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  /**
   * GET /api/campaigns/failed-jobs
   * Retorna os últimos jobs falhos na fila BullMQ com o motivo real do erro.
   * Útil para diagnóstico quando o disparo não está enviando.
   */
  app.get('/api/campaigns/failed-jobs', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const jobs = await evolutionService.getFailedCampaignJobs(30);
      // Filtra apenas jobs do tenant
      const tenantConns = evolutionService.getConnectionsForTenant(ctx.tenantId);
      const ownedIds = new Set(tenantConns.map((c) => c.instanceName || c.id));
      const filtered = jobs.filter((j) => ownedIds.has(j.connectionId));
      return res.json({ ok: true, jobs: filtered });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
