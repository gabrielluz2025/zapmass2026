import type { Express, Request, Response } from 'express';
import type { Campaign } from '../src/types.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import {
  createCampaign,
  deleteAllCampaigns,
  deleteCampaign,
  getCampaignDoc,
  listCampaignLogs,
  listCampaigns,
  mergeUpdateCampaign
} from './repositories/campaignsRepository.js';
import { buildCampaignInboundRepliesMap } from './campaignInboundReplies.js';
import { recipientKeyForCampaignReport } from '../src/utils/campaignReportDedupe.js';

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
    const ok = await deleteCampaign(ctx.tenantId, String(req.params.id || '').trim());
    if (!ok) return res.status(404).json({ ok: false, error: 'Campanha não encontrada.' });
    return res.json({ ok: true });
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

    try {
      const { getConversations } = await import('./evolutionService.js');
      const fromChat = buildCampaignInboundRepliesMap(campaignId, getConversations(), allowed);
      Object.assign(replies, fromChat);
    } catch (e) {
      console.warn('[api/campaigns/inbound-replies] evolution:', e);
    }

    const logRows = await listCampaignLogs(ctx.tenantId, campaignId, { limit: 500, offset: 0 });
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
      if (!preview) continue;
      const ts = row.created_at.getTime();
      const prev = replies[rk];
      if (!prev || ts >= prev.replyTimestampMs) {
        replies[rk] = { replyText: preview, replyTimestampMs: ts };
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
}
