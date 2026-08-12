import { randomUUID } from 'crypto';
import type { ContactNameNormalizeOpts } from '../src/utils/contactNameNormalize.js';
import { normalizeContactPersonName } from '../src/utils/contactNameNormalize.js';
import {
  bulkUpdateContacts,
  countContacts,
  listContactsAfterId
} from './repositories/contactsRepository.js';
import { invalidateCrmContactIndexCache } from './crmContactIndexCache.js';
import { invalidateContactsCountCache } from './repositories/contactsRepository.js';

export type NameNormalizeJobStatus = 'running' | 'paused' | 'done' | 'cancelled' | 'error';

export type NameNormalizeJobPublic = {
  id: string;
  status: NameNormalizeJobStatus;
  total: number;
  scanned: number;
  updated: number;
  unchanged: number;
  percent: number;
  message: string;
  lastError?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
};

type NameNormalizeJob = NameNormalizeJobPublic & {
  tenantId: string;
  opts: ContactNameNormalizeOpts;
  afterId: string | null;
};

const jobs = new Map<string, NameNormalizeJob>();
const runningLoops = new Map<string, boolean>();

const PAGE_SIZE = 500;
const UPDATE_CHUNK = 200;

function publicJob(job: NameNormalizeJob): NameNormalizeJobPublic {
  const { tenantId: _t, opts: _o, afterId: _a, ...pub } = job;
  return { ...pub };
}

export function getNameNormalizeJob(jobId: string, tenantId: string): NameNormalizeJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  return publicJob(job);
}

export function listActiveNameNormalizeJobs(tenantId: string): NameNormalizeJobPublic[] {
  return [...jobs.values()]
    .filter((j) => j.tenantId === tenantId && (j.status === 'running' || j.status === 'paused'))
    .map(publicJob);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function startNameNormalizeJob(opts: {
  tenantId: string;
  normalizeOpts: ContactNameNormalizeOpts;
}): Promise<NameNormalizeJobPublic> {
  const active = listActiveNameNormalizeJobs(opts.tenantId);
  if (active.length > 0) {
    throw new Error('Já existe uma padronização de nomes em curso. Aguarde ou cancele.');
  }

  const total = await countContacts(opts.tenantId);
  if (total <= 0) throw new Error('Nenhum contato na base.');

  const job: NameNormalizeJob = {
    id: randomUUID(),
    tenantId: opts.tenantId,
    status: 'running',
    total,
    scanned: 0,
    updated: 0,
    unchanged: 0,
    percent: 0,
    message: 'A padronizar nomes no servidor — pode fechar a aba.',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    opts: {
      stripPrefixes: opts.normalizeOpts.stripPrefixes !== false,
      titleCase: opts.normalizeOpts.titleCase !== false,
      firstAndLastOnly: !!opts.normalizeOpts.firstAndLastOnly,
      sanitizeCharacters: opts.normalizeOpts.sanitizeCharacters !== false,
      extraPrefixes: Array.isArray(opts.normalizeOpts.extraPrefixes)
        ? opts.normalizeOpts.extraPrefixes.slice(0, 80)
        : []
    },
    afterId: null
  };
  jobs.set(job.id, job);
  void processLoop(job.id);
  return publicJob(job);
}

export function pauseNameNormalizeJob(jobId: string, tenantId: string): NameNormalizeJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'running') {
    job.status = 'paused';
    job.message = 'Padronização pausada.';
    job.updatedAt = Date.now();
  }
  return publicJob(job);
}

export function resumeNameNormalizeJob(jobId: string, tenantId: string): NameNormalizeJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'paused') {
    job.status = 'running';
    job.message = 'A retomar padronização…';
    job.updatedAt = Date.now();
    void processLoop(job.id);
  }
  return publicJob(job);
}

export function cancelNameNormalizeJob(jobId: string, tenantId: string): NameNormalizeJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'running' || job.status === 'paused') {
    job.status = 'cancelled';
    job.message = 'Padronização cancelada.';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
  }
  return publicJob(job);
}

