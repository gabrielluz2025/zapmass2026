import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import { getAppProfileSegmentPg, saveAppProfileSegmentPg } from './repositories/appProfileRepository.js';
import {
  deleteNotificationPg,
  listNotificationsPg,
  markAllNotificationsReadPg,
  markNotificationReadPg
} from './repositories/notificationsRepository.js';
import { getUserSubscription } from './subscriptionStore.js';
import type { UserSubscription } from '../src/types.js';

const SEGMENT_IDS = new Set(['religious', 'sales', 'collections', 'mass_broadcast', 'general']);

function subscriptionToClient(doc: Record<string, unknown> | null): UserSubscription | null {
  if (!doc) return null;
  return doc as unknown as UserSubscription;
}

export function registerPlatformDataRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/subscription', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    if (ctx.principal.role === 'staff') {
      return res.json({ ok: true, subscription: null, readOnlyForStaff: true });
    }
    const doc = await getUserSubscription(ctx.tenantId);
    return res.json({
      ok: true,
      subscription: subscriptionToClient((doc as unknown as Record<string, unknown>) || null)
    });
  });

  app.get('/api/notifications', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const limit = Math.min(Number(req.query.limit) || 80, 200);
    const rows = await listNotificationsPg(ctx.tenantId, limit);
    const notifications = rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      kind: r.kind,
      category: r.category,
      read: r.read,
      createdAtMs: r.created_at.getTime(),
      campaignId: r.campaign_id || undefined
    }));
    const unreadCount = notifications.filter((n) => !n.read).length;
    return res.json({ ok: true, notifications, unreadCount });
  });

  app.patch('/api/notifications/:id/read', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id ausente.' });
    await markNotificationReadPg(ctx.tenantId, id);
    return res.json({ ok: true });
  });

  app.post('/api/notifications/read-all', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    await markAllNotificationsReadPg(ctx.tenantId);
    return res.json({ ok: true });
  });

  app.delete('/api/notifications/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id ausente.' });
    await deleteNotificationPg(ctx.tenantId, id);
    return res.json({ ok: true });
  });

  app.get('/api/app-profile', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const segment = await getAppProfileSegmentPg(ctx.tenantId);
    return res.json({ ok: true, useSegment: segment });
  });

  app.put('/api/app-profile', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    if (ctx.principal.role === 'staff') {
      return res.status(403).json({ ok: false, error: 'Somente o dono pode alterar o segmento.' });
    }
    const raw = typeof req.body?.useSegment === 'string' ? req.body.useSegment.trim() : '';
    if (!SEGMENT_IDS.has(raw)) {
      return res.status(400).json({ ok: false, error: 'Segmento inválido.' });
    }
    await saveAppProfileSegmentPg(ctx.tenantId, raw);
    return res.json({ ok: true, useSegment: raw });
  });
}
