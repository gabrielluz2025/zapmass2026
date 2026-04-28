import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';

export type PersistedNotificationKind = 'info' | 'success' | 'warning' | 'error';

export type PersistedNotificationCategory =
  | 'campaign'
  | 'schedule'
  | 'billing'
  | 'system'
  | 'admin'
  | 'other';

/**
 * Grava uma notificação na caixa do utilizador (mesmo que esteja offline).
 * Regras do Firestore não aplicam — Admin SDK.
 */
export async function persistUserNotification(
  uid: string,
  payload: {
    title: string;
    body: string;
    kind: PersistedNotificationKind;
    category: PersistedNotificationCategory;
    campaignId?: string;
  }
): Promise<void> {
  if (!uid || !payload.title?.trim() || !payload.body?.trim()) return;
  const admin = getFirebaseAdmin();
  if (!admin) return;
  const db = getFirestore(admin);
  await db.collection('users').doc(uid).collection('notifications').add({
    title: payload.title.trim().slice(0, 200),
    body: payload.body.trim().slice(0, 4000),
    kind: payload.kind,
    category: payload.category,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    ...(payload.campaignId ? { campaignId: String(payload.campaignId).slice(0, 128) } : {})
  });
}
