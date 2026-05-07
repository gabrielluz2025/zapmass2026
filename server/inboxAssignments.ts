import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import type { Conversation } from './types.js';

const cache = new Map<string, Map<string, string>>();
const loadedTenants = new Set<string>();

export function getClaimerSync(tenantUid: string, conversationId: string): string | undefined {
  return cache.get(tenantUid)?.get(conversationId);
}

/** Garante que o cache foi lido pelo menos uma vez (Firestore Admin). */
export async function ensureAssignmentsLoaded(tenantUid: string): Promise<void> {
  if (loadedTenants.has(tenantUid)) return;
  await replenishAssignmentsCacheFromFirestore(tenantUid);
}

export async function replenishAssignmentsCacheFromFirestore(tenantUid: string): Promise<void> {
  const admin = getFirebaseAdmin();
  if (!admin) return;
  const snap = await admin
    .firestore()
    .collection('users')
    .doc(tenantUid)
    .collection('inboxAssignments')
    .get();
  const m = new Map<string, string>();
  for (const docSnap of snap.docs) {
    const v = docSnap.data()?.claimedByAuthUid;
    if (typeof v === 'string' && v.trim()) {
      m.set(docSnap.id, v.trim());
    }
  }
  cache.set(tenantUid, m);
  loadedTenants.add(tenantUid);
}

/** Após REST claim/release já actualizamos o mapa — não depende só do próximo reload. */
export function rememberClaim(tenantUid: string, conversationId: string, staffAuthUid: string): void {
  let m = cache.get(tenantUid);
  if (!m) {
    m = new Map();
    cache.set(tenantUid, m);
  }
  m.set(conversationId, staffAuthUid);
  loadedTenants.add(tenantUid);
}

export function rememberRelease(tenantUid: string, conversationId: string): void {
  cache.get(tenantUid)?.delete(conversationId);
  loadedTenants.add(tenantUid);
}

export function applyInboxAssignmentFilter<C extends { id: string }>(
  tenantUid: string,
  authUid: string,
  conversations: C[]
): C[] {
  if (authUid === tenantUid) return conversations;
  const m = cache.get(tenantUid);
  return conversations.filter((c) => {
    const claimer = m?.get(c.id);
    if (!claimer) return true;
    return claimer === authUid;
  });
}

export function enrichOwnerInboxClaims<C extends { id: string }>(
  tenantUid: string,
  conversations: C[]
): (C & { inboxClaimedByAuthUid?: string })[] {
  const m = cache.get(tenantUid);
  if (!m || m.size === 0) return conversations as (C & { inboxClaimedByAuthUid?: string })[];
  return conversations.map((c) => {
    const claimer = m.get(c.id);
    if (!claimer) return c as C & { inboxClaimedByAuthUid?: string };
    return { ...c, inboxClaimedByAuthUid: claimer };
  });
}

/** Staff: só recebe `inboxClaimedByAuthUid` nas conversas que ele próprio reivindicou. */
export function tagStaffOwnClaims<C extends { id: string }>(
  tenantUid: string,
  authUid: string,
  conversations: C[]
): (C & { inboxClaimedByAuthUid?: string })[] {
  const m = cache.get(tenantUid);
  return conversations.map((c) => {
    const claimer = m?.get(c.id);
    if (claimer === authUid) return { ...c, inboxClaimedByAuthUid: claimer };
    return c as C & { inboxClaimedByAuthUid?: string };
  });
}

export function assignmentsSnapshotForTenant(tenantUid: string): Record<string, string> {
  const m = cache.get(tenantUid);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const [k, v] of m) out[k] = v;
  return out;
}

export async function inboxClaimConversation(
  tenantUid: string,
  staffAuthUid: string,
  conversationId: string,
  conversation: Conversation
): Promise<{ ok: true } | { ok: false; code: string }> {
  const admin = getFirebaseAdmin();
  if (!admin) return { ok: false, code: 'NO_ADMIN' };

  const ref = admin
    .firestore()
    .collection('users')
    .doc(tenantUid)
    .collection('inboxAssignments')
    .doc(conversationId);

  try {
    await admin.firestore().runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const existing =
        cur.exists && typeof cur.data()?.claimedByAuthUid === 'string'
          ? String(cur.data()?.claimedByAuthUid).trim()
          : '';
      if (existing && existing !== staffAuthUid) {
        throw new Error('ALREADY_CLAIMED');
      }
      if (existing === staffAuthUid) {
        return;
      }
      tx.set(ref, {
        claimedByAuthUid: staffAuthUid,
        claimedAt: FieldValue.serverTimestamp(),
        connectionId: conversation.connectionId
      });
    });
    rememberClaim(tenantUid, conversationId, staffAuthUid);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'ALREADY_CLAIMED') return { ok: false, code: 'ALREADY_CLAIMED' };
    throw e;
  }
}

/** Dono pode libertar sempre; funcionário só a sua própria reivindicação. */
export async function inboxReleaseConversation(
  tenantUid: string,
  authUid: string,
  conversationId: string,
  isOwner: boolean
): Promise<{ ok: true } | { ok: false; code: string }> {
  const admin = getFirebaseAdmin();
  if (!admin) return { ok: false, code: 'NO_ADMIN' };

  const ref = admin
    .firestore()
    .collection('users')
    .doc(tenantUid)
    .collection('inboxAssignments')
    .doc(conversationId);

  const snap = await ref.get();
  if (!snap.exists) {
    rememberRelease(tenantUid, conversationId);
    return { ok: true };
  }
  const claimer =
    typeof snap.data()?.claimedByAuthUid === 'string' ? String(snap.data()?.claimedByAuthUid).trim() : '';
  if (!isOwner && claimer !== authUid) {
    return { ok: false, code: 'NOT_YOUR_CLAIM' };
  }
  await ref.delete();
  rememberRelease(tenantUid, conversationId);
  return { ok: true };
}

/** Somente testes (Vitest): repõe cache em memória. */
export function resetInboxAssignmentsCacheForTesting(): void {
  cache.clear();
  loadedTenants.clear();
}
