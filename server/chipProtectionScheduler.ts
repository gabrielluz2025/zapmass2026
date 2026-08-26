import { refreshAllKnownTenantProtections, tickChipEarlyWarningWatchdog } from './chipProtectionService.js';

const TICK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  await refreshAllKnownTenantProtections();
  await tickChipEarlyWarningWatchdog();
  try {
    const evo = await import('./evolutionService.js');
    await evo.tickAutoResumeProtectedCampaigns();
    await evo.tickCampaignStallWatchdog();
  } catch (e) {
    console.warn('[ChipProtection] tick campanhas falhou:', (e as Error)?.message);
  }
}

export function startChipProtectionScheduler(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  console.log('[ChipProtection] Scheduler automático iniciado (60s).');
}

export function stopChipProtectionScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
