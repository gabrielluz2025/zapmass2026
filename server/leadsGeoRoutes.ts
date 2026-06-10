import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import {
  getGoogleMapsJsApiKey,
  isGoogleGeocodeEnabled,
  isGoogleMapsJsEnabled
} from './googleGeocode.js';
import {
  buildLeadsGeoSummary,
  geocodeContactsWithAddress,
  geocodeLeadsGeoClusters,
  isContactGeocodeAvailable
} from './leadsGeoService.js';

export function registerLeadsGeoRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/leads-geo/config', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    return res.json({
      ok: true,
      /** Mapa usa OpenStreetMap — funciona sem chave Google. */
      enabled: true,
      mapProvider: 'openstreetmap',
      geocodeEnabled: isContactGeocodeAvailable(),
      nominatimEnabled: process.env.NOMINATIM_DISABLED !== '1',
      googleMapsAvailable: isGoogleMapsJsEnabled(),
      mapKey: getGoogleMapsJsApiKey() || null
    });
  });

  app.get('/api/leads-geo/summary', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const q = req.query as Record<string, string | undefined>;
    const layer = q.layer as 'neighborhood' | 'city' | 'ddd' | 'state' | undefined;
    try {
      const summary = await buildLeadsGeoSummary(ctx.tenantId, {
        layer,
        state: q.state,
        city: q.city,
        ddd: q.ddd,
        neighborhood: q.neighborhood,
        name: q.name?.trim() || undefined
      });
      return res.json({ ok: true, ...summary });
    } catch (e) {
      console.error('[api/leads-geo/summary]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível montar o mapa de leads.' });
    }
  });

  app.post('/api/leads-geo/geocode-clusters', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body || {}) as {
      max?: number;
      layer?: string;
      force?: boolean;
      city?: string;
      neighborhood?: string;
    };
    const max = Number(body.max) || 60;
    const layer = body.layer as 'neighborhood' | 'city' | 'ddd' | 'state' | undefined;
    try {
      const result = await geocodeLeadsGeoClusters(ctx.tenantId, {
        max,
        layer,
        force: body.force === true,
        city: body.city,
        neighborhood: body.neighborhood
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ ok: false, error: msg });
    }
  });

  app.post('/api/leads-geo/geocode-contacts', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body || {}) as {
      max?: number;
      city?: string;
      neighborhood?: string;
      force?: boolean;
    };
    const max = Number(body.max) || 60;
    try {
      const result = await geocodeContactsWithAddress(ctx.tenantId, {
        max,
        city: body.city,
        neighborhood: body.neighborhood,
        force: body.force === true
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ ok: false, error: msg });
    }
  });
}
