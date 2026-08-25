import type { Express, Request, Response } from 'express';
import { requireTenant } from './httpTenant.js';
import {
  getChipActivitySnapshot,
  setChipQuietMode
} from './chipProtectionService.js';

export function registerChipProtectionRoutes(app: Express): void {
  app.get('/api/chip-protection', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const snapshot = await getChipActivitySnapshot(ctx.tenantId);
      return res.json({ ok: true, ...snapshot });
    } catch (e) {
      console.error('[chip-protection GET]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível carregar proteção de chips.' });
    }
  });

  app.patch('/api/chip-protection', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as { chipQuietMode?: boolean };
    if (body.chipQuietMode === undefined) {
      return res.status(400).json({ ok: false, error: 'Informe chipQuietMode (boolean).' });
    }
    try {
      await setChipQuietMode(ctx.tenantId, Boolean(body.chipQuietMode));
      const snapshot = await getChipActivitySnapshot(ctx.tenantId);
      return res.json({ ok: true, ...snapshot });
    } catch (e) {
      console.error('[chip-protection PATCH]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível salvar proteção de chips.' });
    }
  });
}
