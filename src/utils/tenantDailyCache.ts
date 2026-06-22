import type { Campaign, Contact, ContactList } from '../types';
import { calendarDayKey } from '../../shared/dailyFullSync';

const STORAGE_PREFIX = 'zm:daily-bootstrap:v1:';
/** Evita JSON.stringify síncrono a cada página de contatos — bloqueava a UI em todas as abas. */
const CACHE_WRITE_DEBOUNCE_MS = 4_000;

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

/** Cache incompleto (total salvo sem linhas) — força refetch em vez de spinner infinito. */
export function isTenantDailyCacheBootstrapValid(cached: TenantDailyBootstrapCache): boolean {
  const staleEmptyWithTotal =
    cached.contacts.length === 0 &&
    ((cached.contactsSavedTotal ?? 0) > 0 || cached.contactsHasMore || cached.contactsOffset > 0);
  if (staleEmptyWithTotal) return false;
  return (
    cached.contacts.length > 0 || cached.campaigns.length > 0 || cached.contactLists.length > 0
  );
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

let pendingWrite: { uid: string; patch: Partial<TenantDailyBootstrapCache> } | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let flushListenersAttached = false;

function runPendingCacheWrite(): void {
  if (!pendingWrite) return;
  const { uid, patch } = pendingWrite;
  pendingWrite = null;
  writeTenantDailyCache(uid, patch);
}

export function flushTenantDailyCacheWrite(): void {
  if (writeTimer != null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  runPendingCacheWrite();
}

function attachFlushListeners(): void {
  if (flushListenersAttached || typeof document === 'undefined') return;
  flushListenersAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTenantDailyCacheWrite();
  });
  window.addEventListener('pagehide', flushTenantDailyCacheWrite);
  window.addEventListener('beforeunload', flushTenantDailyCacheWrite);
}

/** Agenda persistência — debounce + idle para não bloquear troca de abas durante carga em lote. */
export function scheduleTenantDailyCacheWrite(
  uid: string,
  patch: Partial<TenantDailyBootstrapCache>
): void {
  if (!uid) return;
  pendingWrite = { uid, patch };
  attachFlushListeners();
  if (writeTimer != null) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => runPendingCacheWrite(), { timeout: 6_000 });
    } else {
      runPendingCacheWrite();
    }
  }, CACHE_WRITE_DEBOUNCE_MS);
}

export function markInboxFullSyncDoneForToday(uid: string): void {
  scheduleTenantDailyCacheWrite(uid, { inboxFullSyncDone: true });
  flushTenantDailyCacheWrite();
}

export function isInboxFullSyncDoneToday(uid: string): boolean {
  const c = readTenantDailyCache(uid);
  return !!c?.inboxFullSyncDone;
}

export function clearTenantDailyCache(uid: string): void {
  if (typeof localStorage === 'undefined' || !uid) return;
  if (pendingWrite?.uid === uid) pendingWrite = null;
  try {
    localStorage.removeItem(storageKey(uid));
  } catch {
    /* ignore */
  }
}
