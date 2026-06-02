import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { addCalendarMonths } from './subscriptionPeriod.js';
import { notifyAdminsNewSignupAfterPaidIfNeeded } from './adminNewSignupNotify.js';
import { resolvePostgresTenantId } from './auth/firebaseUidMap.js';
import {
  getSubscriptionDocPg,
  mergeSubscriptionDocPg,
  tryClaimAdminNewClientNotifyPg
} from './repositories/subscriptionRepository.js';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
export type SubscriptionProvider = 'mercadopago' | 'infinitepay' | 'none';
export type SubscriptionPlan = 'monthly' | 'annual' | null;

export interface UserSubscriptionDoc {
  status: SubscriptionStatus;
  provider: SubscriptionProvider;
  plan: SubscriptionPlan;
  blocked?: boolean;
  manualAccessEndsAt?: Timestamp | string | null;
  mercadoPagoPreapprovalId?: string;
  mercadoPagoLastPaymentId?: string;
  infinitePayReference?: string;
  trialEndsAt?: Timestamp | string | null;
  accessEndsAt?: Timestamp | string | null;
  includedChannels?: number;
  extraChannelSlots?: number;
  mercadoPagoChannelAddonPreapprovalId?: string;
  mercadoPagoChannelAddonOneTimePaymentId?: string;
  manualExtraChannelSlots?: number;
  manualExtraChannelSlotsEndsAt?: Timestamp | string | null;
  manualGrant?: boolean;
  freeTrialUsed?: boolean;
  adminNewClientNotifiedAt?: Timestamp | string | null;
  nfeLastInvoiceId?: string;
  nfeLastInvoiceStatus?: string;
  nfeLastInvoicePdfUrl?: string;
  adminNote?: string;
  updatedAt?: Timestamp | string | null;
}

const COLLECTION = 'userSubscriptions';

export function usePostgresSubscriptions(): boolean {
  return vpsDataEnabled() && !!getZapmassPool();
}

function isFieldDelete(v: unknown): boolean {
  return v === FieldValue.delete() || (typeof v === 'object' && v !== null && '_methodName' in v);
}

