import type { AppNotificationRow } from '../context/NotificationContext';
import { apiFetchJson } from '../utils/apiFetchAuth';

export async function fetchNotifications(): Promise<{
  notifications: AppNotificationRow[];
  unreadCount: number;
}> {
  const j = await apiFetchJson<{
    notifications?: AppNotificationRow[];
    unreadCount?: number;
  }>('/api/notifications');
  return {
    notifications: Array.isArray(j.notifications) ? j.notifications : [],
    unreadCount: Number(j.unreadCount) || 0
  };
}

export async function apiMarkNotificationRead(id: string): Promise<void> {
  await apiFetchJson(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export async function apiMarkAllNotificationsRead(): Promise<void> {
  await apiFetchJson('/api/notifications/read-all', { method: 'POST' });
}

export async function apiDeleteNotification(id: string): Promise<void> {
  await apiFetchJson(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
