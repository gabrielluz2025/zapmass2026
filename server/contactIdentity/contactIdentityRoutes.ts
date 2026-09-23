import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from '../auth/dataMode.js';
import { getZapmassPool } from '../db/postgres.js';
import { requireTenant } from '../httpTenant.js';
import { buildContactProfile, reconcileContactFromChannels } from './contactProfileService.js';
import { listContactEvents } from './contactEventsRepository.js';
import { canonicalContactPhoneDigits } from './contactPhone.js';

function safeDecodeUriComponent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function registerContactIdentityRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/contacts/identity/:phone', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const phone = safeDecodeUriComponent(String(req.params.phone || ''));
    const profile = await buildContactProfile(ctx.tenantId, phone);
    if (!profile) {
      return res.status(400).json({ ok: false, error: 'Telefone inválido.' });
    }
    return res.json({ ok: true, profile });
  });

  app.get('/api/contacts/identity/:phone/timeline', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const phone = safeDecodeUriComponent(String(req.params.phone || ''));
    const digits = canonicalContactPhoneDigits(phone);
    if (digits.length < 8) {
      return res.status(400).json({ ok: false, error: 'Telefone inválido.' });
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const events = await listContactEvents(ctx.tenantId, digits, limit);
    return res.json({
      ok: true,
      phoneDigits: digits,
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        at: e.created_at.toISOString(),
        connectionId: e.connection_id,
        campaignId: e.campaign_id,
        payload: e.payload,
      })),
    });
  });

  app.post('/api/contacts/identity/:phone/reconcile', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const phone = safeDecodeUriComponent(String(req.params.phone || ''));
    const digits = canonicalContactPhoneDigits(phone);
    if (digits.length < 8) {
      return res.status(400).json({ ok: false, error: 'Telefone inválido.' });
    }
    await reconcileContactFromChannels(ctx.tenantId, digits);
    const profile = await buildContactProfile(ctx.tenantId, digits);
    return res.json({ ok: true, profile });
  });
}
