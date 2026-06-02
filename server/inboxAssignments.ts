import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { isUidMemberOfTenantPg, listInboxAssignmentsPg } from './repositories/inboxAssignmentsRepository.js';
import * as inboxPg from './repositories/inboxAssignmentsRepository.js';
import { getWorkspaceMemberUidSetVps } from './auth/staffRepository.js';
import type { Conversation } from './types.js';

function usePostgresInbox(): boolean {
  return vpsDataEnabled() && !!getZapmassPool();
}

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
  if (usePostgresInbox()) {
    cache.set(tenantUid, await listInboxAssignmentsPg(tenantUid));
    loadedTenants.add(tenantUid);
    return;
  }
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
  if (usePostgresInbox()) {
    const r = await inboxPg.inboxClaimConversationPg(
      tenantUid,
      staffAuthUid,
      conversationId,
      conversation.connectionId
    );
    if (r.ok) rememberClaim(tenantUid, conversationId, staffAuthUid);
    return r;
  }
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
      const tenantOwnerTakingOver = staffAuthUid === tenantUid;
      if (existing && existing !== staffAuthUid && !tenantOwnerTakingOver) {
        throw new Error('ALREADY_CLAIMED');
      }
      if (existing === staffAuthUid) {
        return;
      }
      tx.set(ref, {
        claimedByAuthUid: staffAuthUid,
        claimedAt: FieldValue.serverTimestamp(),
        connectionId: conversation.connectionId,
        ...(tenantOwnerTakingOver && existing && existing !== staffAuthUid
          ? {
              transferredFromAuthUid: existing,
              transferredAt: FieldValue.serverTimestamp()
            }
          : {})
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

/** Dono ou membro ligado a este tenant (uid do dono nas links). */
export async function isUidMemberOfTenant(
  admin: NonNullable<ReturnType<typeof getFirebaseAdmin>> | null,
  tenantUid: string,
  candidateAuthUid: string
): Promise<boolean> {
  if (usePostgresInbox()) {
    return isUidMemberOfTenantPg(tenantUid, candidateAuthUid);
  }
  if (!admin) return candidateAuthUid === tenantUid;
  if (candidateAuthUid === tenantUid) return true;
  const snap = await admin.firestore().collection('userWorkspaceLinks').doc(candidateAuthUid).get();
  const ou = snap.exists ? snap.data()?.ownerUid : null;
  return typeof ou === 'string' && ou === tenantUid;
}

/** UIDs que podem operar o workspace (dono + equipa em userWorkspaceLinks). */
export async function getWorkspaceMemberUidSet(
  admin: NonNullable<ReturnType<typeof getFirebaseAdmin>> | null,
  tenantUid: string
): Promise<Set<string>> {
  if (usePostgresInbox()) {
    return getWorkspaceMemberUidSetVps(tenantUid);
  }
  const uid = String(tenantUid || '').trim();
  const out = new Set<string>();
  if (!uid) return out;
  out.add(uid);
  if (!admin) return out;
  try {
    const qs = await admin.firestore().collection('userWorkspaceLinks').where('ownerUid', '==', uid).get();
    for (const doc of qs.docs) {
      if (doc.id) out.add(doc.id);
    }
  } catch {
    /* fail closed: só o dono */
  }
  return out;
}

export async function inboxTransferConversation(
  tenantUid: string,
  actingAuthUid: string,
  isOwnerActor: boolean,
  conversationId: string,
  targetAuthUid: string,
  conversation: Conversation
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (usePostgresInbox()) {
    const admin = getFirebaseAdmin();
    if (!(await isUidMemberOfTenant(admin, tenantUid, targetAuthUid))) {
      return { ok: false, code: 'TARGET_NOT_IN_WORKSPACE' };
    }
    const r = await inboxPg.inboxTransferConversationPg(
      tenantUid,
      actingAuthUid,
      isOwnerActor,
      conversationId,
      targetAuthUid,
      conversation.connectionId
    );
    if (r.ok) rememberClaim(tenantUid, conversationId, targetAuthUid);
    return r;
  }
  const admin = getFirebaseAdmin();
  if (!admin) return { ok: false, code: 'NO_ADMIN' };
  const t = String(targetAuthUid || '').trim();
  if (!t) return { ok: false, code: 'INVALID_TARGET' };
  if (!(await isUidMemberOfTenant(admin, tenantUid, t))) {
    return { ok: false, code: 'TARGET_NOT_IN_WORKSPACE' };
  }

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
      if (!existing) {
        throw new Error('NOT_CLAIMED');
      }
      if (!isOwnerActor && existing !== actingAuthUid) {
        throw new Error('NOT_YOUR_CLAIM');
      }
      if (existing === t) {
        return;
      }
      tx.set(ref, {
        claimedByAuthUid: t,
        claimedAt: FieldValue.serverTimestamp(),
        connectionId: conversation.connectionId,
        transferredFromAuthUid: actingAuthUid,
        transferredAt: FieldValue.serverTimestamp()
      });
    });
    rememberClaim(tenantUid, conversationId, t);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'NOT_CLAIMED') return { ok: false, code: 'NOT_CLAIMED' };
    if (msg === 'NOT_YOUR_CLAIM') return { ok: false, code: 'NOT_YOUR_CLAIM' };
    throw e;
  }
}

