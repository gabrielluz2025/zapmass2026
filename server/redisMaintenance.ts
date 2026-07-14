import type { Queue } from 'bullmq';
import { trimBullmqQueue } from './bullmqRetention.js';

type QueueRef = { name: string; getQueue: () => Queue | null };

let interval: NodeJS.Timeout | null = null;

/** Trim periódico de filas BullMQ — evita Redis 1 GB com noeviction. */
export function startBullmqMaintenance(queues: QueueRef[]): void {
  const raw = (process.env.BULLMQ_MAINTENANCE_ENABLED || '1').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return;
  if (interval) return;

  const periodMs = Math.max(
    300_000,
    parseInt(process.env.BULLMQ_MAINTENANCE_INTERVAL_MS || String(1_800_000), 10)
  );

  const run = () => {
    for (const ref of queues) {
      const q = ref.getQueue();
      if (!q) continue;
      void trimBullmqQueue(q, ref.name).catch((e) => {
        console.warn(`[bullmq-maintenance] ${ref.name}:`, (e as Error)?.message || e);
      });
    }
  };

  setTimeout(run, 30_000);
  interval = setInterval(run, periodMs);
  console.info(`[bullmq-maintenance] trim a cada ${Math.round(periodMs / 60_000)} min`);
}

export function stopBullmqMaintenance(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
