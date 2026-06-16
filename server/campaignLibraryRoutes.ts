import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import {
  listLibraryItems,
  createLibraryItem,
  deleteLibraryItem
} from './repositories/campaignLibraryRepository.js';

type Kind = 'templates' | 'segments';

function parseKind(raw: string | undefined): Kind | null {
  if (raw === 'templates' || raw === 'segments') return raw;
  return null;
}

export function registerCampaignLibraryRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  // Lista modelos ou segmentos do tenant.
  app.get('/api/campaign-library/:kind', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const kind = parseKind(req.params.kind);
    if (!kind) return res.status(400).json({ ok: false, error: 'Tipo inválido.' });
    try {
      const items = await listLibraryItems(ctx.tenantId, kind);
      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[api/campaign-library list]', e);
      return res.status(500).json({ ok: false, error: 'Falha ao carregar a biblioteca.' });
    }
  });

  // Cria um novo modelo/segmento.
  app.post('/api/campaign-library/:kind', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const kind = parseKind(req.params.kind);
    if (!kind) return res.status(400).json({ ok: false, error: 'Tipo inválido.' });
    const body = (req.body || {}) as { name?: string; doc?: Record<string, unknown> };
    const name = (body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Informe um nome.' });
    try {
      const item = await createLibraryItem(ctx.tenantId, kind, name, body.doc ?? {});
      if (!item) return res.status(500).json({ ok: false, error: 'Não foi possível salvar.' });
      return res.json({ ok: true, item });
    } catch (e) {
      console.error('[api/campaign-library create]', e);
      return res.status(500).json({ ok: false, error: 'Falha ao salvar na biblioteca.' });
    }
  });

  // Remove um item.
  app.delete('/api/campaign-library/:kind/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const kind = parseKind(req.params.kind);
    if (!kind) return res.status(400).json({ ok: false, error: 'Tipo inválido.' });
    try {
      const ok = await deleteLibraryItem(ctx.tenantId, kind, req.params.id);
      return res.json({ ok });
    } catch (e) {
      console.error('[api/campaign-library delete]', e);
      return res.status(500).json({ ok: false, error: 'Falha ao remover.' });
    }
  });
}