/** Contagem rápida (sem gravar) — útil no modal «Calcular alterações». */
export async function previewNameNormalizeChanges(
  tenantId: string,
  normalizeOpts: ContactNameNormalizeOpts
): Promise<{ total: number; changed: number }> {
  const total = await countContacts(tenantId);
  let changed = 0;
  let afterId: string | null = null;
  const opts: ContactNameNormalizeOpts = {
    stripPrefixes: normalizeOpts.stripPrefixes !== false,
    titleCase: normalizeOpts.titleCase !== false,
    firstAndLastOnly: !!normalizeOpts.firstAndLastOnly,
    sanitizeCharacters: normalizeOpts.sanitizeCharacters !== false,
    extraPrefixes: Array.isArray(normalizeOpts.extraPrefixes)
      ? normalizeOpts.extraPrefixes.slice(0, 80)
      : []
  };
  while (true) {
    const page = await listContactsAfterId(tenantId, { afterId, limit: PAGE_SIZE });
    if (page.length === 0) break;
    for (const c of page) {
      const before = (c.name || '').trim();
      const after = normalizeContactPersonName(before, opts);
      if (after && after !== before) changed++;
    }
    afterId = page[page.length - 1]!.id;
    if (page.length < PAGE_SIZE) break;
  }
  return { total, changed };
}

async function processLoop(jobId: string): Promise<void> {
  if (runningLoops.get(jobId)) return;
  runningLoops.set(jobId, true);
  try {
    while (true) {
      const job = jobs.get(jobId);
      if (!job) return;
      if (job.status !== 'running') return;

      const page = await listContactsAfterId(job.tenantId, {
        afterId: job.afterId,
        limit: PAGE_SIZE
      });
      if (page.length === 0) {
        job.status = 'done';
        job.percent = 100;
        job.message =
          job.updated > 0
            ? `Concluído — ${job.updated.toLocaleString('pt-BR')} nome(s) atualizado(s).`
            : 'Concluído — nenhum nome precisou de alteração.';
        job.finishedAt = Date.now();
        job.updatedAt = Date.now();
        invalidateCrmContactIndexCache(job.tenantId);
        invalidateContactsCountCache(job.tenantId);
        return;
      }

      const items: Array<{ id: string; updates: { name: string } }> = [];
      for (const c of page) {
        const before = (c.name || '').trim();
        const after = normalizeContactPersonName(before, job.opts);
        if (!after || after === before) {
          job.unchanged += 1;
          continue;
        }
        items.push({ id: c.id, updates: { name: after } });
      }

      for (let i = 0; i < items.length; i += UPDATE_CHUNK) {
        const current = jobs.get(jobId);
        if (!current || current.status !== 'running') return;
        const slice = items.slice(i, i + UPDATE_CHUNK);
        await bulkUpdateContacts(job.tenantId, slice);
        current.updated += slice.length;
        current.updatedAt = Date.now();
      }

      const afterJob = jobs.get(jobId);
      if (!afterJob || afterJob.status !== 'running') return;
      afterJob.scanned += page.length;
      afterJob.afterId = page[page.length - 1]!.id;
      afterJob.percent = Math.min(
        99,
        Math.round((100 * afterJob.scanned) / Math.max(1, afterJob.total))
      );
      afterJob.message = `A padronizar nomes (${afterJob.scanned.toLocaleString('pt-BR')} de ${afterJob.total.toLocaleString('pt-BR')}) — ${afterJob.updated.toLocaleString('pt-BR')} alterado(s)…`;
      afterJob.updatedAt = Date.now();
      await sleep(20);
    }
  } catch (e) {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.lastError = e instanceof Error ? e.message : String(e);
      job.message = 'Erro na padronização de nomes';
      job.finishedAt = Date.now();
      job.updatedAt = Date.now();
    }
  } finally {
    runningLoops.delete(jobId);
  }
}
