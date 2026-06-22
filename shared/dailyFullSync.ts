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

/** Chave YYYY-MM-DD no fuso local do browser/servidor. */
export function calendarDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
