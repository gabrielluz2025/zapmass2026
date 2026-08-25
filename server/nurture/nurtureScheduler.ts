import { listDueEnrollmentsPg } from './nurtureRepository.js';
import { processNurtureDueEnrollment } from './nurtureEngine.js';

const TICK_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await listDueEnrollmentsPg(80);
    for (const row of due) {
      try {
        await processNurtureDueEnrollment({
          id: row.id,
          tenantId: row.tenantId,
          journeyId: row.journeyId,
          contactPhone: row.contactPhone,
          connectionId: row.connectionId,
          conversationId: row.conversationId,
          currentStepIndex: row.currentStepIndex,
          journeyDoc: row.journeyDoc,
          lastSentDayKey: row.lastSentDayKey
        });
      } catch (e) {
        console.warn('[nurtureScheduler] falha em enrollment', row.id, (e as Error)?.message);
      }
    }
  } catch (e) {
    console.warn('[nurtureScheduler] tick falhou:', (e as Error)?.message);
  } finally {
    running = false;
  }
}

export function startNurtureScheduler(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  console.log('[NurtureScheduler] Iniciado (intervalo 30s).');
}

export function stopNurtureScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
