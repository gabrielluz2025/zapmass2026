import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { defaultAppConfig, loadAppConfig, saveAppConfigMerge, type AppConfigGlobal } from './appConfigStore.js';

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function adminEmailSet(): Set<string> {
  const raw = process.env.ADMIN_EMAILS?.trim() || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function assertAdminFromBearer(req: Request, res: Response): Promise<{ uid: string; email: string } | null> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
    return null;
  }
  const token = parseBearer(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <Firebase ID token>.' });
    return null;
  }
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token);
    const email = typeof decoded.email === 'string' ? decoded.email : '';
    const allow = adminEmailSet();
    const claimAdmin = decoded.admin === true;
    if (!claimAdmin && (!email || !allow.has(email.toLowerCase()))) {
      res.status(403).json({ ok: false, error: 'Acesso restrito a administradores.' });
      return null;
    }
    return { uid: decoded.uid, email: email || decoded.uid };
  } catch {
    res.status(401).json({ ok: false, error: 'Token Firebase invalido ou expirado.' });
    return null;
  }
}

function sanitizePutBody(body: unknown): Partial<AppConfigGlobal> {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const out: Partial<AppConfigGlobal> = {};
  if (typeof b.marketingPriceMonthly === 'string') out.marketingPriceMonthly = b.marketingPriceMonthly;
  if (typeof b.marketingPriceAnnual === 'string') out.marketingPriceAnnual = b.marketingPriceAnnual;
  if (typeof b.landingTrialTitle === 'string') out.landingTrialTitle = b.landingTrialTitle;
  if (typeof b.landingTrialBody === 'string') out.landingTrialBody = b.landingTrialBody;
  if (typeof b.trialHours === 'number' && Number.isFinite(b.trialHours)) out.trialHours = b.trialHours;
  else if (typeof b.trialHours === 'string' && b.trialHours.trim()) {
    const n = Number(b.trialHours);
    if (Number.isFinite(n)) out.trialHours = n;
  }
  return out;
}

export function registerAdminAppConfigRoutes(app: Express): void {
  app.get('/api/app-config', async (_req: Request, res: Response) => {
    try {
      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.json({ ok: true, config: defaultAppConfig() });
      }
      const db = getFirestore(adminApp);
      const config = await loadAppConfig(db);
      return res.json({ ok: true, config });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/app-config]', msg);
      return res.json({ ok: true, config: defaultAppConfig() });
    }
  });

  app.put('/api/admin/app-config', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;

      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }
      const partial = sanitizePutBody(req.body);
      if (Object.keys(partial).length === 0) {
        return res.status(400).json({ ok: false, error: 'Nenhum campo valido no corpo da requisicao.' });
      }
      const db = getFirestore(adminApp);
      const config = await saveAppConfigMerge(db, partial);
      console.log('[api/admin/app-config] atualizado por', auth.email);
      return res.json({ ok: true, config });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/admin/app-config]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
