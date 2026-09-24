import { refreshAllKnownTenantProtections, tickChipEarlyWarningWatchdog } from './chipProtectionService.js';
import { maybeCleanupOldCampaignJobs } from './campaignJobsResilience.js';

const TICK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  await refreshAllKnownTenantProtections();
  await tickChipEarlyWarningWatchdog();
  try {
    const evo = await import('./evolutionService.js');
    await evo.tickAutoResumeProtectedCampaigns();
    await evo.tickCampaignStallWatchdog();
    await evo.tickSafeFailedAutoRetry();
  } catch (e) {
    console.warn('[ChipProtection] tick campanhas falhou:', (e as Error)?.message);
  }
  // Limpeza periódica da tabela campaign_jobs (máx 1x/6h)
  void maybeCleanupOldCampaignJobs().catch((e) =>
    console.warn('[CampaignJobsCleanup] erro no tick:', (e as Error)?.message)
  );
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