export type InboxFinishSatisfaction = {
  skipped: boolean;
  rating?: number | null;
  comment?: string | null;
};

/** Liberta a conversa e grava pesquisa opcional (interna, operador/equipa). */
export async function inboxFinishConversation(
  tenantUid: string,
  authUid: string,
  conversationId: string,
  isOwner: boolean,
  satisfaction: InboxFinishSatisfaction
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (usePostgresInbox()) {
    const r = await inboxPg.inboxFinishConversationPg(
      tenantUid,
      authUid,
      conversationId,
      isOwner,
      satisfaction
    );
    if (r.ok) rememberRelease(tenantUid, conversationId);
    return r;
  }
  const admin = getFirebaseAdmin();
  if (!admin) return { ok: false, code: 'NO_ADMIN' };

  const ref = admin
    .firestore()
    .collection('users')
    .doc(tenantUid)
    .collection('inboxAssignments')
    .doc(conversationId);

  const snap = await ref.get();
  const claimer =
    snap.exists && typeof snap.data()?.claimedByAuthUid === 'string'
      ? String(snap.data()?.claimedByAuthUid).trim()
      : '';

  if (!claimer) {
    return { ok: false, code: 'NOT_CLAIMED' };
  }
  if (!isOwner && claimer !== authUid) {
    return { ok: false, code: 'NOT_YOUR_CLAIM' };
  }

  const db = admin.firestore();
  const batch = db.batch();
  const skipped = Boolean(satisfaction.skipped);
  let rating: number | null = null;
  if (!skipped && typeof satisfaction.rating === 'number' && satisfaction.rating >= 1 && satisfaction.rating <= 5) {
    rating = satisfaction.rating;
  }
  const commentRaw = typeof satisfaction.comment === 'string' ? satisfaction.comment.trim() : '';

  if (!skipped) {
    const fbRef = db.collection('users').doc(tenantUid).collection('inboxAttendanceFeedback').doc();
    const hasContent = rating != null || commentRaw.length > 0;
    batch.set(fbRef, {
      conversationId,
      actorAuthUid: authUid,
      assignedToAuthUidBeforeFinish: claimer,
      rating,
      comment: commentRaw.length > 0 ? commentRaw : null,
      skippedSurvey: !hasContent,
      createdAt: FieldValue.serverTimestamp()
    });
  }

  batch.delete(ref);
  await batch.commit();
  rememberRelease(tenantUid, conversationId);
  return { ok: true };
}

/** Dono pode libertar sempre; funcionário só a sua própria reivindicação. */
export async function inboxReleaseConversation(
  tenantUid: string,
  authUid: string,
  conversationId: string,
  isOwner: boolean
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (usePostgresInbox()) {
    const r = await inboxPg.inboxReleaseConversationPg(tenantUid, authUid, conversationId, isOwner);
    if (r.ok) rememberRelease(tenantUid, conversationId);
    return r;
  }
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
