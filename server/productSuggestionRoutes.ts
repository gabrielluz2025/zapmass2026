import type { Express, Request, Response } from 'express';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { parseBearer, resolveAuthPrincipal } from './resolveAuth.js';
import { sendSuggestionNotificationEmail } from './emailService.js';

function getPublicOrigin(req: Request): string {
  const env = (process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  return host ? `${proto}://${host}` : '';
}

export function registerProductSuggestionRoutes(app: Express): void {
  app.post('/api/product-suggestion', async (req: Request, res: Response) => {
    try {
      const token = parseBearer(req);
      if (!token) {
        return res.status(401).json({ ok: false, error: 'Autenticação em falta.' });
      }
      const principal = await resolveAuthPrincipal(token);
      if (!principal) {
        return res.status(401).json({ ok: false, error: 'Token inválido ou expirado.' });
      }
      const tenantId = principal.tenantUid;
      const actorId = principal.authUid;
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (text.length < 1) {
        return res.status(400).json({ ok: false, error: 'Escreva uma sugestão.' });
      }
      if (text.length > 8000) {
        return res.status(400).json({ ok: false, error: 'Texto demasiado longo.' });
      }
      const screen = typeof req.body?.screen === 'string' ? req.body.screen.slice(0, 64) : '';
      const categoryRaw = typeof req.body?.category === 'string' ? req.body.category.trim().toLowerCase() : '';
      const allowedCat = new Set(['usability', 'campaigns', 'reports', 'integrations', 'other']);
      const category = allowedCat.has(categoryRaw) ? categoryRaw : 'other';
      const email = (principal.email || '').slice(0, 320);
      const createdAt = new Date();

      if (vpsDataEnabled() && getZapmassPool()) {
        await getZapmassPool()!.query(
          `INSERT INTO zapmass.product_suggestions
             (tenant_id, actor_subject_id, email, text, screen, category, created_at)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
          [tenantId, actorId, email, text, screen, category, createdAt]
        );
      } else {
        const adminApp = getFirebaseAdmin();
        if (!adminApp) {
          return res.status(503).json({ ok: false, error: 'Servidor sem Firebase Admin configurado.' });
        }
        const db = getFirestore(adminApp);
        await db.collection('users').doc(tenantId).collection('suggestions').add({
          text,
          createdAt: FieldValue.serverTimestamp(),
          screen,
          category,
          email
        });
      }

      const origin = getPublicOrigin(req);
      void sendSuggestionNotificationEmail({
        suggesterUid: actorId,
        suggesterEmail: email,
        text,
        screen,
        category,
        createdAt,
        adminPanelUrl: origin ? `${origin}/admin` : undefined
      }).catch((e) => console.warn('[product-suggestion] email', e));

      return res.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/product-suggestion]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
