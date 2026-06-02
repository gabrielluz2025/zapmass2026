import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { findUserByEmail, findUserById } from './auth/userRepository.js';
import { getZapmassPool } from './db/postgres.js';
import {
  getSubscriptionDocPg,
  mergeSubscriptionDocPg
} from './repositories/subscriptionRepository.js';
import { usePostgresSubscriptions } from './subscriptionStore.js';

export type AdminUserAccessRow = {
  uid: string;
  email: string;
  status: string;
  provider: string;
  plan: string | null;
  blocked: boolean;
  manualGrant: boolean;
  trialEndsAt: string | null;
  accessEndsAt: string | null;
  manualAccessEndsAt: string | null;
  manualExtraChannelSlots: number;
  manualExtraChannelSlotsEndsAt: string | null;
  adminNote: string;
  updatedAt: string | null;
};

export type AdminAccessAuditRow = {
  id: string;
  targetUid: string;
  targetEmail: string;
  adminUid: string;
  adminEmail: string;
  action: string;
  note: string;
  createdAt: string | null;
};

export type AdminAccessUserPutBody = {
  uid?: string;
  email?: string;
  blocked?: boolean;
  manualGrant?: boolean;
  grantDays?: number | null;
  grantMode?: 'set' | 'extend';
  manualExtraChannelSlots?: number | null;
  channelGrantDays?: number | null;
  channelGrantMonths?: number | null;
  channelGrantMode?: 'set' | 'extend';
  adminNote?: string;
};

function tsToIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof v === 'string') return v;
  return null;
}

export function docToAdminAccessRow(
  uid: string,
  data: Record<string, unknown> | undefined,
  email: string
): AdminUserAccessRow {
  return {
    uid,
    email,
    status: typeof data?.status === 'string' ? data.status : 'none',
    provider: typeof data?.provider === 'string' ? data.provider : 'none',
    plan: typeof data?.plan === 'string' ? data.plan : null,
    blocked: data?.blocked === true,
    manualGrant: data?.manualGrant === true,
    trialEndsAt: tsToIso(data?.trialEndsAt),
    accessEndsAt: tsToIso(data?.accessEndsAt),
    manualAccessEndsAt: tsToIso(data?.manualAccessEndsAt),
    manualExtraChannelSlots: Math.max(
      0,
      Math.min(3, Math.floor(Number(data?.manualExtraChannelSlots) || 0))
    ),
    manualExtraChannelSlotsEndsAt: tsToIso(data?.manualExtraChannelSlotsEndsAt),
    adminNote: typeof data?.adminNote === 'string' ? data.adminNote : '',
    updatedAt: tsToIso(data?.updatedAt)
  };
}

async function rowFromSubscriptionDocFirebase(
  uid: string,
  data: Record<string, unknown> | undefined,
  authEmailCache: Map<string, string>,
  fallbackEmail = ''
): Promise<AdminUserAccessRow> {
  let email = fallbackEmail || authEmailCache.get(uid) || '';
  if (!email) {
    try {
      const adminApp = getFirebaseAdmin();
      if (adminApp) {
        const user = await getAuth(adminApp).getUser(uid);
        email = user.email || '';
        if (email) authEmailCache.set(uid, email);
      }
    } catch {
      /* ignore */
    }
  }
  return docToAdminAccessRow(uid, data, email);
}

