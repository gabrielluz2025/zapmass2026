import type { Express, Request, Response } from 'express';
import type { ChipProtectionPolicy } from '../shared/chipProtection.js';
import { requireTenant } from './httpTenant.js';
import {
  getChipActivitySnapshot,
  setChipProtectionPolicy,
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
    const body = req.body as { chipQuietMode?: boolean; chipProtectionPolicy?: ChipProtectionPolicy };
    try {
      if (body.chipProtectionPolicy !== undefined) {
        const p = String(body.chipProtectionPolicy);
        if (p !== 'auto' && p !== 'always' && p !== 'off') {
          return res.status(400).json({ ok: false, error: 'chipProtectionPolicy deve ser auto, always ou off.' });
        }
        await setChipProtectionPolicy(ctx.tenantId, p);
      } else if (body.chipQuietMode !== undefined) {
        await setChipQuietMode(ctx.tenantId, Boolean(body.chipQuietMode));
      } else {
        return res.status(400).json({
          ok: false,
          error: 'Informe chipProtectionPolicy (auto|always|off) ou chipQuietMode (boolean).',
        });
      }
      const snapshot = await getChipActivitySnapshot(ctx.tenantId);
      return res.json({ ok: true, ...snapshot });
    } catch (e) {
      console.error('[chip-protection PATCH]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível salvar proteção de chips.' });
    }
  });
}
