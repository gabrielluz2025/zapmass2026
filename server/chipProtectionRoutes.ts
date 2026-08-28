import type { Express, Request, Response } from 'express';
import type { ChipProtectionPolicy } from '../shared/chipProtection.js';
import { requireTenant } from './httpTenant.js';
import {
  clearTenantProtectionLock,
  getChipActivitySnapshot,
  setChipProtectionPolicy,
  setChipQuietMode
} from './chipProtectionService.js';
import { getChipCircuitBreaker } from './chipCircuitBreaker.js';
import { getConnectionsForTenant } from './evolutionService.js';

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

  app.post('/api/chip-protection/clear-lock', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      await clearTenantProtectionLock(ctx.tenantId);
      const snapshot = await getChipActivitySnapshot(ctx.tenantId);
      return res.json({ ok: true, ...snapshot });
    } catch (e) {
      console.error('[chip-protection/clear-lock]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível encerrar o cooldown.' });
    }
  });

  /**
   * Reseta os contadores do circuit breaker (Redis) de todos os chips do tenant.
   * Use após resolver instabilidade de infraestrutura para destravar disparos imediatamente.
   */
  app.post('/api/chip-protection/reset-circuit', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const connections = getConnectionsForTenant(ctx.tenantId);
      const breaker = getChipCircuitBreaker();
      await breaker.resetMany(connections.map((c) => c.id));
      console.log(`[ChipProtection] Circuit breaker resetado para ${connections.length} chips tenant=${ctx.tenantId}`);
      const snapshot = await getChipActivitySnapshot(ctx.tenantId);
      return res.json({ ok: true, chipsReset: connections.length, ...snapshot });
    } catch (e) {
      console.error('[chip-protection/reset-circuit]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível resetar o circuit breaker.' });
    }
  });
}
