import type { Queue } from 'bullmq';

/** Retenção agressiva — Redis 1–2 GB não é storage infinito (BullMQ + Evolution cache). */
export function bullmqRemoveOnComplete():
  | number
  | { count: number; age: number } {
  const count = Math.max(
    50,
    parseInt(process.env.BULLMQ_REMOVE_ON_COMPLETE_COUNT || '200', 10) || 200
  );
  const ageSec = Math.max(
    300,
    parseInt(process.env.BULLMQ_REMOVE_ON_COMPLETE_AGE_SEC || '3600', 10) || 3600
  );
  return { count, age: ageSec };
}

export function bullmqRemoveOnFail(): number | { count: number; age: number } {
  const count = Math.max(
    50,
    parseInt(process.env.BULLMQ_REMOVE_ON_FAIL_COUNT || '300', 10) || 300
  );
  const ageSec = Math.max(
    600,
    parseInt(process.env.BULLMQ_REMOVE_ON_FAIL_AGE_SEC || '86400', 10) || 86400
  );
  return { count, age: ageSec };
}

/** Limpa jobs antigos completed/failed para liberar RAM no Redis. */
export async function trimBullmqQueue(
  queue: Queue,
  label: string
): Promise<{ completed: number; failed: number }> {
  const completedGraceMs = Math.max(
    60_000,
    parseInt(process.env.BULLMQ_TRIM_COMPLETED_GRACE_MS || String(3600_000), 10)
  );
  const failedGraceMs = Math.max(
    300_000,
    parseInt(process.env.BULLMQ_TRIM_FAILED_GRACE_MS || String(86_400_000), 10)
  );
  const completedLimit = Math.max(
    50,
    parseInt(process.env.BULLMQ_TRIM_COMPLETED_LIMIT || '500', 10)
  );
  const failedLimit = Math.max(
    50,
    parseInt(process.env.BULLMQ_TRIM_FAILED_LIMIT || '200', 10)
  );

  let completed = 0;
  let failed = 0;
  try {
    const removedCompleted = await queue.clean(completedGraceMs, completedLimit, 'completed');
    completed = Array.isArray(removedCompleted) ? removedCompleted.length : 0;
  } catch (e) {
    console.warn(`[bullmq-trim] ${label} clean completed falhou:`, (e as Error)?.message || e);
  }
  try {
    const removedFailed = await queue.clean(failedGraceMs, failedLimit, 'failed');
    failed = Array.isArray(removedFailed) ? removedFailed.length : 0;
  } catch (e) {
    console.warn(`[bullmq-trim] ${label} clean failed falhou:`, (e as Error)?.message || e);
  }
  if (completed > 0 || failed > 0) {
    console.info(`[bullmq-trim] ${label}: removidos completed=${completed} failed=${failed}`);
  }
  return { completed, failed };
}
