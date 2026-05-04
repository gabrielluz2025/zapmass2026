import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { assertAdminFromBearer, adminEmailSet } from './adminAuth.js';
import { defaultAppConfig, loadAppConfig, saveAppConfigMerge, type AppConfigGlobal } from './appConfigStore.js';
import { loadMergedUserInsightData } from './insightMerge.js';
import { sendSuggestionReplyEmail } from './emailService.js';

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
  manualExtraChannelSlots: number;
  manualExtraChannelSlotsEndsAt: string | null;
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

type AdminUserInsights = {
  uid: string;
  email: string;
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  firstActivityAt: string | null;
  daysSinceFirstActivity: number;
  counts: {
    contactsTotal: number;
    contactsValid: number;
    contactsInvalid: number;
    contactLists: number;
    connectionsTotal: number;
    connectionsConnected: number;
    campaignsTotal: number;
    campaignsRunning: number;
    campaignsCompleted: number;
  };
  campaignTotals: {
    targeted: number;
    processed: number;
    success: number;
    failed: number;
  };
  contactTagsTop: Array<{ tag: string; count: number }>;
  listSegmentsTop: Array<{ listName: string; contacts: number }>;
  recentCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string | null;
    successCount: number;
    failedCount: number;
    totalContacts: number;
  }>;
  /** Tempo acumulado com aba visível e ligado ao servidor (por conta). */
  usage: {
    totalActiveMs: number;
    lastActiveAt: string | null;
  } | null;
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