async function listAdminAccessUsersPg(
  search: string,
  limit: number
): Promise<AdminUserAccessRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const cap = Math.min(Math.max(limit, 1), 1000);
  const q = search.trim().toLowerCase();

  if (q.includes('@')) {
    const user = await findUserByEmail(q);
    if (!user) return [];
    const doc = (await getSubscriptionDocPg(user.id)) || {};
    return [docToAdminAccessRow(user.id, doc, user.email)];
  }

  if (q) {
    const r = await pool.query<{
      tenant_id: string;
      email: string;
      doc: Record<string, unknown> | null;
      updated_at: Date | null;
    }>(
      `SELECT u.id::text AS tenant_id, u.email,
              COALESCE(s.doc, '{}'::jsonb) AS doc, s.updated_at
       FROM zapmass.users u
       LEFT JOIN zapmass.user_subscriptions s ON s.tenant_id = u.id
       WHERE u.email_normalized LIKE '%' || $1 || '%' OR u.id::text = $1
       ORDER BY COALESCE(s.updated_at, u.created_at) DESC
       LIMIT $2`,
      [q, cap]
    );
    return r.rows.map((row) => {
      const doc = { ...(row.doc || {}) };
      if (row.updated_at) doc.updatedAt = row.updated_at.toISOString();
      return docToAdminAccessRow(row.tenant_id, doc, row.email);
    });
  }

  const r = await pool.query<{
    tenant_id: string;
    email: string;
    doc: Record<string, unknown>;
    updated_at: Date | null;
  }>(
    `SELECT u.id::text AS tenant_id, u.email,
            COALESCE(s.doc, '{}'::jsonb) AS doc, s.updated_at
     FROM zapmass.users u
     LEFT JOIN zapmass.user_subscriptions s ON s.tenant_id = u.id
     ORDER BY COALESCE(s.updated_at, u.created_at) DESC
     LIMIT $1`,
    [cap]
  );
  return r.rows.map((row) => {
    const doc = { ...row.doc };
    if (row.updated_at) doc.updatedAt = row.updated_at.toISOString();
    return docToAdminAccessRow(row.tenant_id, doc, row.email);
  });
}

export async function listAdminAccessUsers(
  search: string,
  adminEmails: Set<string>
): Promise<AdminUserAccessRow[]> {
  if (usePostgresSubscriptions()) {
    let rows = await listAdminAccessUsersPg(search, 500);
    rows = rows.filter((r) => !r.email || !adminEmails.has(r.email.toLowerCase()));
    return rows;
  }

  const adminApp = getFirebaseAdmin();
  if (!adminApp) return [];
  const db = getFirestore(adminApp);
  const snap = await db.collection('userSubscriptions').orderBy('updatedAt', 'desc').limit(500).get();
  const authEmailCache = new Map<string, string>();
  let rows = await Promise.all(
    snap.docs.map((d) =>
      rowFromSubscriptionDocFirebase(d.id, d.data() as Record<string, unknown>, authEmailCache)
    )
  );
  rows = rows.filter((r) => !r.email || !adminEmails.has(r.email.toLowerCase()));
  const q = search.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) => r.uid.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)
    );
  }
  if (q.includes('@') && !rows.some((r) => r.email.toLowerCase() === q)) {
    try {
      const u = await getAuth(adminApp).getUserByEmail(q);
      const subSnap = await db.collection('userSubscriptions').doc(u.uid).get();
      if (subSnap.exists) {
        rows.unshift(
          await rowFromSubscriptionDocFirebase(
            u.uid,
            subSnap.data() as Record<string, unknown>,
            authEmailCache,
            u.email || q
          )
        );
      } else {
        rows.unshift({
          uid: u.uid,
          email: u.email || q,
          status: 'none',
          provider: 'none',
          plan: null,
          blocked: false,
          manualGrant: false,
          trialEndsAt: null,
          accessEndsAt: null,
          manualAccessEndsAt: null,
          manualExtraChannelSlots: 0,
          manualExtraChannelSlotsEndsAt: null,
          adminNote: '',
          updatedAt: null
        });
      }
    } catch {
      /* ignore */
    }
  }
  return rows;
}

async function resolveTenantUid(
  body: AdminAccessUserPutBody
): Promise<{ uid: string; email: string } | null> {
  let uid = String(body.uid || '').trim();
  let email = String(body.email || '').trim().toLowerCase();
  if (!uid && !email) return null;

  if (usePostgresSubscriptions()) {
    if (!uid && email) {
      const user = await findUserByEmail(email);
      if (!user) return null;
      uid = user.id;
      email = user.email.toLowerCase();
    } else if (uid) {
      const user = await findUserById(uid);
      if (!user) return null;
      if (user.email) email = user.email.toLowerCase();
    }
    return uid ? { uid, email } : null;
  }

  const adminApp = getFirebaseAdmin();
  if (!adminApp) return null;
  if (!uid && email) {
    const u = await getAuth(adminApp).getUserByEmail(email);
    uid = u.uid;
    email = (u.email || email).toLowerCase();
  }
  return { uid, email };
}

