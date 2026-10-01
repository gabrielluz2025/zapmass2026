import type { Express, Request, Response } from 'express';
import { requireTenant } from './httpTenant.js';
import { buildTenantDiagnosticsExport } from './diagnosticsService.js';

export function registerDiagnosticsRoutes(app: Express): void {
  app.get('/api/diagnostics/export', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const bundle = await buildTenantDiagnosticsExport(ctx.tenantId);
      return res.json({ ok: true, bundle });
    } catch (e) {
      console.error('[diagnostics/export GET]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível gerar o pacote de diagnóstico.' });
    }
  });

  app.post('/api/diagnostics/export', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
        clientHints?: Record<string, unknown>;
      };
      const bundle = await buildTenantDiagnosticsExport(ctx.tenantId, body.clientHints);
      return res.json({ ok: true, bundle });
    } catch (e) {
      console.error('[diagnostics/export POST]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível gerar o pacote de diagnóstico.' });
    }
  });

  app.get('/api/diagnostics/recent', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const bundle = await buildTenantDiagnosticsExport(ctx.tenantId);
      return res.json({
        ok: true,
        exportedAt: bundle.exportedAt,
        appVersion: bundle.appVersion,
        recentErrors: bundle.recentErrors.slice(0, 40),
        connections: bundle.connections,
        campaigns: bundle.campaigns,
        queue: bundle.queue,
      });
    } catch (e) {
      console.error('[diagnostics/recent GET]', e);
      return res.status(500).json({ ok: false, error: 'Erro ao listar diagnóstico recente.' });
    }
  });
}
