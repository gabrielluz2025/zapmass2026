/** Intervalo padrão entre syncs completos (findChats + carga pesada da base). */
export const DEFAULT_FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function fullSyncIntervalMs(): number {
  const hours = Number(process.env.WA_FULL_SYNC_COOLDOWN_HOURS ?? 24);
  if (!Number.isFinite(hours) || hours < 1) return DEFAULT_FULL_SYNC_INTERVAL_MS;
  return Math.floor(hours * 60 * 60 * 1000);
}

export function isFullSyncDue(lastAtMs: number, now = Date.now()): boolean {
  if (!lastAtMs || lastAtMs <= 0) return true;
  return now - lastAtMs >= fullSyncIntervalMs();
}

/**
 * Redis guarda o cooldown; a inbox em RAM some no restart/deploy.
 * Se o último findChats foi noutro processo, precisa puxar de novo.
 */
export function isFullSyncDueAfterRestart(
  lastAtMs: number,
  processStartedAt: number,
  now = Date.now()
): boolean {
  if (processStartedAt > 0 && lastAtMs > 0 && lastAtMs < processStartedAt) return true;
  return isFullSyncDue(lastAtMs, now);
}

/** Chave YYYY-MM-DD no fuso local do browser/servidor. */
export function calendarDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
