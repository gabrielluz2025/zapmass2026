import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { assertAdminFromBearer, adminEmailSet } from './adminAuth.js';
import {
  clampLandingTrialBodyInput,
  clampLandingTrialTitleInput,
  defaultAppConfig,
  loadAppConfig,
  saveAppConfigMerge,
  type AppConfigGlobal
} from './appConfigStore.js';
import { loadMergedUserInsightData } from './insightMerge.js';
import { sendSuggestionReplyEmail } from './emailService.js';
import {
  listAdminAccessUsers,
  listAdminAccessAudit,
  putAdminAccessUser
} from './adminAccessUsers.js';
import { loadAdminUserInsightsPg, listAdminProductSuggestionsPg } from './adminUserInsightsPg.js';
import { buildAdminPlatformStats } from './adminPlatformStats.js';

function sanitizePutBody(body: unknown): Partial<AppConfigGlobal> {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const out: Partial<AppConfigGlobal> = {};
  if (typeof b.marketingPriceMonthly === 'string') out.marketingPriceMonthly = b.marketingPriceMonthly;
  if (typeof b.marketingPriceAnnual === 'string') out.marketingPriceAnnual = b.marketingPriceAnnual;
  if (typeof b.landingTrialTitle === 'string') out.landingTrialTitle = clampLandingTrialTitleInput(b.landingTrialTitle);
  if (typeof b.landingTrialBody === 'string') out.landingTrialBody = clampLandingTrialBodyInput(b.landingTrialBody);
  if (typeof b.trialHours === 'number' && Number.isFinite(b.trialHours)) out.trialHours = b.trialHours;
  else if (typeof b.trialHours === 'string' && b.trialHours.trim()) {
    const n = Number(b.trialHours);
    if (Number.isFinite(n)) out.trialHours = n;
  }
  return out;
}

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

export function registerAdminAppConfigRoutes(app: Express): void {
  app.get('/api/app-config', async (_req: Request, res: Response) => {
    try {
      const { loadAppConfigGlobal } = await import('./appConfigStore.js');
      const { loadSystemAnnouncementPg } = await import('./repositories/appConfigRepository.js');
      const [config, systemAnnouncement] = await Promise.all([
        loadAppConfigGlobal(),
        loadSystemAnnouncementPg()
      ]);
      return res.json({ ok: true, config: { ...config, systemAnnouncement } });
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

      const partial = sanitizePutBody(req.body);
      if (Object.keys(partial).length === 0) {
        return res.status(400).json({ ok: false, error: 'Nenhum campo valido no corpo da requisicao.' });
      }
      const { saveAppConfigGlobal } = await import('./appConfigStore.js');
      const config = await saveAppConfigGlobal(partial);
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
      const search = String(req.query.search || '').trim().toLowerCase();
      const rows = await listAdminAccessUsers(search, adminEmailSet());
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
      const body = (req.body || {}) as import('./adminAccessUsers.js').AdminAccessUserPutBody;
      const result = await putAdminAccessUser(body, auth);
      if ('error' in result) {
        return res.status(result.status).json({ ok: false, error: result.error });
      }
      console.log('[api/admin/access-user] atualizado por', auth.email, '=>', result.uid);
      return res.json({ ok: true, user: result });
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
      const rawLimit = Number(req.query.limit || 100);
      const rows = await listAdminAccessAudit(rawLimit);
      return res.json({ ok: true, audit: rows });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/admin/access-audit]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get('/api/admin/platform-stats', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;
      const stats = await buildAdminPlatformStats();
      return res.json({ ok: true, stats });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/admin/platform-stats]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get('/api/admin/access-user-insights', async (req: Request, res: Response) => {
    try {
      const auth = await assertAdminFromBearer(req, res);
      if (!auth) return;
      const uid = String(req.query.uid || '').trim();
      if (!uid) {
        return res.status(400).json({ ok: false, error: 'Informe uid.' });
      }

      if (vpsDataEnabled() && getZapmassPool()) {
        const insights = await loadAdminUserInsightsPg(uid);
        if (!insights) {
          return res.status(404).json({ ok: false, error: 'Utilizador não encontrado.' });
        }
        return res.json({ ok: true, insights });
      }

      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }

      const userRec = await getAuth(adminApp).getUser(uid).catch(() => null);
      const email = userRec?.email || '';
      const accountCreatedAt = userRec?.metadata?.creationTime ? new Date(userRec.metadata.creationTime).toISOString() : null;
      const lastSignInAt = userRec?.metadata?.lastSignInTime ? new Date(userRec.metadata.lastSignInTime).toISOString() : null;

      const db = getFirestore(adminApp);
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

      const limit = Math.min(200, Math.max(10, Number.parseInt(String(req.query.limit || ''), 10) || 100));

      if (vpsDataEnabled() && getZapmassPool()) {
        const items = await listAdminProductSuggestionsPg(limit);
        console.log('[api/admin/product-suggestions]', auth.email, 'count=', items.length, '(postgres)');
        return res.json({ ok: true, items, usedFallback: false });
      }

      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }

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

        const uid = String(req.params.uid || '').trim();
        const id = String(req.params.id || '').trim();
        if (!uid || !id) {
          return res.status(400).json({ ok: false, error: 'Parâmetros uid/id obrigatórios.' });
        }

        if (vpsDataEnabled() && getZapmassPool()) {
          return res.json({ ok: true, items: [] });
        }

        const adminApp = getFirebaseAdmin();
        if (!adminApp) {
          return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
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
