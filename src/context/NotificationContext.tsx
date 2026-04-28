import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import {
  collection,
  doc,
  deleteDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './AuthContext';
import { useWorkspace } from './WorkspaceContext';

export type AppNotificationKind = 'info' | 'success' | 'warning' | 'error';

export type AppNotificationCategory =
  | 'campaign'
  | 'schedule'
  | 'billing'
  | 'system'
  | 'admin'
  | 'other';

export interface AppNotificationRow {
  id: string;
  title: string;
  body: string;
  kind: AppNotificationKind;
  category: AppNotificationCategory;
  read: boolean;
  createdAtMs: number;
  campaignId?: string;
}

interface NotificationContextValue {
  notifications: AppNotificationRow[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function rowFromDoc(d: QueryDocumentSnapshot): AppNotificationRow | null {
  const raw = d.data() as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title : '';
  const body = typeof raw.body === 'string' ? raw.body : '';
  if (!title && !body) return null;
  const kind = (['info', 'success', 'warning', 'error'].includes(String(raw.kind))
    ? raw.kind
    : 'info') as AppNotificationKind;
  const category = (['campaign', 'schedule', 'billing', 'system', 'admin', 'other'].includes(
    String(raw.category)
  )
    ? raw.category
    : 'other') as AppNotificationCategory;
  let createdAtMs = Date.now();
  const ca = raw.createdAt as { toMillis?: () => number } | undefined;
  if (ca && typeof ca.toMillis === 'function') {
    try {
      createdAtMs = ca.toMillis();
    } catch {
      /* ignore */
    }
  }
  return {
    id: d.id,
    title: title || 'Notificação',
    body: body || '—',
    kind,
    category,
    read: raw.read === true,
    createdAtMs,
    campaignId: typeof raw.campaignId === 'string' ? raw.campaignId : undefined
  };
}

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { effectiveWorkspaceUid, loading: wsLoading } = useWorkspace();
  const [notifications, setNotifications] = useState<AppNotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const dataUid = user?.uid ? effectiveWorkspaceUid ?? user.uid : null;

  useEffect(() => {
    if (!user?.uid || !dataUid || wsLoading) {
      setNotifications([]);
      if (!wsLoading) setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'users', dataUid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(80)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => rowFromDoc(d))
          .filter((x): x is AppNotificationRow => x != null);
        setNotifications(rows);
        setLoading(false);
      },
      (err) => {
        console.error('[notifications]', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.uid, dataUid, wsLoading]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markAsRead = useCallback(
    async (id: string) => {
      if (!dataUid) return;
      try {
        await updateDoc(doc(db, 'users', dataUid, 'notifications', id), { read: true });
      } catch {
        /* ignore */
      }
    },
    [dataUid]
  );

  const markAllAsRead = useCallback(async () => {
    if (!dataUid) return;
    const unread = notifications.filter((n) => !n.read);
    if (!unread.length) return;
    try {
      const batch = writeBatch(db);
      unread.forEach((n) => {
        batch.update(doc(db, 'users', dataUid, 'notifications', n.id), { read: true });
      });
      await batch.commit();
    } catch {
      /* ignore */
    }
  }, [dataUid, notifications]);

  const remove = useCallback(
    async (id: string) => {
      if (!dataUid) return;
      try {
        await deleteDoc(doc(db, 'users', dataUid, 'notifications', id));
      } catch {
        /* ignore */
      }
    },
    [dataUid]
  );

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      markAsRead,
      markAllAsRead,
      remove
    }),
    [notifications, unreadCount, loading, markAsRead, markAllAsRead, remove]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications deve ser usado dentro de NotificationProvider.');
  }
  return ctx;
}
