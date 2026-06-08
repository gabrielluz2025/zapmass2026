import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { useAuth } from './AuthContext';
import { useWorkspace } from './WorkspaceContext';
import {
  apiDeleteNotification,
  apiMarkAllNotificationsRead,
  apiMarkNotificationRead,
  fetchNotifications
} from '../services/notificationsApi';

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
    let cancelled = false;
    const load = async () => {
      try {
        const { notifications: rows } = await fetchNotifications();
        if (!cancelled) setNotifications(rows);
      } catch (e) {
        console.error('[notifications]', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const t = setInterval(() => void load(), 45_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user?.uid, dataUid, wsLoading]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markAsRead = useCallback(async (id: string) => {
    if (!dataUid) return;
    try {
      await apiMarkNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch {
      /* ignore */
    }
  }, [dataUid]);

  const markAllAsRead = useCallback(async () => {
    if (!dataUid) return;
    const unread = notifications.filter((n) => !n.read);
    if (!unread.length) return;
    try {
      await apiMarkAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      /* ignore */
    }
  }, [dataUid, notifications]);

  const remove = useCallback(
    async (id: string) => {
      if (!dataUid) return;
      try {
        await apiDeleteNotification(id);
        setNotifications((prev) => prev.filter((n) => n.id !== id));
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
