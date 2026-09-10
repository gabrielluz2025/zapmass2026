import type { Express, Request, Response } from 'express';
import { requireTenant } from './httpTenant.js';
import { buildWarmupDiagnostics } from './warmupDiagnosticsService.js';

export function registerWarmupDiagnosticsRoutes(app: Express): void {
  app.get('/api/warmup/diagnostics', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const rawIds = String(req.query.connectionIds || req.query.ids || '').trim();
      const connectionIds = rawIds
        ? rawIds.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const intervalMinutes = Math.max(
        1,
        Math.min(120, Number(req.query.intervalMinutes) || 15)
      );
      const report = await buildWarmupDiagnostics(ctx.tenantId, connectionIds, intervalMinutes);
      return res.json(report);
    } catch (e) {
      console.error('[warmup/diagnostics GET]', e);
      return res.status(500).json({
        ok: false,
        canStart: false,
        summary: 'Erro ao gerar diagnóstico de aquecimento.',
        error: 'Não foi possível analisar os chips.',
      });
    }
  });
}
