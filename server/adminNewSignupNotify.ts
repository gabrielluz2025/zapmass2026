/**
 * Notifica administradores (sino no painel + e-mail Resend) sobre eventos da plataforma:
 * - nova conta (register)
 * - teste grátis iniciado
 * - primeira assinatura paga
 */
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { findUserByEmail, findUserById } from './auth/userRepository.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { adminEmailSet } from './adminIdentity.js';
import { persistUserNotification } from './userNotificationsFirestore.js';
import { insertNotificationPg } from './repositories/notificationsRepository.js';
import { sendNewClientSignupNotificationEmail } from './emailService.js';
import { tryClaimAdminNewClientNotify } from './subscriptionStore.js';

export type NewSignupSource = 'register' | 'trial' | 'subscription';

async function persistAdminBellNotification(
  adminEmail: string,
  payload: { title: string; body: string }
): Promise<void> {
  if (vpsDataEnabled()) {
    const row = await findUserByEmail(adminEmail);
    if (row) {
      await insertNotificationPg(row.id, {
        title: payload.title,
        body: payload.body,
        kind: 'success',
        category: 'admin'
      });
    }
    return;
  }
  const adminApp = getFirebaseAdmin();
  if (!adminApp) return;
  try {
    const u = await getAuth(adminApp).getUserByEmail(adminEmail);
    await persistUserNotification(u.uid, {
      title: payload.title,
      body: payload.body,
      kind: 'success',
      category: 'admin'
    });
  } catch {
    /* admin pode não existir no Firebase — e-mail ainda é enviado */
  }
}

function adminNotifyEmails(): string[] {
  return [...adminEmailSet()];
}

async function resolveClientProfile(uid: string): Promise<{ email: string; displayName: string }> {
  if (vpsDataEnabled()) {
    const row = await findUserById(uid);
    return {
      email: row?.email || '',
      displayName: (row?.display_name || '').trim()
    };
  }
  const adminApp = getFirebaseAdmin();
  if (!adminApp) return { email: '', displayName: '' };
  try {
    const rec = await getAuth(adminApp).getUser(uid);
    return {
      email: rec.email || '',
      displayName: (rec.displayName || '').trim()
    };
  } catch {
    return { email: '', displayName: '' };
  }
}

function sourceLabel(source: NewSignupSource): string {
  if (source === 'register') return 'Nova conta criada';
  if (source === 'trial') return 'Teste grátis iniciado';
  return 'Nova assinatura paga';
}

function bellTitle(source: NewSignupSource): string {
  if (source === 'register') return 'Novo cadastro na plataforma';
  if (source === 'trial') return 'Novo cliente — teste grátis';
  return 'Novo cliente — assinatura';
}

export async function notifyAdminsNewClientSignup(params: {
  uid: string;
  source: NewSignupSource;
  skipClaim?: boolean;
}): Promise<void> {
  const { uid, source, skipClaim } = params;
  if (!skipClaim && source !== 'register') {
    const claimed = await tryClaimAdminNewClientNotify(uid);
    if (!claimed) return;
  }

  const { email, displayName } = await resolveClientProfile(uid);
  const bodyLines = [
    `UID: ${uid}`,
    email ? `E-mail: ${email}` : 'E-mail: (não disponível)',
    displayName ? `Nome: ${displayName}` : null,
    source === 'register'
      ? 'Origem: registo de conta (e-mail/senha)'
      : source === 'trial'
        ? 'Origem: primeiro acesso — trial'
        : 'Origem: primeira assinatura (Mercado Pago)'
  ].filter(Boolean);

  const title = bellTitle(source);
  const body = bodyLines.join('\n');
  const emails = adminNotifyEmails();

  await Promise.all(
    emails.map((admEmail) =>
      persistAdminBellNotification(admEmail, { title, body }).catch((e) => {
        console.warn('[adminNewSignupNotify] bell', admEmail, e);
      })
    )
  );

  const ok = await sendNewClientSignupNotificationEmail({
    clientUid: uid,
    clientEmail: email,
    clientName: displayName,
    sourceLabel: sourceLabel(source)
  });
  console.log(
    '[adminNewSignupNotify]',
    source,
    uid,
    email || '(sem email)',
    'emailResend=',
    ok
  );
}

/** Conta nova — sem deduplicação (evento imediato no registo). */
export async function notifyAdminsNewAccountRegistered(uid: string): Promise<void> {
  await notifyAdminsNewClientSignup({ uid, source: 'register', skipClaim: true }).catch((e) =>
    console.error('[adminNewSignupNotify] register', e)
  );
}

export async function notifyAdminsNewSignupAfterPaidIfNeeded(
  uid: string,
  opts: { wasRenewal: boolean }
): Promise<void> {
  if (opts.wasRenewal) return;
  await notifyAdminsNewClientSignup({ uid, source: 'subscription' }).catch((e) =>
    console.error('[adminNewSignupNotify] paid path', e)
  );
}
