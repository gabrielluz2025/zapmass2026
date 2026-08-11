import { firestoreTimeToMs } from './firestoreTime';

/** Liberação admin ainda válida (sem prazo ou prazo no futuro). */
export function isManualGrantAccessActive(
  sub: { manualGrant?: boolean; manualAccessEndsAt?: unknown } | null | undefined,
  now: number = Date.now()
): boolean {
  if (!sub || sub.manualGrant !== true) return false;
  const end = firestoreTimeToMs(sub.manualAccessEndsAt);
  if (end == null) return true;
  return now < end;
}
