import { listDueProspectingCampaigns, runProspectingSilentBumpWave } from './prospectingService.js';

const TICK_MS = 30 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await listDueProspectingCampaigns(10);
    if (due.length === 0) return;

    const evolutionService = await import('../evolutionService.js');
    for (const row of due) {
      try {
        const result = await runProspectingSilentBumpWave(row, (p) =>
          evolutionService.enqueueProspectingSilentBump(p)
        );
        if (result.enqueued > 0) {
          console.log(
            `[prospectingBump] campanha ${row.campaignId}: ${result.enqueued} lembrete(s) enfileirado(s)`
          );
        }
      } catch (e) {
        console.warn('[prospectingBump] falha na campanha', row.campaignId, (e as Error)?.message);
      }
    }
  } catch (e) {
    console.warn('[prospectingBump] tick falhou:', (e as Error)?.message);
  } finally {
    running = false;
  }
}

export function startProspectingSilentBumpJob(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  console.log('[ProspectingBump] Job semanal de silenciosos iniciado (intervalo 30 min).');
}

export function stopProspectingSilentBumpJob(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
