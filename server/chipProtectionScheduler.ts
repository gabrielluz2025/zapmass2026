import { refreshAllKnownTenantProtections } from './chipProtectionService.js';

const TICK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

export function startChipProtectionScheduler(): void {
  if (timer) return;
  void refreshAllKnownTenantProtections();
  timer = setInterval(() => void refreshAllKnownTenantProtections(), TICK_MS);
  console.log('[ChipProtection] Scheduler automático iniciado (60s).');
}

export function stopChipProtectionScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
