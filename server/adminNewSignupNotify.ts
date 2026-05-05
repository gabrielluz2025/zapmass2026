/**
 * Notifica criadores (email Resend + sino no painel) quando um novo cliente entra:
 * - após iniciar o teste grátis (/api/billing/trial/start)
 * - após primeira assinatura paga (extendPaidSubscription, sem ser simples renovação)
 *
 * Deduplicação: campo userSubscriptions.adminNewClientNotifiedAt (claim atómico).
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { persistUserNotification } from './userNotificationsFirestore.js';
import { sendNewClientSignupNotificationEmail } from './emailService.js';
import type { UserSubscriptionDoc } from './subscriptionFirestore.js';

const COLLECTION = 'userSubscriptions';

/**
 * Reserva o slot de notificação (uma vez por UID). Devolve true se esta chamada ganhou o direito de enviar.
 */
export async function tryClaimAdminNewClientNotify(uid: string): Promise<boolean> {
  if (!uid) return false;
  const admin = getFirebaseAdmin();
  if (!admin) return false;
  const db = getFirestore(admin);
  const ref = db.collection(COLLECTION).doc(uid);
  let claimed = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() as UserSubscriptionDoc | undefined;
    if (d?.adminNewClientNotifiedAt) return;
    tx.set(
      ref,
      {
        adminNewClientNotifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      } as Record<string, unknown>,
      { merge: true }
    );
    claimed = true;
  });
  return claimed;
}

export type NewSignupSource = 'trial' | 'subscription';

export async function notifyAdminsNewClientSignup(params: {
  uid: string;
  source: NewSignupSource;
}): Promise<void> {
  const { uid, source } = params;
  const claimed = await tryClaimAdminNewClientNotify(uid);
  if (!claimed) return;

  const adminApp = getFirebaseAdmin();
  if (!adminApp) return;

  let email = '';
  let displayName = '';
  try {
    const rec = await getAuth(adminApp).getUser(uid);
    email = rec.email || '';
    displayName = (rec.displayName || '').trim();
  } catch (e) {
    console.warn('[adminNewSignupNotify] getUser', uid, e);
  }

  const label = source === 'trial' ? 'Teste grátis iniciado' : 'Nova assinatura paga';
  const bodyLines = [
    `UID: ${uid}`,
    email ? `E-mail: ${email}` : 'E-mail: (não disponível)',
    displayName ? `Nome: ${displayName}` : null,
    `Origem: ${source === 'trial' ? 'primeiro acesso — trial' : 'primeira assinatura (Mercado Pago)'}`
  ].filter(Boolean);

  const bellTitle = source === 'trial' ? 'Novo cliente — teste grátis' : 'Novo cliente — assinatura';
  const bellBody = bodyLines.join('\n');

  const rawNotify = (process.env.NEW_CLIENT_NOTIFY_EMAIL || process.env.SUGGESTION_NOTIFY_EMAIL || '').trim();
  const adminList = (process.env.ADMIN_EMAILS || '').trim();
  const raw = rawNotify.length > 0 ? rawNotify : adminList;
  const adminEmails = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes('@'));

  await Promise.all(
    adminEmails.map(async (admEmail) => {
      try {
        const u = await getAuth(adminApp).getUserByEmail(admEmail);
        await persistUserNotification(u.uid, {
          title: bellTitle,
          body: bellBody,
          kind: 'success',
          category: 'admin'
        });
      } catch {
        /* admin pode ainda não ter feito login no projeto — só email */
      }
    })
  );

  const ok = await sendNewClientSignupNotificationEmail({
    clientUid: uid,
    clientEmail: email,
    clientName: displayName,
    sourceLabel: label
  });
  console.log(
    '[adminNewSignupNotify] novo cliente',
    uid,
    email || '(sem email)',
    source,
    'emailResend=',
    ok
  );
}

/**
 * Chamado após extendPaidSubscription quando não é renovação antecipada
 * (já era active com accessEndsAt futuro antes deste extend).
 */
export async function notifyAdminsNewSignupAfterPaidIfNeeded(
  uid: string,
  opts: { wasRenewal: boolean }
): Promise<void> {
  if (opts.wasRenewal) return;
  await notifyAdminsNewClientSignup({ uid, source: 'subscription' }).catch((e) =>
    console.error('[adminNewSignupNotify] paid path', e)
  );
}
