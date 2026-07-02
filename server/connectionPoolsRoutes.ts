import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import {
  listConnectionPoolsPg,
  getConnectionPoolPg,
  createConnectionPoolPg,
  updateConnectionPoolPg,
  deleteConnectionPoolPg,
} from './repositories/connectionPoolsRepository.js';

export function registerConnectionPoolsRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  // GET /api/connection-pools — lista todos os pools do tenant
  app.get('/api/connection-pools', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const pools = await listConnectionPoolsPg(ctx.tenantId);
      return res.json({ ok: true, pools });
    } catch (err: unknown) {
      return res.status(500).json({ ok: false, error: (err as Error)?.message || 'Erro ao listar pools.' });
    }
  });

  // GET /api/connection-pools/:id
  app.get('/api/connection-pools/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const p = await getConnectionPoolPg(ctx.tenantId, req.params.id);
      if (!p) return res.status(404).json({ ok: false, error: 'Pool não encontrado.' });
      return res.json({ ok: true, pool: p });
    } catch (err: unknown) {
      return res.status(500).json({ ok: false, error: (err as Error)?.message || 'Erro.' });
    }
  });

  // POST /api/connection-pools — cria novo pool
  app.post('/api/connection-pools', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const { name, connectionIds, channelWeights, strategy } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'Nome é obrigatório.' });
    }
    if (!Array.isArray(connectionIds) || connectionIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'Selecione pelo menos um chip.' });
    }
    try {
      const pool = await createConnectionPoolPg(ctx.tenantId, { name, connectionIds, channelWeights, strategy });
      return res.status(201).json({ ok: true, pool });
    } catch (err: unknown) {
      return res.status(500).json({ ok: false, error: (err as Error)?.message || 'Erro ao criar pool.' });
    }
  });

  // PUT /api/connection-pools/:id — atualiza pool existente
  app.put('/api/connection-pools/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const { name, connectionIds, channelWeights, strategy } = req.body || {};
    try {
      const pool = await updateConnectionPoolPg(ctx.tenantId, req.params.id, { name, connectionIds, channelWeights, strategy });
      if (!pool) return res.status(404).json({ ok: false, error: 'Pool não encontrado.' });
      return res.json({ ok: true, pool });
    } catch (err: unknown) {
      return res.status(500).json({ ok: false, error: (err as Error)?.message || 'Erro ao atualizar pool.' });
    }
  });

  // DELETE /api/connection-pools/:id
  app.delete('/api/connection-pools/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const deleted = await deleteConnectionPoolPg(ctx.tenantId, req.params.id);
      if (!deleted) return res.status(404).json({ ok: false, error: 'Pool não encontrado.' });
      return res.json({ ok: true });
    } catch (err: unknown) {
      return res.status(500).json({ ok: false, error: (err as Error)?.message || 'Erro ao excluir pool.' });
    }
  });
}
