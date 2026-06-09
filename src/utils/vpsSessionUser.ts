import type { SessionUser } from '../types/sessionUser';
import type { VpsAuthUser } from '../services/vpsAuth';
import { vpsGetAccessToken, vpsRefreshAccessToken } from '../services/vpsAuth';

export function vpsUserToSessionUser(v: VpsAuthUser): SessionUser {
  const tenantUid = v.tenantUid?.trim() || v.ownerUid?.trim() || v.id;
  return {
    uid: tenantUid,
    email: v.email,
    displayName: v.displayName ?? null,
    photoURL: null,
    emailVerified: true,
    getIdToken: async (forceRefresh?: boolean) => {
      const t = forceRefresh ? await vpsRefreshAccessToken() : await vpsGetAccessToken();
      if (!t) throw new Error('Sessão expirada.');
      return t;
    }
  };
}
