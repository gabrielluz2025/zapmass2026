import { zapmassAuthProvider } from './auth/authMode.js';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { resolveAuthPrincipal, type AuthPrincipal } from './resolveAuth.js';

export type InboxRouteParticipantResult =
  | { ok: true; tenantUid: string; authUid: string; provider: AuthPrincipal['provider'] }
  | { ok: false; status: number; error: string };

/** Rotas de inbox (claim/transfer/finish): JWT VPS ou Firebase ID token — sem exigir Admin em modo VPS. */
export async function resolveInboxRouteParticipant(token: string): Promise<InboxRouteParticipantResult> {
  const principal = await resolveAuthPrincipal(token);
  if (principal) {
    return {
      ok: true,
      tenantUid: principal.tenantUid,
      authUid: principal.authUid,
      provider: principal.provider
    };
  }
  const mode = zapmassAuthProvider();
  if (mode !== 'vps' && !getFirebaseAdmin()) {
    return { ok: false, status: 503, error: 'Firebase Admin não configurado no servidor.' };
  }
  return { ok: false, status: 401, error: 'Token inválido.' };
}
