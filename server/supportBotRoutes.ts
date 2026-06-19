import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import { invalidateSupportBotConfigCache } from './supportBot/supportBotEngine.js';
import {
  loadSupportBotConfigPg,
  loadSupportBotMetricsPg,
  listSupportBotHandoffsPg,
  normalizeSupportBotConfig,
  resetSupportBotSessionPg,
  saveSupportBotConfigPg
} from './supportBot/supportBotRepository.js';
import type { SupportBotConfig } from './supportBot/supportBotTypes.js';

export function registerSupportBotRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/support-bot', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const [config, metrics] = await Promise.all([
        loadSupportBotConfigPg(ctx.tenantId),
        loadSupportBotMetricsPg(ctx.tenantId)
      ]);
      return res.json({ ok: true, config, metrics });
    } catch (e) {
      console.error('[support-bot GET]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível carregar o atendimento automático.' });
    }
  });

  app.patch('/api/support-bot', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as { config?: unknown };
    if (!body?.config || typeof body.config !== 'object') {
      return res.status(400).json({ ok: false, error: 'Envie { config: { ... } }.' });
    }
    try {
      const config: SupportBotConfig = normalizeSupportBotConfig(body.config);
      await saveSupportBotConfigPg(ctx.tenantId, config);
      invalidateSupportBotConfigCache(ctx.tenantId);
      const metrics = await loadSupportBotMetricsPg(ctx.tenantId);
      return res.json({ ok: true, config, metrics });
    } catch (e) {
      console.error('[support-bot PATCH]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível salvar o atendimento automático.' });
    }
  });

  app.get('/api/support-bot/handoffs', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
      const handoffs = await listSupportBotHandoffsPg(ctx.tenantId, limit);
      return res.json({ ok: true, handoffs });
    } catch (e) {
      console.error('[support-bot handoffs GET]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível carregar o histórico.' });
    }
  });

  app.post('/api/support-bot/sessions/reset', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as { connectionId?: unknown; phoneDigits?: unknown };
    const connectionId = String(body?.connectionId ?? '').trim();
    const phoneDigits = String(body?.phoneDigits ?? '').replace(/\D/g, '');
    if (!connectionId || !phoneDigits) {
      return res.status(400).json({ ok: false, error: 'Envie connectionId e phoneDigits.' });
    }
    try {
      await resetSupportBotSessionPg(ctx.tenantId, connectionId, phoneDigits);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[support-bot sessions reset]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível reativar o bot nesta conversa.' });
    }
  });
}