function timeToIso(v: unknown): string | null | undefined {
  if (v == null || isFieldDelete(v)) return isFieldDelete(v) ? undefined : null;
  if (v instanceof Date) return v.toISOString();
  if (typeof (v as Timestamp).toDate === 'function') {
    return (v as Timestamp).toDate().toISOString();
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  return undefined;
}

function normalizePartialForPg(partial: Partial<UserSubscriptionDoc>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial)) {
    if (isFieldDelete(v)) continue;
    if (k.endsWith('At') || k === 'trialEndsAt' || k === 'accessEndsAt') {
      const iso = timeToIso(v);
      if (iso !== undefined) out[k] = iso;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function normalizePartialForFirestore(partial: Partial<UserSubscriptionDoc>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...partial };
  for (const [k, v] of Object.entries(partial)) {
    if (v instanceof Date) {
      out[k] = Timestamp.fromDate(v);
    }
  }
  return out;
}

function subscriptionTenantId(uid: string): string {
  if (!usePostgresSubscriptions()) return uid;
  return resolvePostgresTenantId(uid);
}

export async function getUserSubscription(uid: string): Promise<UserSubscriptionDoc | null> {
  if (!uid) return null;
  if (usePostgresSubscriptions()) {
    const doc = await getSubscriptionDocPg(subscriptionTenantId(uid));
    if (!doc) return null;
    return doc as unknown as UserSubscriptionDoc;
  }
  const app = getFirebaseAdmin();
  if (!app) return null;
  const snap = await getFirestore(app).collection(COLLECTION).doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() as UserSubscriptionDoc;
}

export async function mergeUserSubscription(
  uid: string,
  partial: Partial<UserSubscriptionDoc>
): Promise<boolean> {
  if (!uid) return false;
  if (usePostgresSubscriptions()) {
    const cur = (await getSubscriptionDocPg(subscriptionTenantId(uid))) || {};
    const merged = { ...cur, ...normalizePartialForPg(partial) };
    for (const [k, v] of Object.entries(partial)) {
      if (isFieldDelete(v) || v === null) delete merged[k];
    }
    return mergeSubscriptionDocPg(subscriptionTenantId(uid), merged);
  }
  const app = getFirebaseAdmin();
  if (!app) {
    console.warn('[Subscription] Firebase Admin nao configurado — persistencia ignorada.');
    return false;
  }
  const db = getFirestore(app);
  await db.collection(COLLECTION).doc(uid).set(
    {
      ...normalizePartialForFirestore(partial),
      updatedAt: FieldValue.serverTimestamp()
    } as Record<string, unknown>,
    { merge: true }
  );
  return true;
}

export async function extendPaidSubscription(
  uid: string,
  plan: 'monthly' | 'annual',
  extra: Partial<UserSubscriptionDoc> = {}
): Promise<boolean> {
  if (!uid) return false;

  if (usePostgresSubscriptions()) {
    const tid = subscriptionTenantId(uid);
    const cur = (await getSubscriptionDocPg(tid)) as unknown as UserSubscriptionDoc | null;
    const now = Date.now();
    let base = new Date();
    const existingEnd =
      cur?.accessEndsAt && typeof cur.accessEndsAt === 'string'
        ? Date.parse(cur.accessEndsAt)
        : null;
    if (existingEnd != null && existingEnd > now) {
      base = new Date(existingEnd);
    }
    const monthsToAdd = plan === 'monthly' ? 1 : 12;
    const endDate = addCalendarMonths(base, monthsToAdd);
    const wasRenewal = cur?.status === 'active' && existingEnd != null && existingEnd > now;
    const ok = await mergeSubscriptionDocPg(tid, {
      ...normalizePartialForPg(extra),
      status: 'active',
      plan,
      accessEndsAt: endDate.toISOString(),
      trialEndsAt: null
    });
    if (ok) {
      void notifyAdminsNewSignupAfterPaidIfNeeded(tid, { wasRenewal }).catch((e) => {
        console.error('[extendPaidSubscription] notify admins novo cliente', e);
      });
    }
    return ok;
  }

  const app = getFirebaseAdmin();
  if (!app) {
    console.warn('[Subscription] extendPaidSubscription: sem Firebase Admin.');
    return false;
  }
  const db = getFirestore(app);
  const ref = db.collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  const cur = snap.data() as UserSubscriptionDoc | undefined;
  const now = Date.now();
  let base = new Date();
  const existingEnd =
    typeof cur?.accessEndsAt === 'string'
      ? Date.parse(cur.accessEndsAt)
      : typeof (cur?.accessEndsAt as Timestamp | undefined)?.toMillis === 'function'
        ? (cur!.accessEndsAt as Timestamp).toMillis()
        : null;
  if (existingEnd != null && existingEnd > now) {
    base = new Date(existingEnd);
  }
  const monthsToAdd = plan === 'monthly' ? 1 : 12;
  const endDate = addCalendarMonths(base, monthsToAdd);
  await ref.set(
    {
      ...extra,
      status: 'active',
      plan,
      accessEndsAt: Timestamp.fromDate(endDate),
      trialEndsAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    } as Record<string, unknown>,
    { merge: true }
  );
  const wasRenewal = cur?.status === 'active' && existingEnd != null && existingEnd > now;
  void notifyAdminsNewSignupAfterPaidIfNeeded(uid, { wasRenewal }).catch((e) => {
    console.error('[extendPaidSubscription] notify admins novo cliente', e);
  });
  return true;
}

export async function tryClaimAdminNewClientNotify(uid: string): Promise<boolean> {
  if (!uid) return false;
  if (usePostgresSubscriptions()) {
    return tryClaimAdminNewClientNotifyPg(subscriptionTenantId(uid));
  }
  const admin = getFirebaseAdmin();
  if (!admin) return false;
  const db = getFirestore(admin);
  const ref = db.collection(COLLECTION).doc(uid);
  let claimed = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() as UserSubscriptionDoc | undefined;
    if (d?.adminNewClientNotifiedAt) return;
    tx.set(
      ref,
      {
        adminNewClientNotifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      } as Record<string, unknown>,
      { merge: true }
    );
    claimed = true;
  });
  return claimed;
}

/** ISO ou Timestamp → Date para e-mails pós-pagamento. */
export async function readAccessEndsAtDate(uid: string): Promise<Date | null> {
  const sub = await getUserSubscription(uid);
  if (!sub?.accessEndsAt) return null;
  const v = sub.accessEndsAt;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  if (typeof (v as Timestamp).toDate === 'function') {
    return (v as Timestamp).toDate();
  }
  return null;
}
