import {
  getVpsAccessToken,
  getVpsAuthUser,
  vpsGetAccessToken,
  vpsRefreshAccessToken
} from '../services/vpsAuth';

/** UID da sessão (dono ou funcionário). */
export function getSessionUid(): string | null {
  return getVpsAuthUser()?.id ?? null;
}

/** Bearer para API e Socket.IO. */
export async function getSessionIdToken(forceRefresh = false): Promise<string | null> {
  if (forceRefresh) return vpsRefreshAccessToken();
  return vpsGetAccessToken();
}

export function getSessionAccessToken(): string | null {
  return getVpsAccessToken();
}
