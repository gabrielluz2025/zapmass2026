import type { User } from 'firebase/auth';
import type { VpsAuthUser } from '../services/vpsAuth';
import { vpsGetAccessToken, vpsRefreshAccessToken } from '../services/vpsAuth';

/** Objeto compatível com `User` para código que usa uid/email/getIdToken. */
export function vpsUserAsFirebaseUser(v: VpsAuthUser): User {
  return {
    uid: v.id,
    email: v.email,
    displayName: v.displayName ?? null,
    photoURL: null,
    emailVerified: true,
    isAnonymous: false,
    providerData: [],
    metadata: {} as User['metadata'],
    refreshToken: '',
    tenantId: v.tenantUid || v.id,
    phoneNumber: null,
    providerId: 'vps',
    delete: async () => {},
    getIdToken: async (forceRefresh?: boolean) => {
      const t = forceRefresh ? await vpsRefreshAccessToken() : await vpsGetAccessToken();
      if (!t) throw new Error('Sessão expirada.');
      return t;
    },
    reload: async () => {},
    toJSON: () => ({ uid: v.id, email: v.email })
  } as User;
}
