import type { UseSegmentId } from '../constants/useSegments';
import type { UserSubscription } from '../types';

const CACHE_KEY = 'zapmass.bootstrap.v1';
const TTL_MS = 24 * 60 * 60 * 1000;

export const BOOTSTRAP_API_TIMEOUT_MS = 12_000;

type BootstrapCachePayload = {
  uid: string;
  at: number;
  segment: UseSegmentId | null;
  subscription: UserSubscription | null;
};

function readRaw(): BootstrapCachePayload | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BootstrapCachePayload;
    if (!parsed?.uid || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readBootstrapCache(uid: string): {
  segment: UseSegmentId | null;
  subscription: UserSubscription | null;
} | null {
  const hit = readRaw();
  if (!hit || hit.uid !== uid) return null;
  return { segment: hit.segment ?? null, subscription: hit.subscription ?? null };
}

export function writeBootstrapCache(
  uid: string,
  patch: { segment?: UseSegmentId | null; subscription?: UserSubscription | null }
): void {
  try {
    const prev = readRaw();
    const base: BootstrapCachePayload =
      prev && prev.uid === uid
        ? prev
        : { uid, at: Date.now(), segment: null, subscription: null };
    const next: BootstrapCachePayload = {
      uid,
      at: Date.now(),
      segment: patch.segment !== undefined ? patch.segment : base.segment,
      subscription: patch.subscription !== undefined ? patch.subscription : base.subscription
    };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* quota / modo privado */
  }
}

export function clearBootstrapCache(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
