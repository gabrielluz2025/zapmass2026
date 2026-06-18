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
import { ensureIbgeMunicipiosIndex, getIbgeMunicipiosIndex } from './ibgeMunicipios.js';
import { resolveCitySearchLabel, searchIbgeCities } from '../src/utils/ibgeCityLookup.js';
import { parseGeoFilterCity } from '../src/utils/contactAddressNormalize.js';

function registerCityLookupHandlers(app: Express): void {
  const citySuggest = async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 12, 20);
    if (!q || q.length < 2) return res.json({ ok: true, suggestions: [] });
    try {
      const ibgeIndex = await ensureIbgeMunicipiosIndex().catch(() => getIbgeMunicipiosIndex());
      if (!ibgeIndex) return res.json({ ok: true, suggestions: [] });
      return res.json({ ok: true, suggestions: searchIbgeCities(ibgeIndex, q, limit) });
    } catch (e) {
      console.warn('[api/geo/city-suggest]', e);
      return res.json({ ok: true, suggestions: [] });
    }
  };

  const cityResolve = async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ ok: true, resolved: null });
    try {
      const ibgeIndex = await ensureIbgeMunicipiosIndex().catch(() => getIbgeMunicipiosIndex());
      if (!ibgeIndex) return res.json({ ok: true, resolved: null });
      const resolved = resolveCitySearchLabel(ibgeIndex, q);
      return res.json({ ok: true, resolved });
    } catch (e) {
      console.warn('[api/geo/city-resolve]', e);
      return res.json({ ok: true, resolved: null });
    }
  };

  app.get('/api/geo/city-suggest', citySuggest);
  app.get('/api/geo/city-resolve', cityResolve);
  // Compat — rotas antigas em contacts (quando VPS ativo)
  app.get('/api/contacts/city-suggest', citySuggest);
  app.get('/api/contacts/city-resolve', cityResolve);
}

export function registerOperatingLocationRoutes(app: Express): void {
  registerCityLookupHandlers(app);
  app.get('/api/geo/official-neighborhoods', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const city = String(req.query.city || '').trim();
    if (!city || city.length < 2) {
      return res.status(400).json({ ok: false, error: 'Informe cidade · UF.' });
    }
    const fc = parseGeoFilterCity(city);
    try {
      const ibgeIndex = await ensureIbgeMunicipiosIndex().catch(() => getIbgeMunicipiosIndex());
      const { resolveOfficialNeighborhoods } = await import('./municipalityNeighborhoods.js');
      const neighborhoods = await resolveOfficialNeighborhoods(fc.city, fc.state, ibgeIndex);
      return res.json({ ok: true, city: fc.city, state: fc.state, neighborhoods });
    } catch (e) {
      console.warn('[api/geo/official-neighborhoods]', e);
      return res.json({ ok: true, city: fc.city, state: fc.state, neighborhoods: [] });
    }
  });

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
    let resolvedCityLabel = cityLabel;
    if (typeof body.cityLabel === 'string' && body.cityLabel.trim().length >= 2) {
      try {
        const ibgeIndex = await ensureIbgeMunicipiosIndex().catch(() => getIbgeMunicipiosIndex());
        const resolved = resolveCitySearchLabel(ibgeIndex, body.cityLabel);
        if (resolved?.label) resolvedCityLabel = resolved.label;
      } catch {
        /* mantém normalizeCityLabel */
      }
    }
    const source: OperatingLocationSource | undefined =
      body.source === 'gps' || body.source === 'manual' || body.source === 'ip'
        ? body.source
        : 'manual';
    const lat = body.latitude !== undefined ? Number(body.latitude) : undefined;
    const lng = body.longitude !== undefined ? Number(body.longitude) : undefined;

    try {
      const location = await saveOperatingLocation(ctx.tenantId, {
        ...(resolvedCityLabel ? { cityLabel: resolvedCityLabel } : {}),
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
