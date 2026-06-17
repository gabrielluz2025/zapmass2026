import type { Express, Request, Response } from 'express';
import { assertAdminFromBearer } from './adminAuth.js';
import { invalidateAppConfigCache } from './appConfigStore.js';
import {
  loadSystemAnnouncementPg,
  saveSystemAnnouncementPg
} from './repositories/appConfigRepository.js';
import { broadcastNotificationPg } from './repositories/notificationsRepository.js';
import { sanitizeAnnouncementInput, type SystemAnnouncementKind } from './systemAnnouncement.js';

function kindToNotificationKind(kind: SystemAnnouncementKind): 'info' | 'warning' | 'error' {
  return kind;
}

export function registerAdminSystemAnnouncementRoutes(app: Express): void {
  app.get('/api/admin/system-announcement', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;
      const announcement = await loadSystemAnnouncementPg();
      return res.json({ ok: true, announcement });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.post('/api/admin/system-announcement', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;

      const parsed = sanitizeAnnouncementInput((req.body || {}) as Record<string, unknown>);
      if (!parsed) {
        return res.status(400).json({ ok: false, error: 'Informe título e mensagem.' });
      }

      const announcement = {
        active: true,
        title: parsed.title,
        body: parsed.message,
        kind: parsed.kind,
        showBanner: parsed.showBanner,
        updatedAt: new Date().toISOString(),
        expiresAt: parsed.expiresAt,
        publishedBy: auth.email
      };

      await saveSystemAnnouncementPg(announcement);
      invalidateAppConfigCache();

      let bellCount = 0;
      if (parsed.pushToBell) {
        bellCount = await broadcastNotificationPg({
          title: parsed.title,
          body: parsed.message,
          kind: kindToNotificationKind(parsed.kind)
        });
      }

      console.log(
        '[api/admin/system-announcement] publicado por',
        auth.email,
        'bell=',
        bellCount
      );

      return res.json({
        ok: true,
        announcement,
        bellCount
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/admin/system-announcement POST]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.delete('/api/admin/system-announcement', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;
      await saveSystemAnnouncementPg(null);
      invalidateAppConfigCache();
      console.log('[api/admin/system-announcement] removido por', auth.email);
      return res.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