function buildAdminAccessUpdates(
  body: AdminAccessUserPutBody,
  cur: Record<string, unknown>,
  adminEmail: string,
  forPg: boolean
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    updatedAt: forPg ? new Date().toISOString() : FieldValue.serverTimestamp()
  };

  if (typeof body.blocked === 'boolean') {
    updates.blocked = body.blocked;
  }
  if (typeof body.adminNote === 'string') {
    updates.adminNote = body.adminNote.trim();
  }

  if (typeof body.manualGrant === 'boolean') {
    updates.manualGrant = body.manualGrant;
    if (body.manualGrant) {
      const days = Number(body.grantDays || 0);
      if (Number.isFinite(days) && days > 0) {
        const mode = body.grantMode === 'extend' ? 'extend' : 'set';
        const currentManualEnd = tsToIso(cur.manualAccessEndsAt);
        const currentManualMs = currentManualEnd ? new Date(currentManualEnd).getTime() : 0;
        const baseMs = mode === 'extend' ? Math.max(Date.now(), currentManualMs || 0) : Date.now();
        const end = new Date(baseMs + days * 24 * 60 * 60 * 1000);
        updates.manualAccessEndsAt = forPg ? end.toISOString() : Timestamp.fromDate(end);
      } else {
        updates.manualAccessEndsAt = forPg ? null : null;
      }
      updates.status = 'active';
      updates.provider = typeof cur.provider === 'string' ? cur.provider : 'none';
      updates.plan = typeof cur.plan === 'string' ? cur.plan : null;
      updates.manualGrantedAt = forPg ? new Date().toISOString() : FieldValue.serverTimestamp();
      updates.manualGrantedBy = adminEmail;
    } else {
      if (forPg) {
        updates.manualAccessEndsAt = null;
        updates.manualGrantedAt = null;
        updates.manualGrantedBy = null;
      } else {
        updates.manualAccessEndsAt = FieldValue.delete();
        updates.manualGrantedAt = FieldValue.delete();
        updates.manualGrantedBy = FieldValue.delete();
      }
      if ((cur.provider || 'none') === 'none') {
        updates.status = 'none';
        updates.plan = null;
      }
    }
  }

  if (body.manualExtraChannelSlots != null) {
    const slots = Math.max(0, Math.min(3, Math.floor(Number(body.manualExtraChannelSlots) || 0)));
    updates.manualExtraChannelSlots = slots;
    if (slots <= 0) {
      updates.manualExtraChannelSlotsEndsAt = forPg ? null : FieldValue.delete();
    } else {
      const addDays = Math.max(0, Math.floor(Number(body.channelGrantDays) || 0));
      const addMonths = Math.max(0, Math.floor(Number(body.channelGrantMonths) || 0));
      if (addDays > 0 || addMonths > 0) {
        const mode = body.channelGrantMode === 'extend' ? 'extend' : 'set';
        const currentEndIso = tsToIso(cur.manualExtraChannelSlotsEndsAt);
        const currentEndMs = currentEndIso ? new Date(currentEndIso).getTime() : 0;
        const baseMs = mode === 'extend' ? Math.max(Date.now(), currentEndMs || 0) : Date.now();
        const end = new Date(baseMs);
        if (addMonths > 0) end.setMonth(end.getMonth() + addMonths);
        if (addDays > 0) end.setDate(end.getDate() + addDays);
        updates.manualExtraChannelSlotsEndsAt = forPg
          ? end.toISOString()
          : Timestamp.fromDate(end);
      } else {
        updates.manualExtraChannelSlotsEndsAt = null;
      }
    }
  }

  return updates;
}

function inferAdminAccessAction(body: AdminAccessUserPutBody): string {
  if (typeof body.blocked === 'boolean') {
    return body.blocked ? 'block' : 'unblock';
  }
  if (body.manualExtraChannelSlots != null) {
    return Number(body.manualExtraChannelSlots) > 0 ? 'grant-extra-channels' : 'revoke-extra-channels';
  }
  if (typeof body.manualGrant === 'boolean') {
    return body.manualGrant
      ? body.grantMode === 'extend'
        ? 'extend-manual-access'
        : 'grant-manual-access'
      : 'revoke-manual-access';
  }
  return 'update';
}

async function appendAdminAccessAuditPg(
  targetUid: string,
  targetEmail: string,
  adminUid: string,
  adminEmail: string,
  action: string,
  note: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO zapmass.admin_access_audit
       (target_tenant_id, target_email, admin_subject_id, admin_email, action, note)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
    [
      /^[0-9a-f-]{36}$/i.test(targetUid) ? targetUid : null,
      targetEmail,
      adminUid,
      adminEmail,
      action,
      note
    ]
  );
}

