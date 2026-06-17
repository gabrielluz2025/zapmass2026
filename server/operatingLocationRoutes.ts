import type { Express, Request, Response } from 'express';
import { getClientIp, isPrivateOrLoopbackIp } from './clientIp.js';
import { requireTenant } from './httpTenant.js';
import { resolveIpGeolocation } from './ipGeolocation.js';
import { reverseGeocodeNominatim } from './nominatimGeocode.js';
import {
  loadOperatingLocation,
  normalizeCityLabel,
  saveOperatingLocation,
  type OperatingLocationSource
} from './tenantOperatingLocation.js';

export function registerOperatingLocationRoutes(app: Express): void {
  app.get('/api/operating-location', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const location = await loadOperatingLocation(ctx.tenantId);
      return res.json({ ok: true, location });
    } catch (e) {
      console.error('[api/operating-location GET]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível carregar a localização.' });
    }
  });

  app.patch('/api/operating-location', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as {
      cityLabel?: unknown;
      source?: unknown;
      latitude?: unknown;
      longitude?: unknown;
    };
    const cityLabel =
      typeof body.cityLabel === 'string' ? normalizeCityLabel(body.cityLabel) : undefined;
    if (cityLabel !== undefined && cityLabel.length < 3) {
      return res.status(400).json({ ok: false, error: 'Informe cidade e UF (ex.: Blumenau · SC).' });
    }
    const source: OperatingLocationSource | undefined =
      body.source === 'gps' || body.source === 'manual' || body.source === 'ip'
        ? body.source
        : 'manual';
    const lat = body.latitude !== undefined ? Number(body.latitude) : undefined;
    const lng = body.longitude !== undefined ? Number(body.longitude) : undefined;

    try {
      const location = await saveOperatingLocation(ctx.tenantId, {
        ...(cityLabel ? { cityLabel } : {}),
        source,
        ...(Number.isFinite(lat) ? { latitude: lat } : {}),
        ...(Number.isFinite(lng) ? { longitude: lng } : {})
      });
      return res.json({ ok: true, location });
    } catch (e) {
      console.error('[api/operating-location PATCH]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível salvar a localização.' });
    }
  });

  app.post('/api/operating-location/from-gps', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as { latitude?: unknown; longitude?: unknown };
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: 'Coordenadas GPS inválidas.' });
    }

    const rev = await reverseGeocodeNominatim(lat, lng);
    if (rev.ok === false) {
      const msg =
        rev.status === 'DISABLED'
          ? 'Geocodificação desativada no servidor.'
          : rev.status === 'ZERO_RESULTS'
            ? 'Não foi possível identificar a cidade a partir do GPS.'
            : 'Falha ao converter GPS em cidade. Tente informar manualmente.';
      return res.status(422).json({ ok: false, error: msg, status: rev.status });
    }

    try {
      const location = await saveOperatingLocation(ctx.tenantId, {
        cityLabel: rev.label,
        latitude: rev.lat,
        longitude: rev.lng,
        source: 'gps'
      });
      return res.json({ ok: true, location, resolved: rev });
    } catch (e) {
      console.error('[api/operating-location/from-gps]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível salvar a localização.' });
    }
  });

  app.post('/api/operating-location/from-ip', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;

    const clientIp = getClientIp(req);
    if (!clientIp || isPrivateOrLoopbackIp(clientIp)) {
      return res.status(422).json({
        ok: false,
        error: 'Não foi possível detectar sua localização pela rede. Informe a cidade manualmente.',
        status: 'PRIVATE_IP'
      });
    }

    const geo = await resolveIpGeolocation(clientIp);
    if (geo.ok === false) {
      const msg =
        geo.status === 'DISABLED'
          ? 'Detecção automática de localização desativada no servidor.'
          : 'Não foi possível detectar sua localização pela rede. Informe a cidade manualmente.';
      return res.status(422).json({ ok: false, error: msg, status: geo.status });
    }

    try {
      const location = await saveOperatingLocation(ctx.tenantId, {
        cityLabel: geo.cityLabel,
        latitude: geo.latitude,
        longitude: geo.longitude,
        source: 'ip'
      });
      return res.json({ ok: true, location, resolved: geo });
    } catch (e) {
      console.error('[api/operating-location/from-ip]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível salvar a localização.' });
    }
  });
}
