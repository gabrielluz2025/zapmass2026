import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { mergeUserSubscription, type UserSubscriptionDoc } from './subscriptionFirestore.js';
import { getTrialDurationMs } from './appConfigStore.js';
import { notifyAdminsNewClientSignup } from './adminNewSignupNotify.js';

const COLLECTION = 'userSubscriptions';

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export function registerBillingTrialRoutes(app: Express): void {
  app.post('/api/billing/trial/start', async (req: Request, res: Response) => {
    try {
      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }

      const idToken = parseBearer(req);
      if (!idToken) {
        return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <Firebase ID token>.' });
      }

      let uid: string;
      try {
        const decoded = await getAuth(adminApp).verifyIdToken(idToken);
        uid = decoded.uid;
      } catch {
        return res.status(401).json({ ok: false, error: 'Token Firebase invalido ou expirado.' });
      }

      const db = getFirestore(adminApp);
      const ref = db.collection(COLLECTION).doc(uid);
      const snap = await ref.get();
      const d = snap.exists ? (snap.data() as UserSubscriptionDoc) : undefined;

      if (d?.freeTrialUsed) {
        return res.status(400).json({ ok: false, error: 'O teste gratuito desta conta ja foi utilizado.' });
      }

      const now = Date.now();
      const accessEnd = d?.accessEndsAt?.toMillis?.() ?? null;
      if (d?.status === 'active' && accessEnd != null && accessEnd > now) {
        return res.status(400).json({ ok: false, error: 'Voce ja possui assinatura ativa.' });
      }

      const trialEndMs = d?.trialEndsAt?.toMillis?.() ?? null;
      if (d?.status === 'trialing' && trialEndMs != null && trialEndMs > now) {
        return res.json({
          ok: true,
          alreadyActive: true,
          trialEndsAt: new Date(trialEndMs).toISOString()
        });
      }

      /** Funcionário de equipa não inicia trial na conta do dono por engano. */
      const linkSnap = await db.collection('userWorkspaceLinks').doc(uid).get();
      if (linkSnap.exists) {
        const ownerUid = linkSnap.data()?.ownerUid;
        if (typeof ownerUid === 'string' && ownerUid.trim() && ownerUid.trim() !== uid) {
          return res.status(403).json({
            ok: false,
            error: 'Somente o responsavel pela conta pode iniciar o teste gratuito.'
          });
        }
      }

      const trialMs = await getTrialDurationMs(db);
      const trialEnds = new Date(Date.now() + trialMs);
      const merged = await mergeUserSubscription(uid, {
        status: 'trialing',
        provider: 'none',
        plan: null,
        includedChannels: 1,
        trialEndsAt: Timestamp.fromDate(trialEnds),
        freeTrialUsed: true,
        extraChannelSlots: 0,
        mercadoPagoChannelAddonPreapprovalId: FieldValue.delete(),
        mercadoPagoChannelAddonOneTimePaymentId: FieldValue.delete()
      } as any);

      if (!merged) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
      }

      void notifyAdminsNewClientSignup({ uid, source: 'trial' }).catch((e) => {
        console.error('[billing/trial/start] notify admins novo cliente', e);
      });

      return res.json({ ok: true, trialEndsAt: trialEnds.toISOString() });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[billing/trial/start]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
