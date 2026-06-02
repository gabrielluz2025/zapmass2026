import type { Express, Request, Response } from 'express';
import type { Campaign } from '../src/types.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import {
  createCampaign,
  deleteAllCampaigns,
  deleteCampaign,
  listCampaignLogs,
  listCampaigns,
  mergeUpdateCampaign
} from './repositories/campaignsRepository.js';

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
      logs: rows.map((r) => ({
        id: r.id,
        level: r.level,
        message: r.message,
        to: String(r.payload?.to || ''),
        connectionId: String(r.payload?.connectionId || ''),
        error: String(r.payload?.error || ''),
        createdAt: r.created_at.toISOString()
      })),
      hasMore: rows.length >= limit
    });
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
