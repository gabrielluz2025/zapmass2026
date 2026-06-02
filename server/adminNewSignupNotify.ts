/**
 * Notifica criadores (email Resend + sino no painel) quando um novo cliente entra:
 * - após iniciar o teste grátis (/api/billing/trial/start)
 * - após primeira assinatura paga (extendPaidSubscription, sem ser simples renovação)
 *
 * Deduplicação: campo userSubscriptions.adminNewClientNotifiedAt (claim atómico).
 */
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { findUserById } from './auth/userRepository.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { persistUserNotification } from './userNotificationsFirestore.js';
import { sendNewClientSignupNotificationEmail } from './emailService.js';
import { tryClaimAdminNewClientNotify } from './subscriptionStore.js';

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
  if (vpsDataEnabled()) {
    const row = await findUserById(uid);
    if (row) {
      email = row.email || '';
      displayName = (row.display_name || '').trim();
    }
  } else {
    try {
      const rec = await getAuth(adminApp).getUser(uid);
      email = rec.email || '';
      displayName = (rec.displayName || '').trim();
    } catch (e) {
      console.warn('[adminNewSignupNotify] getUser', uid, e);
    }
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
