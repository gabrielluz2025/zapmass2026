import { isBrazilNightHour, msUntilBrazil8am } from './sleepModeService.js';

export type GradualResumeOptions = {
  /** Espaçamento linear entre jobs (ms). */
  spreadStepMs?: number;
  /** Jitter aleatório 0..jitterMaxMs por job. */
  jitterMaxMs?: number;
  /** Jobs processados por lote (evita bloquear event loop). */
  chunkSize?: number;
  /** Pausa entre chunks (ms). */
  chunkPauseMs?: number;
  /** Respeita silêncio noturno 20h–8h BRT ao reagendar. */
  respectNightWindow?: boolean;
};

export type GradualResumeResult = {
  scanned: number;
  rescheduled: number;
  skipped: number;
  errors: number;
};

const DEFAULT_OPTS: Required<Omit<GradualResumeOptions, 'respectNightWindow'>> & {
  respectNightWindow: boolean;
} = {
  spreadStepMs: 15_000,
  jitterMaxMs: 5_000,
  chunkSize: 50,
  chunkPauseMs: 10,
  respectNightWindow: true,
};

type CampaignJobLike = {
  id?: string;
  data: { campaignId?: string };
  timestamp: number;
  opts: { delay?: number };
  changeDelay: (delay: number) => Promise<void>;
  moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
  getState: () => Promise<string>;
};

/** Quando o job deve rodar (epoch ms). */
export function estimateJobRunAt(job: { timestamp: number; opts: { delay?: number } }): number {
  const delay = Math.max(0, Number(job.opts.delay) || 0);
  return job.timestamp + delay;
}

/**
 * Ajusta horário para fora do silêncio noturno (20h–8h BRT).
 * Preserva o offset de spread relativo ao início da janela (ex.: 08:00 + spread).
 */
export function clampRunAtToAllowedWindow(
  runAtMs: number,
  spreadOffsetMs: number,
  respectNightWindow = true
): number {
  if (!respectNightWindow || !isBrazilNightHour(runAtMs)) return runAtMs;
  const windowStart = runAtMs + msUntilBrazil8am(runAtMs);
  return windowStart + Math.max(0, spreadOffsetMs);
}

/** Calcula epoch ms do próximo run, preservando agendamentos futuros. */
export function computeGradualRunAtMs(params: {
  index: number;
  nowMs: number;
  originalRunAtMs: number;
  spreadStepMs: number;
  jitterMaxMs: number;
  random?: () => number;
  respectNightWindow?: boolean;
}): number {
  const rand = params.random ?? Math.random;
  const jitter = Math.floor(rand() * (params.jitterMaxMs + 1));
  const spreadOffset = params.spreadStepMs * params.index + jitter;
  const floorRunAt = params.nowMs + spreadOffset;
  let newRunAt = Math.max(params.originalRunAtMs, floorRunAt);
  newRunAt = clampRunAtToAllowedWindow(newRunAt, spreadOffset, params.respectNightWindow !== false);
  return newRunAt;
}

/** Calcula novo delay relativo a `now`, preservando agendamentos futuros. */
export function computeGradualDelayMs(params: {
  index: number;
  nowMs: number;
  originalRunAtMs: number;
  spreadStepMs: number;
  jitterMaxMs: number;
  random?: () => number;
  respectNightWindow?: boolean;
}): number {
  const newRunAt = computeGradualRunAtMs(params);
  return Math.max(0, newRunAt - params.nowMs);
}

function matchesCampaign(job: CampaignJobLike, campaignId: string): boolean {
  return String(job.data?.campaignId || '').trim() === campaignId;
}

async function rescheduleJob(job: CampaignJobLike, newDelayMs: number): Promise<void> {
  const state = await job.getState();
  if (state === 'delayed') {
    await job.changeDelay(newDelayMs);
    return;
  }
  if (state === 'waiting' || state === 'paused') {
    await job.moveToDelayed(Date.now() + newDelayMs);
    return;
  }
  if (state === 'active') {
    throw new Error('active job cannot be rescheduled without token');
  }
}

/**
 * Distribui jobs acumulados (waiting/delayed) após retomada de campanha —
 * evita burst spike no WhatsApp.
 */
export async function spreadCampaignJobsOnResume<T extends { campaignId?: string }>(
  queue: import('bullmq').Queue<T>,
  campaignId: string,
  opts?: GradualResumeOptions
): Promise<GradualResumeResult> {
  const cfg = { ...DEFAULT_OPTS, ...opts };
  const cid = String(campaignId || '').trim();
  const result: GradualResumeResult = { scanned: 0, rescheduled: 0, skipped: 0, errors: 0 };

  if (!cid) return result;

  const collected: CampaignJobLike[] = [];
  const states: Array<'delayed' | 'waiting'> = ['delayed', 'waiting'];
  const pageSize = 200;

  for (const state of states) {
    let start = 0;
    while (true) {
      const batch = (await queue.getJobs([state], start, start + pageSize - 1, true)) as import('bullmq').Job<T>[];
      if (batch.length === 0) break;
      for (const job of batch) {
        if (!matchesCampaign(job as CampaignJobLike, cid)) continue;
        collected.push(job as unknown as CampaignJobLike);
      }
      if (batch.length < pageSize) break;
      start += pageSize;
    }
  }

  collected.sort((a, b) => estimateJobRunAt(a) - estimateJobRunAt(b));
  result.scanned = collected.length;
  if (collected.length === 0) return result;

  const now = Date.now();

  for (let i = 0; i < collected.length; i++) {
    const job = collected[i];
    const originalRunAt = estimateJobRunAt(job);
    const newDelayMs = computeGradualDelayMs({
      index: i,
      nowMs: now,
      originalRunAtMs: originalRunAt,
      spreadStepMs: cfg.spreadStepMs,
      jitterMaxMs: cfg.jitterMaxMs,
      respectNightWindow: cfg.respectNightWindow,
    });

    try {
      await rescheduleJob(job, newDelayMs);
      result.rescheduled++;
    } catch {
      result.errors++;
    }

    if ((i + 1) % cfg.chunkSize === 0) {
      await new Promise((r) => setTimeout(r, cfg.chunkPauseMs));
    }
  }

  result.skipped = result.scanned - result.rescheduled - result.errors;
  return result;
}
