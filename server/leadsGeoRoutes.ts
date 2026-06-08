import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import { getGoogleMapsApiKey, isGoogleGeocodeEnabled } from './googleGeocode.js';
import {
  buildLeadsGeoSummary,
  geocodeContactsWithAddress,
  geocodeLeadsGeoClusters
} from './leadsGeoService.js';

export function registerLeadsGeoRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/leads-geo/config', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const key = getGoogleMapsApiKey();
    return res.json({
      ok: true,
      enabled: isGoogleGeocodeEnabled(),
      /** Chave para Maps JavaScript API (restrinja por domínio no Google Cloud). */
      mapKey: key || null
    });
  });

  app.get('/api/leads-geo/summary', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const summary = await buildLeadsGeoSummary(ctx.tenantId);
      return res.json({ ok: true, ...summary });
    } catch (e) {
      console.error('[api/leads-geo/summary]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível montar o mapa de leads.' });
    }
  });

  app.post('/api/leads-geo/geocode-clusters', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const max = Number((req.body as { max?: number })?.max) || 40;
    try {
      const result = await geocodeLeadsGeoClusters(ctx.tenantId, { max });
      return res.json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ ok: false, error: msg });
    }
  });

  app.post('/api/leads-geo/geocode-contacts', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const max = Number((req.body as { max?: number })?.max) || 25;
    try {
      const result = await geocodeContactsWithAddress(ctx.tenantId, { max });
      return res.json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ ok: false, error: msg });
    }
  });
}
