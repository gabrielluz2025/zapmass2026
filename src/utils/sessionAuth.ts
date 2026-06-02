import { getAuth } from 'firebase/auth';
import {
  getVpsAccessToken,
  getVpsAuthUser,
  useVpsAuth,
  vpsGetAccessToken,
  vpsRefreshAccessToken
} from '../services/vpsAuth';

/** UID da sessão (dono ou funcionário). */
export function getSessionUid(): string | null {
  if (useVpsAuth()) return getVpsAuthUser()?.id ?? null;
  return getAuth().currentUser?.uid ?? null;
}

/** Bearer para API e Socket.IO. */
export async function getSessionIdToken(forceRefresh = false): Promise<string | null> {
  if (useVpsAuth()) {
    if (forceRefresh) return vpsRefreshAccessToken();
    return vpsGetAccessToken();
  }
  const u = getAuth().currentUser;
  if (!u) return null;
  return u.getIdToken(forceRefresh);
}