function asEpoch(v: unknown): number {
  if (!v) return 0;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (v as { toDate: () => Date }).toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
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
    manualExtraChannelSlots: Math.max(0, Math.min(3, Math.floor(Number(data?.manualExtraChannelSlots) || 0))),
    manualExtraChannelSlotsEndsAt: tsToIso(data?.manualExtraChannelSlotsEndsAt),
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
      const adminEmails = adminEmailSet();
      rows = rows.filter((r) => !r.email || !adminEmails.has(r.email.toLowerCase()));

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
              manualExtraChannelSlots: 0,
              manualExtraChannelSlotsEndsAt: null,
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
        manualExtraChannelSlots?: number | null;
        channelGrantDays?: number | null;
        channelGrantMonths?: number | null;
        channelGrantMode?: 'set' | 'extend';
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

      if (body.manualExtraChannelSlots != null) {
        const slots = Math.max(0, Math.min(3, Math.floor(Number(body.manualExtraChannelSlots) || 0)));
        updates.manualExtraChannelSlots = slots;
        if (slots <= 0) {
          updates.manualExtraChannelSlotsEndsAt = FieldValue.delete();
        } else {
          const addDays = Math.max(0, Math.floor(Number(body.channelGrantDays) || 0));
          const addMonths = Math.max(0, Math.floor(Number(body.channelGrantMonths) || 0));
          if (addDays > 0 || addMonths > 0) {
            const mode = body.channelGrantMode === 'extend' ? 'extend' : 'set';
            const currentEndIso = tsToIso(cur.manualExtraChannelSlotsEndsAt);
            const currentEndMs = currentEndIso ? new Date(currentEndIso).getTime() : 0;
            const baseMs = mode === 'extend' ? Math.max(Date.now(), currentEndMs || 0) : Date.now();
            const end = new Date(baseMs);
            if (addMonths > 0) end.setMonth(end.getMonth() + addMonths);
            if (addDays > 0) end.setDate(end.getDate() + addDays);
            updates.manualExtraChannelSlotsEndsAt = Timestamp.fromDate(end);
          } else {
            updates.manualExtraChannelSlotsEndsAt = null;
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
      } else if (body.manualExtraChannelSlots != null) {
        action = Number(body.manualExtraChannelSlots) > 0 ? 'grant-extra-channels' : 'revoke-extra-channels';
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

  app.get('/api/admin/access-user-insights', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;
      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }
      const db = getFirestore(adminApp);
      const uid = String(req.query.uid || '').trim();
      if (!uid) {
        return res.status(400).json({ ok: false, error: 'Informe uid.' });
      }

      const userRec = await getAuth(adminApp).getUser(uid).catch(() => null);
      const email = userRec?.email || '';
      const accountCreatedAt = userRec?.metadata?.creationTime ? new Date(userRec.metadata.creationTime).toISOString() : null;
      const lastSignInAt = userRec?.metadata?.lastSignInTime ? new Date(userRec.metadata.lastSignInTime).toISOString() : null;

      // Isolamento estrito por conta: insights admin usam apenas users/{uid}/...
      const merged = await loadMergedUserInsightData(db, uid, { includeLegacyRoot: false });
      const { contacts, lists, campaigns, conns, rawMinActivityEpoch } = merged;

      const contactsValid = contacts.filter((c) => String(c.status || '').toUpperCase() !== 'INVALID').length;
      const contactsInvalid = contacts.length - contactsValid;
      const campaignsRunning = campaigns.filter((c) => String(c.status || '') === 'RUNNING').length;
      const campaignsCompleted = campaigns.filter((c) => String(c.status || '') === 'COMPLETED').length;
      const connectionsConnected = conns.filter((c) => String(c.status || '') === 'CONNECTED').length;

      const targeted = campaigns.reduce((acc, c) => acc + (Number(c.totalContacts) || 0), 0);
      const processed = campaigns.reduce((acc, c) => acc + (Number(c.processedCount) || 0), 0);
      const success = campaigns.reduce((acc, c) => acc + (Number(c.successCount) || 0), 0);
      const failed = campaigns.reduce((acc, c) => acc + (Number(c.failedCount) || 0), 0);

      const tagMap = new Map<string, number>();
      for (const c of contacts) {
        const tags = Array.isArray(c.tags) ? c.tags : [];
        for (const t of tags) {
          const tag = String(t || '').trim();
          if (!tag) continue;
          tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
        }
      }
      const contactTagsTop = Array.from(tagMap.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      const listSegmentsTop = lists
        .map((l) => ({
          listName: String(l.name || 'Lista'),
          contacts: Array.isArray(l.contactIds) ? l.contactIds.length : Number(l.count) || 0
        }))
        .sort((a, b) => b.contacts - a.contacts)
        .slice(0, 8);

      const recentCampaigns = campaigns
        .sort((a, b) => asEpoch(b.createdAt) - asEpoch(a.createdAt))
        .slice(0, 6)
        .map((c) => ({
          id: String(c.id || ''),
          name: String(c.name || 'Campanha'),
          status: String(c.status || '—'),
          createdAt: tsToIso(c.createdAt),
          successCount: Number(c.successCount) || 0,
          failedCount: Number(c.failedCount) || 0,
          totalContacts: Number(c.totalContacts) || 0
        }));

      const usageSnap = await db.collection('users').doc(uid).collection('usageStats').doc('summary').get();
      let usage: AdminUserInsights['usage'] = null;
      if (usageSnap.exists) {
        const u = usageSnap.data() as Record<string, unknown>;
        const totalRaw = u?.totalActiveMs;
        let totalActiveMs = 0;
        if (typeof totalRaw === 'number' && Number.isFinite(totalRaw)) {
          totalActiveMs = totalRaw;
        } else if (typeof totalRaw === 'string' && totalRaw.trim()) {
          const parsed = Number(totalRaw);
          if (Number.isFinite(parsed)) totalActiveMs = parsed;
        }
        usage = {
          totalActiveMs: Math.max(0, Math.round(totalActiveMs)),
          lastActiveAt: tsToIso(u?.lastActiveAt)
        };
      }

      const firstActivityMsCandidates = [
        rawMinActivityEpoch,
        ...lists.map((l) => asEpoch(l.createdAt)),
        ...campaigns.map((c) => asEpoch(c.createdAt))
      ].filter((x) => x > 0);
      const firstFromAuth = accountCreatedAt ? new Date(accountCreatedAt).getTime() : 0;
      const firstActivityMs =
        firstActivityMsCandidates.length > 0 ? Math.min(...firstActivityMsCandidates) : firstFromAuth;
      const firstActivityAt = firstActivityMs > 0 ? new Date(firstActivityMs).toISOString() : null;
      const daysSinceFirstActivity =
        firstActivityMs > 0 ? Math.max(0, Math.floor((Date.now() - firstActivityMs) / (1000 * 60 * 60 * 24))) : 0;

      const payload: AdminUserInsights = {
        uid,
        email,
        accountCreatedAt,
        lastSignInAt,
        firstActivityAt,
        daysSinceFirstActivity,
        counts: {
          contactsTotal: contacts.length,
          contactsValid,
          contactsInvalid,
          contactLists: lists.length,
          connectionsTotal: conns.length,
          connectionsConnected,
          campaignsTotal: campaigns.length,
          campaignsRunning,
          campaignsCompleted
        },
        campaignTotals: {
          targeted,
          processed,
          success,
          failed
        },
        contactTagsTop,
        listSegmentsTop,
        recentCampaigns,
        usage
      };

      return res.json({ ok: true, insights: payload });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/admin/access-user-insights]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  /** Sugestões de melhoria (botão Sugestão) em users/{uid}/suggestions */
  app.get('/api/admin/product-suggestions', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;

      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }

      const limit = Math.min(200, Math.max(10, Number.parseInt(String(req.query.limit || ''), 10) || 100));
      const db = getFirestore(adminApp);

      type SuggestionItem = {
        id: string;
        uid: string;
        text: string;
        userEmail: string;
        screen: string;
        category: string;
        createdAt: string | null;
      };

      const mapDoc = (d: FirebaseFirestore.QueryDocumentSnapshot): SuggestionItem => {
        const uid = (d.ref.parent.parent as { id?: string } | undefined)?.id || '';
        const raw = d.data();
        return {
          id: d.id,
          uid,
          text: typeof raw?.text === 'string' ? raw.text : '',
          userEmail: typeof raw?.userEmail === 'string' ? raw.userEmail : '',
          screen: typeof raw?.screen === 'string' ? raw.screen : '',
          category: typeof raw?.category === 'string' ? raw.category : '',
          createdAt: tsToIso(raw?.createdAt)
        };
      };

      let items: SuggestionItem[] = [];
      let usedFallback = false;

      // Detecta erro do tipo "índice não existe" (FAILED_PRECONDITION = 9 no gRPC).
      // O Firestore exige um índice de collection-group para .orderBy em campo de
      // subcoleção; quando ele ainda não foi criado/propagado, devemos cair no
      // fallback (collectionGroup sem orderBy) — caso contrário o painel fica vazio.
      const isMissingIndexError = (err: unknown): boolean => {
        if (!err || typeof err !== 'object') return false;
        const e = err as { code?: number | string; message?: string };
        const msg = typeof e.message === 'string' ? e.message : String(err);
        if (e.code === 9 || e.code === 'failed-precondition' || e.code === 'FAILED_PRECONDITION') {
          return true;
        }
        return (
          /failed[_-]?precondition/i.test(msg) ||
          /requires? (an )?index/i.test(msg) ||
          /\bindex\b/i.test(msg) ||
          /\bindexes\b/i.test(msg)
        );
      };

      try {
        const snap = await db
          .collectionGroup('suggestions')
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get();
        items = snap.docs.map(mapDoc);
      } catch (indexErr: unknown) {
        if (!isMissingIndexError(indexErr)) {
          // Erro inesperado — repassa para o catch externo (mantém status 500).
          throw indexErr;
        }
        const detail = indexErr instanceof Error ? indexErr.message : String(indexErr);
        console.warn(
          '[api/admin/product-suggestions] índice de collection group ausente, usando fallback sem orderBy:',
          detail.slice(0, 220)
        );
        usedFallback = true;
        const snap = await db.collectionGroup('suggestions').limit(800).get();
        items = snap.docs
          .map(mapDoc)
          .sort((a, b) => {
            const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
            const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
            return tb - ta;
          })
          .slice(0, limit);
      }

      console.log(
        '[api/admin/product-suggestions]',
        auth.email,
        'count=',
        items.length,
        usedFallback ? '(fallback)' : ''
      );
      return res.json({ ok: true, items, usedFallback });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/admin/product-suggestions]', msg);
      const isIndex =
        /failed[_-]?precondition/i.test(msg) ||
        /requires? (an )?index/i.test(msg) ||
        /\bindex\b/i.test(msg) ||
        /\bindexes\b/i.test(msg);
      const hint = isIndex
        ? ' Deploy o índice: `firebase deploy --only firestore:indexes` (collection group «suggestions» por createdAt descendente). Alternativamente, reinicie o servidor Node — o fallback automático começa a funcionar e mostra as sugestões mesmo sem o índice.'
        : '';
      return res.status(500).json({ ok: false, error: msg + hint });
    }
  });

  /**
   * Lista o histórico de respostas dadas pelo criador a uma sugestão específica.
   * Caminho: users/{uid}/suggestions/{id}/replies
   */
  app.get(
    '/api/admin/product-suggestions/:uid/:id/replies',
    async (req: Request, res: Response) => {
      try {
        const auth = await assertAdminFromBearer(req, res);
        if (!auth) return;

        const adminApp = getFirebaseAdmin();
        if (!adminApp) {
          return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
        }

        const uid = String(req.params.uid || '').trim();
        const id = String(req.params.id || '').trim();
        if (!uid || !id) {
          return res.status(400).json({ ok: false, error: 'Parâmetros uid/id obrigatórios.' });
        }

        const db = getFirestore(adminApp);
        const snap = await db
          .collection('users')
          .doc(uid)
          .collection('suggestions')
          .doc(id)
          .collection('replies')
          .orderBy('createdAt', 'asc')
          .limit(50)
          .get();

        const items = snap.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            text: typeof raw?.text === 'string' ? raw.text : '',
            adminEmail: typeof raw?.adminEmail === 'string' ? raw.adminEmail : '',
            adminUid: typeof raw?.adminUid === 'string' ? raw.adminUid : '',
            emailSent: raw?.emailSent === true,
            emailError: typeof raw?.emailError === 'string' ? raw.emailError : '',
            createdAt: tsToIso(raw?.createdAt)
          };
        });

        return res.json({ ok: true, items });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[api/admin/product-suggestions/replies][GET]', msg);
        return res.status(500).json({ ok: false, error: msg });
      }
    }
  );

  /**
   * Cria uma resposta a uma sugestão e envia email para o cliente (best-effort).
   * Body: { text: string }
   */
  app.post(
    '/api/admin/product-suggestions/:uid/:id/reply',
    async (req: Request, res: Response) => {
      try {
        const auth = await assertAdminFromBearer(req, res);
        if (!auth) return;

        const adminApp = getFirebaseAdmin();
        if (!adminApp) {
          return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
        }

        const uid = String(req.params.uid || '').trim();
        const id = String(req.params.id || '').trim();
        if (!uid || !id) {
          return res.status(400).json({ ok: false, error: 'Parâmetros uid/id obrigatórios.' });
        }

        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (text.length < 1) {
          return res.status(400).json({ ok: false, error: 'Escreva a resposta.' });
        }
        if (text.length > 8000) {
          return res.status(400).json({ ok: false, error: 'Texto demasiado longo (limite 8000).' });
        }

        const db = getFirestore(adminApp);
        const sugRef = db.collection('users').doc(uid).collection('suggestions').doc(id);
        const sugSnap = await sugRef.get();
        if (!sugSnap.exists) {
          return res.status(404).json({ ok: false, error: 'Sugestão não encontrada.' });
        }
        const sug = sugSnap.data() || {};
        const recipient = typeof sug.userEmail === 'string' ? sug.userEmail : '';
        const originalText = typeof sug.text === 'string' ? sug.text : '';
        const originalCategory = typeof sug.category === 'string' ? sug.category : '';
        const originalScreen = typeof sug.screen === 'string' ? sug.screen : '';
        const originalCreatedAtRaw = sug.createdAt;
        const originalCreatedAt =
          originalCreatedAtRaw instanceof Timestamp
            ? originalCreatedAtRaw.toDate()
            : originalCreatedAtRaw && typeof (originalCreatedAtRaw as Timestamp)?.toDate === 'function'
              ? (originalCreatedAtRaw as Timestamp).toDate()
              : null;

        // Envia o email primeiro (best-effort) — assim, se a Resend rejeitar
        // (ex.: domínio do remetente não verificado), gravamos `emailSent=false`
        // mas mantemos o histórico para o admin tentar de novo.
        let emailSent = false;
        let emailError: string | undefined;
        if (recipient && /@/.test(recipient)) {
          try {
            const mailResult = await sendSuggestionReplyEmail({
              to: recipient,
              originalText,
              originalCategory,
              originalScreen,
              originalCreatedAt,
              replyText: text,
              fromAdminEmail: auth.email
            });
            if (mailResult.ok === false) {
              emailSent = false;
              emailError = mailResult.reason.slice(0, 500);
            } else {
              emailSent = true;
            }
          } catch (mailErr) {
            console.error('[api/admin/product-suggestions/reply] email falhou:', mailErr);
            emailSent = false;
            emailError =
              mailErr instanceof Error ? mailErr.message.slice(0, 500) : String(mailErr).slice(0, 500);
          }
        }

        await sugRef.collection('replies').add({
          text,
          adminEmail: auth.email,
          adminUid: auth.uid,
          emailSent,
          ...(emailError ? { emailError } : {}),
          createdAt: FieldValue.serverTimestamp()
        });

        // Marca a própria sugestão como respondida (útil para listar não-respondidas).
        await sugRef.set(
          {
            lastRepliedAt: FieldValue.serverTimestamp(),
            lastRepliedBy: auth.email,
            replyCount: FieldValue.increment(1)
          },
          { merge: true }
        );

        return res.json({ ok: true, emailSent, recipient, emailError });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[api/admin/product-suggestions/reply][POST]', msg);
        return res.status(500).json({ ok: false, error: msg });
      }
    }
  );
}
