import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import {
  deleteNotificationPg,
  insertNotificationPg,
  listNotificationsPg,
  markAllNotificationsReadPg,
  markNotificationReadPg,
  type PersistedNotificationCategory,
  type PersistedNotificationKind
} from './repositories/notificationsRepository.js';

export type { PersistedNotificationCategory, PersistedNotificationKind };

export function usePostgresNotifications(): boolean {
  return vpsDataEnabled() && !!getZapmassPool();
}

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
  if (usePostgresNotifications()) {
    return insertNotificationPg(uid, payload);
  }
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

export { listNotificationsPg, markNotificationReadPg, markAllNotificationsReadPg, deleteNotificationPg };
