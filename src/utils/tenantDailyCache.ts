import type { Campaign, Contact, ContactList } from '../types';
import { calendarDayKey } from '../../shared/dailyFullSync';

const STORAGE_PREFIX = 'zm:daily-bootstrap:v1:';

export type TenantDailyBootstrapCache = {
  day: string;
  uid: string;
  cachedAt: number;
  contacts: Contact[];
  contactsOffset: number;
  contactsHasMore: boolean;
  contactsSavedTotal: number | null;
  campaigns: Campaign[];
  contactLists: ContactList[];
  inboxFullSyncDone: boolean;
};

function storageKey(uid: string): string {
  return `${STORAGE_PREFIX}${uid}`;
}

export function readTenantDailyCache(uid: string): TenantDailyBootstrapCache | null {
  if (typeof localStorage === 'undefined' || !uid) return null;
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TenantDailyBootstrapCache;
    if (!parsed || parsed.uid !== uid || parsed.day !== calendarDayKey()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeTenantDailyCache(uid: string, patch: Partial<TenantDailyBootstrapCache>): void {
  if (typeof localStorage === 'undefined' || !uid) return;
  try {
    const prev = readTenantDailyCache(uid);
    const next: TenantDailyBootstrapCache = {
      day: calendarDayKey(),
      uid,
      cachedAt: Date.now(),
      contacts: patch.contacts ?? prev?.contacts ?? [],
      contactsOffset: patch.contactsOffset ?? prev?.contactsOffset ?? 0,
      contactsHasMore: patch.contactsHasMore ?? prev?.contactsHasMore ?? false,
      contactsSavedTotal: patch.contactsSavedTotal ?? prev?.contactsSavedTotal ?? null,
      campaigns: patch.campaigns ?? prev?.campaigns ?? [],
      contactLists: patch.contactLists ?? prev?.contactLists ?? [],
      inboxFullSyncDone: patch.inboxFullSyncDone ?? prev?.inboxFullSyncDone ?? false,
    };
    localStorage.setItem(storageKey(uid), JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

export function markInboxFullSyncDoneForToday(uid: string): void {
  writeTenantDailyCache(uid, { inboxFullSyncDone: true });
}

export function isInboxFullSyncDoneToday(uid: string): boolean {
  const c = readTenantDailyCache(uid);
  return !!c?.inboxFullSyncDone;
}

export function clearTenantDailyCache(uid: string): void {
  if (typeof localStorage === 'undefined' || !uid) return;
  try {
    localStorage.removeItem(storageKey(uid));
  } catch {
    /* ignore */
  }
}
