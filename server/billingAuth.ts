import type { Request } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { findUserById } from './auth/userRepository.js';
import { parseBearer, resolveAuthPrincipal } from './resolveAuth.js';

export type BillingUser = {
  uid: string;
  email: string;
  displayName?: string;
};

export async function resolveBillingUser(
  req: Request,
  opts?: { allowStaff?: boolean; bodyEmail?: string }
): Promise<BillingUser | null> {
  const token = parseBearer(req);
  if (!token) return null;

  const principal = await resolveAuthPrincipal(token);
  if (principal) {
    if (!opts?.allowStaff && principal.role === 'staff') return null;
    const bodyEmail = opts?.bodyEmail?.trim() || '';
    const email = (principal.email || bodyEmail || '').trim();
    if (!email.includes('@')) return null;
    const row = await findUserById(principal.tenantUid);
    return {
      uid: principal.tenantUid,
      email,
      displayName: row?.display_name || undefined
    };
  }

  const adminApp = getFirebaseAdmin();
  if (!adminApp) return null;
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token);
    const bodyEmail = opts?.bodyEmail?.trim() || '';
    const email = (decoded.email || bodyEmail || '').trim();
    if (!email.includes('@')) return null;
    let displayName: string | undefined;
    try {
      displayName = (await getAuth(adminApp).getUser(decoded.uid)).displayName ?? undefined;
    } catch {
      displayName = undefined;
    }
    return { uid: decoded.uid, email, displayName };
  } catch {
    return null;
  }
}
