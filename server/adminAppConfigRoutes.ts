import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
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

type AdminUserAccessRow = {
  uid: string;
  email: string;
  status: string;
  provider: string;
  plan: string | null;
  blocked: boolean;
  manualGrant: boolean;
  trialEndsAt: string | null;
  accessEndsAt: string | null;
  manualAccessEndsAt: string | null;
  adminNote: string;
  updatedAt: string | null;
};

type AdminAccessAuditRow = {
  id: string;
  targetUid: string;
  targetEmail: string;
  adminUid: string;
  adminEmail: string;
  action: string;
  note: string;
  createdAt: string | null;
};

function tsToIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof v === 'string') return v;
  return null;
}

async function rowFromSubscriptionDoc(
  uid: string,
  data: Record<string, unknown> | undefined,
  authEmailCache: Map<string, string>,
  fallbackEmail = ''
): Promise<AdminUserAccessRow> {
  let email = fallbackEmail || authEmailCache.get(uid) || '';
  if (!email) {
    try {
      const adminApp = getFirebaseAdmin();
      if (adminApp) {
        const user = await getAuth(adminApp).getUser(uid);
        email = user.email || '';
        if (email) authEmailCache.set(uid, email);
      }
    } catch {
      /* ignore */
    }
  }
  return {
    uid,
    email,
    status: typeof data?.status === 'string' ? data.status : 'none',
    provider: typeof data?.provider === 'string' ? data.provider : 'none',
    plan: typeof data?.plan === 'string' ? data.plan : null,
    blocked: data?.blocked === true,
    manualGrant: data?.manualGrant === true,
    trialEndsAt: tsToIso(data?.trialEndsAt),
    accessEndsAt: tsToIso(data?.accessEndsAt),
    manualAccessEndsAt: tsToIso(data?.manualAccessEndsAt),
    adminNote: typeof data?.adminNote === 'string' ? data.adminNote : '',
    updatedAt: tsToIso(data?.updatedAt)
  };
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

  app.get('/api/admin/access-users', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;
      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }
      const db = getFirestore(adminApp);
      const search = String(req.query.search || '').trim().toLowerCase();
      const snap = await db.collection('userSubscriptions').orderBy('updatedAt', 'desc').limit(500).get();
      const authEmailCache = new Map<string, string>();
      let rows = await Promise.all(
        snap.docs.map((d) => rowFromSubscriptionDoc(d.id, d.data() as Record<string, unknown>, authEmailCache))
      );

      if (search) {
        rows = rows.filter((r) => r.uid.toLowerCase().includes(search) || r.email.toLowerCase().includes(search));
      }

      // Busca pontual por e-mail mesmo se ainda não existir doc em userSubscriptions.
      if (search.includes('@') && !rows.some((r) => r.email.toLowerCase() === search)) {
        try {
          const u = await getAuth(adminApp).getUserByEmail(search);
          const subSnap = await db.collection('userSubscriptions').doc(u.uid).get();
          if (subSnap.exists) {
            rows.unshift(
              await rowFromSubscriptionDoc(u.uid, subSnap.data() as Record<string, unknown>, authEmailCache, u.email || search)
            );
          } else {
            rows.unshift({
              uid: u.uid,
              email: u.email || search,
              status: 'none',
              provider: 'none',
              plan: null,
              blocked: false,
              manualGrant: false,
              trialEndsAt: null,
              accessEndsAt: null,
              manualAccessEndsAt: null,
              adminNote: '',
              updatedAt: null
            });
          }
        } catch {
          /* ignore */
        }
      }

      return res.json({ ok: true, users: rows });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/admin/access-users]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.put('/api/admin/access-user', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;
      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }
      const db = getFirestore(adminApp);
      const body = (req.body || {}) as {
        uid?: string;
        email?: string;
        blocked?: boolean;
        manualGrant?: boolean;
        grantDays?: number | null;
        grantMode?: 'set' | 'extend';
        adminNote?: string;
      };

      let uid = String(body.uid || '').trim();
      let email = String(body.email || '').trim().toLowerCase();
      if (!uid && !email) {
        return res.status(400).json({ ok: false, error: 'Informe uid ou email.' });
      }
      if (!uid && email) {
        const u = await getAuth(adminApp).getUserByEmail(email);
        uid = u.uid;
        email = (u.email || email).toLowerCase();
      }

      const ref = db.collection('userSubscriptions').doc(uid);
      const curSnap = await ref.get();
      const cur = (curSnap.data() || {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp()
      };

      if (typeof body.blocked === 'boolean') {
        updates.blocked = body.blocked;
      }
      if (typeof body.adminNote === 'string') {
        updates.adminNote = body.adminNote.trim();
      }

      if (typeof body.manualGrant === 'boolean') {
        updates.manualGrant = body.manualGrant;
        if (body.manualGrant) {
          const days = Number(body.grantDays || 0);
          if (Number.isFinite(days) && days > 0) {
            const mode = body.grantMode === 'extend' ? 'extend' : 'set';
            const currentManualEnd = tsToIso(cur.manualAccessEndsAt);
            const currentManualMs = currentManualEnd ? new Date(currentManualEnd).getTime() : 0;
            const baseMs = mode === 'extend' ? Math.max(Date.now(), currentManualMs || 0) : Date.now();
            const end = new Date(baseMs + days * 24 * 60 * 60 * 1000);
            updates.manualAccessEndsAt = Timestamp.fromDate(end);
          } else {
            updates.manualAccessEndsAt = null;
          }
          updates.status = 'active';
          updates.provider = typeof cur.provider === 'string' ? cur.provider : 'none';
          updates.plan = typeof cur.plan === 'string' ? cur.plan : null;
          updates.manualGrantedAt = FieldValue.serverTimestamp();
          updates.manualGrantedBy = auth.email;
        } else {
          updates.manualAccessEndsAt = FieldValue.delete();
          updates.manualGrantedAt = FieldValue.delete();
          updates.manualGrantedBy = FieldValue.delete();
          if ((cur.provider || 'none') === 'none') {
            updates.status = 'none';
            updates.plan = null;
          }
        }
      }

      await ref.set(updates, { merge: true });
      const next = await ref.get();
      const row = await rowFromSubscriptionDoc(uid, next.data() as Record<string, unknown>, new Map(), email);

      // Auditoria administrativa para rastrear ações críticas de acesso.
      let action = 'update';
      if (typeof body.blocked === 'boolean') {
        action = body.blocked ? 'block' : 'unblock';
      } else if (typeof body.manualGrant === 'boolean') {
        action = body.manualGrant ? (body.grantMode === 'extend' ? 'extend-manual-access' : 'grant-manual-access') : 'revoke-manual-access';
      }
      await db.collection('adminAccessAudit').add({
        targetUid: uid,
        targetEmail: row.email || email || '',
        adminUid: auth.uid,
        adminEmail: auth.email,
        action,
        note: typeof body.adminNote === 'string' ? body.adminNote.trim() : '',
        createdAt: FieldValue.serverTimestamp()
      });

      console.log('[api/admin/access-user] atualizado por', auth.email, '=>', uid);
      return res.json({ ok: true, user: row });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/admin/access-user]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get('/api/admin/access-audit', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;
      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }
      const db = getFirestore(adminApp);
      const rawLimit = Number(req.query.limit || 100);
      const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(300, Math.round(rawLimit))) : 100;
      const snap = await db.collection('adminAccessAudit').orderBy('createdAt', 'desc').limit(limit).get();
      const rows: AdminAccessAuditRow[] = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          targetUid: typeof x.targetUid === 'string' ? x.targetUid : '',
          targetEmail: typeof x.targetEmail === 'string' ? x.targetEmail : '',
          adminUid: typeof x.adminUid === 'string' ? x.adminUid : '',
          adminEmail: typeof x.adminEmail === 'string' ? x.adminEmail : '',
          action: typeof x.action === 'string' ? x.action : 'update',
          note: typeof x.note === 'string' ? x.note : '',
          createdAt: tsToIso(x.createdAt)
        };
      });
      return res.json({ ok: true, audit: rows });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/admin/access-audit]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