export async function putAdminAccessUser(
  body: AdminAccessUserPutBody,
  admin: { uid: string; email: string }
): Promise<AdminUserAccessRow | { error: string; status: number }> {
  const resolved = await resolveTenantUid(body);
  if (!resolved) {
    return { error: 'Informe uid ou email válido.', status: 400 };
  }
  const { uid, email } = resolved;
  const forPg = usePostgresSubscriptions();

  let cur: Record<string, unknown> = {};
  if (forPg) {
    cur = (await getSubscriptionDocPg(uid)) || {};
  } else {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { error: 'Firebase Admin nao configurado no servidor.', status: 503 };
    }
    const snap = await getFirestore(adminApp).collection('userSubscriptions').doc(uid).get();
    cur = (snap.data() || {}) as Record<string, unknown>;
  }

  const updates = buildAdminAccessUpdates(body, cur, admin.email, forPg);

  if (forPg) {
    const merged = { ...cur, ...updates };
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) delete merged[k];
    }
    await mergeSubscriptionDocPg(uid, merged);
    const next = (await getSubscriptionDocPg(uid)) || merged;
    const row = docToAdminAccessRow(uid, next, email || (await findUserById(uid))?.email || '');
    await appendAdminAccessAuditPg(
      uid,
      row.email || email,
      admin.uid,
      admin.email,
      inferAdminAccessAction(body),
      typeof body.adminNote === 'string' ? body.adminNote.trim() : ''
    );
    return row;
  }

  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    return { error: 'Firebase Admin nao configurado no servidor.', status: 503 };
  }
  const db = getFirestore(adminApp);
  const ref = db.collection('userSubscriptions').doc(uid);
  await ref.set(updates, { merge: true });
  const next = await ref.get();
  const row = await rowFromSubscriptionDocFirebase(
    uid,
    next.data() as Record<string, unknown>,
    new Map(),
    email
  );
  await db.collection('adminAccessAudit').add({
    targetUid: uid,
    targetEmail: row.email || email || '',
    adminUid: admin.uid,
    adminEmail: admin.email,
    action: inferAdminAccessAction(body),
    note: typeof body.adminNote === 'string' ? body.adminNote.trim() : '',
    createdAt: FieldValue.serverTimestamp()
  });
  return row;
}

export async function listAdminAccessAudit(limit: number): Promise<AdminAccessAuditRow[]> {
  const cap = Math.max(10, Math.min(300, Math.round(limit) || 100));

  if (usePostgresSubscriptions() && getZapmassPool()) {
    const r = await getZapmassPool()!.query<{
      id: string;
      target_tenant_id: string | null;
      target_email: string;
      admin_subject_id: string;
      admin_email: string;
      action: string;
      note: string;
      created_at: Date;
    }>(
      `SELECT id::text, target_tenant_id::text, target_email, admin_subject_id, admin_email,
              action, note, created_at
       FROM zapmass.admin_access_audit
       ORDER BY created_at DESC
       LIMIT $1`,
      [cap]
    );
    return r.rows.map((row) => ({
      id: row.id,
      targetUid: row.target_tenant_id || '',
      targetEmail: row.target_email,
      adminUid: row.admin_subject_id,
      adminEmail: row.admin_email,
      action: row.action,
      note: row.note,
      createdAt: row.created_at.toISOString()
    }));
  }

  const adminApp = getFirebaseAdmin();
  if (!adminApp) return [];
  const snap = await getFirestore(adminApp)
    .collection('adminAccessAudit')
    .orderBy('createdAt', 'desc')
    .limit(cap)
    .get();
  return snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      targetUid: typeof x.targetUid === 'string' ? x.targetUid : '',
      targetEmail: typeof x.targetEmail === 'string' ? x.targetEmail : '',
      adminUid: typeof x.adminUid === 'string' ? x.adminUid : '',
      adminEmail: typeof x.adminEmail === 'string' ? x.adminEmail : '',
      action: typeof x.action === 'string' ? x.action : 'update',
      note: typeof x.note === 'string' ? x.note : '',
      createdAt: tsToIso(x.createdAt)
    };
  });
}
