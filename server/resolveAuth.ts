import type { Request } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { zapmassAuthProvider } from './auth/authMode.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import {
  resolvePostgresTenantIdAsync,
  resolveStaffAuthSubjectIdAsync
} from './auth/firebaseUidMap.js';
import { verifyAccessToken } from './auth/jwt.js';
import type { AuthPrincipal } from './auth/types.js';
import { findUserById } from './auth/userRepository.js';
import { getWorkspaceMemberUidSetVps } from './auth/staffRepository.js';
import { getWorkspaceMemberUidSet } from './inboxAssignments.js';

export function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

async function resolveFirebasePrincipal(token: string): Promise<AuthPrincipal | null> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) return null;
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token);
    const authUid = decoded.uid;
    let tenantUid = authUid;
    let role: 'owner' | 'staff' = 'owner';
    let ownerUid: string | undefined;
    const lk = await adminApp.firestore().collection('userWorkspaceLinks').doc(authUid).get();
    if (lk.exists) {
      const ou = lk.data()?.ownerUid;
      if (typeof ou === 'string' && ou.trim().length > 0 && ou !== authUid) {
        tenantUid = ou.trim();
        role = 'staff';
        ownerUid = tenantUid;
      }
    }
    const email = typeof decoded.email === 'string' ? decoded.email : '';
    if (vpsDataEnabled()) {
      const tenantUid = await resolvePostgresTenantIdAsync(
        role === 'staff' && ownerUid ? ownerUid : authUid
      );
      const mappedAuth =
        role === 'staff' ? await resolveStaffAuthSubjectIdAsync(authUid) : tenantUid;
      return {
        provider: 'firebase',
        authUid: mappedAuth,
        tenantUid,
        email,
        role,
        ownerUid: role === 'staff' ? tenantUid : undefined
      };
    }
    return { provider: 'firebase', authUid, tenantUid, email, role, ownerUid };
  } catch {
    return null;
  }
}

async function resolveVpsPrincipal(token: string): Promise<AuthPrincipal | null> {
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  if (claims.role === 'staff') {
    return {
      provider: 'vps',
      authUid: claims.sub,
      tenantUid: claims.tenantUid,
      email: claims.email,
      role: 'staff',
      ownerUid: claims.ownerUid || claims.tenantUid
    };
  }
  const user = await findUserById(claims.sub);
  if (!user || user.disabled_at) return null;
  return {
    provider: 'vps',
    authUid: claims.sub,
    tenantUid: claims.tenantUid,
    email: claims.email || user.email,
    role: 'owner'
  };
}

/** Resolve dono/funcionário a partir do Bearer (VPS primeiro em modo dual). */
export async function resolveAuthPrincipal(token: string | null): Promise<AuthPrincipal | null> {
  if (!token) return null;
  const mode = zapmassAuthProvider();

  if (mode === 'vps' || mode === 'dual') {
    const vps = await resolveVpsPrincipal(token);
    if (vps) return vps;
    if (mode === 'vps') return null;
  }

  return resolveFirebasePrincipal(token);
}

export async function getWorkspaceMembersForPrincipal(
  principal: AuthPrincipal
): Promise<Set<string>> {
  if (principal.provider === 'vps') {
    return getWorkspaceMemberUidSetVps(principal.tenantUid);
  }
  const adminApp = getFirebaseAdmin();
  if (!adminApp) return new Set([principal.tenantUid]);
  return getWorkspaceMemberUidSet(adminApp, principal.tenantUid);
}
