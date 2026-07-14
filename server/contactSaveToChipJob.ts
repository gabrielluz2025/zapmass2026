import { randomUUID } from 'crypto';
import type { Contact } from '../src/types.js';
import { listContacts, countContacts } from './repositories/contactsRepository.js';
import { saveContactToChip, type SaveToChipResult } from './contactSaveToChip.js';
import * as evolutionService from './evolutionService.js';

export type ChipBaseSyncStatus = 'running' | 'paused' | 'done' | 'cancelled' | 'error';

export type ChipBaseSyncJob = {
  id: string;
  tenantId: string;
  connectionId: string;
  status: ChipBaseSyncStatus;
  totalEstimated: number;
  processed: number;
  added: number;
  updated: number;
  failed: number;
  skipped: number;
  delayMs: number;
  pageSize: number;
  offset: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  lastError?: string;
  /** Últimos erros (máx. 8) para diagnóstico na UI. */
  recentErrors: Array<{ id: string; error: string }>;
};

const jobs = new Map<string, ChipBaseSyncJob>();
const runningLoops = new Map<string, boolean>();

const MIN_DELAY_MS = 250;
const MAX_DELAY_MS = 2_000;
const DEFAULT_DELAY_MS = 450;
const PAGE_SIZE = 80;

function clampDelay(n: number | undefined): number {
  const v = Math.floor(Number(n) || DEFAULT_DELAY_MS);
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, v));
}

export function getChipBaseSyncJob(jobId: string, tenantId: string): ChipBaseSyncJob | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  return { ...job, recentErrors: [...job.recentErrors] };
}

export function listActiveChipBaseSyncJobs(tenantId: string): ChipBaseSyncJob[] {
  return [...jobs.values()]
    .filter((j) => j.tenantId === tenantId && (j.status === 'running' || j.status === 'paused'))
    .map((j) => ({ ...j, recentErrors: [...j.recentErrors] }));
}

function pushRecentError(job: ChipBaseSyncJob, id: string, error: string) {
  job.recentErrors.unshift({ id, error: error.slice(0, 180) });
  if (job.recentErrors.length > 8) job.recentErrors.length = 8;
}

async function processLoop(jobId: string): Promise<void> {
  if (runningLoops.get(jobId)) return;
  runningLoops.set(jobId, true);
  try {
    while (true) {
      const job = jobs.get(jobId);
      if (!job) return;
      if (job.status === 'paused' || job.status === 'cancelled' || job.status === 'done' || job.status === 'error') {
        return;
      }

      const page = await listContacts(job.tenantId, { limit: job.pageSize, offset: job.offset });
      if (page.length === 0) {
        job.status = 'done';
        job.finishedAt = Date.now();
        job.updatedAt = Date.now();
        return;
      }

      for (const contact of page) {
        const current = jobs.get(jobId);
        if (!current || current.status !== 'running') return;

        const r = await saveOneEligible(current, contact);
        current.processed += 1;
        if (r.kind === 'skip') current.skipped += 1;
        else if (r.kind === 'ok') {
          if (r.action === 'updated') current.updated += 1;
          else current.added += 1;
        } else {
          current.failed += 1;
          pushRecentError(current, contact.id, r.error);
          // Endpoint Evolution inexistente → aborta o job inteiro.
          if (r.fatal) {
            current.status = 'error';
            current.lastError = r.error;
            current.finishedAt = Date.now();
            current.updatedAt = Date.now();
            return;
          }
        }
        current.updatedAt = Date.now();
        await sleep(current.delayMs);
      }

      const after = jobs.get(jobId);
      if (!after || after.status !== 'running') return;
      after.offset += page.length;
      after.updatedAt = Date.now();
      // Pausa extra entre páginas (base grande).
      await sleep(Math.max(800, after.delayMs * 2));
    }
  } catch (e) {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.lastError = e instanceof Error ? e.message : String(e);
      job.finishedAt = Date.now();
      job.updatedAt = Date.now();
    }
  } finally {
    runningLoops.delete(jobId);
  }
}

async function saveOneEligible(
  job: ChipBaseSyncJob,
  contact: Contact
): Promise<
  | { kind: 'skip' }
  | { kind: 'ok'; action: 'added' | 'updated' }
  | { kind: 'fail'; error: string; fatal?: boolean }
> {
  const name = (contact.name || '').trim();
  const phone = (contact.phone || '').replace(/\D/g, '');
  if (!name || phone.length < 10) return { kind: 'skip' };

  const r: SaveToChipResult = await saveContactToChip(job.tenantId, contact.id, job.connectionId);
  if (r.ok && r.action) return { kind: 'ok', action: r.action };
  const err = r.error || 'Falha ao gravar';
  const fatal =
    err.includes('ainda não permite gravar') ||
    err.includes('SAVE_CONTACT_UNSUPPORTED') ||
    err.toLowerCase().includes('atualize a imagem evolution');
  return { kind: 'fail', error: err, fatal };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startChipBaseSyncJob(opts: {
  tenantId: string;
  connectionId: string;
  delayMs?: number;
}): Promise<ChipBaseSyncJob> {
  const active = listActiveChipBaseSyncJobs(opts.tenantId);
  if (active.length > 0) {
    throw new Error('Já existe uma sincronização de agenda em curso. Pause ou aguarde terminar.');
  }

  const supported = await evolutionService.probeSaveContactSupport(opts.connectionId);
  if (!supported.ok) {
    throw new Error(
      supported.error ||
        'Esta Evolution API ainda não permite gravar na agenda do celular. Atualize a imagem Evolution ou contacte o suporte.'
    );
  }

  const totalEstimated = await countContacts(opts.tenantId);
  const job: ChipBaseSyncJob = {
    id: randomUUID(),
    tenantId: opts.tenantId,
    connectionId: opts.connectionId,
    status: 'running',
    totalEstimated,
    processed: 0,
    added: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    delayMs: clampDelay(opts.delayMs),
    pageSize: PAGE_SIZE,
    offset: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    recentErrors: []
  };
  jobs.set(job.id, job);
  void processLoop(job.id);
  return { ...job, recentErrors: [] };
}

export function pauseChipBaseSyncJob(jobId: string, tenantId: string): ChipBaseSyncJob | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'running') {
    job.status = 'paused';
    job.updatedAt = Date.now();
  }
  return getChipBaseSyncJob(jobId, tenantId);
}

export function resumeChipBaseSyncJob(jobId: string, tenantId: string): ChipBaseSyncJob | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'paused') {
    job.status = 'running';
    job.updatedAt = Date.now();
    void processLoop(job.id);
  }
  return getChipBaseSyncJob(jobId, tenantId);
}

export function cancelChipBaseSyncJob(jobId: string, tenantId: string): ChipBaseSyncJob | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'running' || job.status === 'paused') {
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
  }
  return getChipBaseSyncJob(jobId, tenantId);
}
