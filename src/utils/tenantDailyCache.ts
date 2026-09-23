import type { Campaign, Contact, ContactList } from '../types';
import { calendarDayKey, DEFAULT_FULL_SYNC_INTERVAL_MS } from '../../shared/dailyFullSync';
import { readContactsFromIdb, writeContactsToIdb, clearContactsIdb } from './contactsIdbCache';

const STORAGE_PREFIX = 'zm:daily-bootstrap:v2:';
/** Evita JSON.stringify síncrono a cada página de contatos — bloqueava a UI em todas as abas. */
const CACHE_WRITE_DEBOUNCE_MS = 4_000;

/** Cache válido por 24h (rolling), não só até a meia-noite. */
export const TENANT_CACHE_MAX_AGE_MS = DEFAULT_FULL_SYNC_INTERVAL_MS;

export type TenantDailyBootstrapCache = {
  day: string;
  uid: string;
  cachedAt: number;
  /**
   * Contatos agora persistidos no IndexedDB via contactsIdbCache.ts.
   * Mantemos o campo aqui para compatibilidade retroativa com caches v1
   * que possam ainda estar no localStorage — ignorados na leitura IDB.
   */
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

export function isTenantCacheFresh(
  cached: Pick<TenantDailyBootstrapCache, 'cachedAt' | 'day'>,
  maxAgeMs = TENANT_CACHE_MAX_AGE_MS
): boolean {
  if (cached.cachedAt > 0 && Date.now() - cached.cachedAt < maxAgeMs) return true;
  // Legado sem cachedAt confiável: aceita só no mesmo dia civil.
  return cached.day === calendarDayKey();
}

function readTenantDailyCacheRaw(uid: string): TenantDailyBootstrapCache | null {
  if (typeof localStorage === 'undefined' || !uid) return null;
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TenantDailyBootstrapCache;
    if (!parsed || parsed.uid !== uid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readTenantDailyCache(uid: string): TenantDailyBootstrapCache | null {
  const parsed = readTenantDailyCacheRaw(uid);
  if (!parsed) return null;
  if (!isTenantCacheFresh(parsed)) return null;
  return parsed;
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

/** Cache completo o bastante para não rebaixar a base na abertura. */
export function isTenantContactsCacheComplete(cached: TenantDailyBootstrapCache, idbLen: number): boolean {
  if (cached.contactsHasMore) return false;
  const saved = cached.contactsSavedTotal ?? 0;
  const loaded = Math.max(idbLen, cached.contactsOffset, cached.contacts.length);
  if (loaded <= 0) return false;
  if (saved <= 0) return !cached.contactsHasMore;
  // Aceita pequena diferença de COUNT(*) vs páginas (contatos apagados no meio).
  return loaded >= saved * 0.95 || loaded >= saved - 50;
}

/** Corrige cache salvo com hasMore=false enquanto ainda faltam contatos na base. */
export function healTenantDailyContactsCache(
  cached: TenantDailyBootstrapCache
): TenantDailyBootstrapCache {
  const saved = cached.contactsSavedTotal ?? 0;
  if (saved > cached.contactsOffset && saved > 0 && !cached.contactsHasMore) {
    // Preferir offset (IDB tem as linhas); se offset < saved, ainda falta baixar.
    if (cached.contactsOffset > 0 && cached.contactsOffset < saved) {
      return {
        ...cached,
        contactsHasMore: true,
        contactsOffset: cached.contactsOffset,
      };
    }
  }
  if (saved > cached.contacts.length && !cached.contactsHasMore && cached.contactsOffset === 0) {
    return {
      ...cached,
      contactsHasMore: true,
      contactsOffset: Math.max(cached.contactsOffset, cached.contacts.length),
    };
  }
  return cached;
}

export function writeTenantDailyCache(uid: string, patch: Partial<TenantDailyBootstrapCache>): void {
  if (typeof localStorage === 'undefined' || !uid) return;
  try {
    const prev = readTenantDailyCacheRaw(uid);
    const next: TenantDailyBootstrapCache = {
      day: calendarDayKey(),
      uid,
      cachedAt: Date.now(),
      contacts: [],           // contatos no IDB — não serializar no localStorage
      contactsOffset: patch.contactsOffset ?? prev?.contactsOffset ?? 0,
      contactsHasMore: patch.contactsHasMore ?? prev?.contactsHasMore ?? false,
      contactsSavedTotal: patch.contactsSavedTotal ?? prev?.contactsSavedTotal ?? null,
      campaigns: patch.campaigns ?? prev?.campaigns ?? [],
      contactLists: patch.contactLists ?? prev?.contactLists ?? [],
      inboxFullSyncDone: patch.inboxFullSyncDone ?? prev?.inboxFullSyncDone ?? false,
    };
    localStorage.setItem(storageKey(uid), JSON.stringify(next));

    // Persiste contatos no IndexedDB (assíncrono — não bloqueia)
    if (patch.contacts && patch.contacts.length > 0) {
      void writeContactsToIdb(uid, patch.contacts);
    }
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
  void clearContactsIdb(uid);
}
