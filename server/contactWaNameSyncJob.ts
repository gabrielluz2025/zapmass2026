import { randomUUID } from 'crypto';
import { isSuspiciousContactName } from '../src/utils/contactNameNormalize.js';
import { syncContactWaName } from './contactWaNameSync.js';
import * as evolutionService from './evolutionService.js';
import type { PhonebookNameIndex } from './evolutionContactName.js';
import {
  countContacts,
  getContactById,
  listContactsAfterId,
} from './repositories/contactsRepository.js';
import { invalidateCrmContactIndexCache } from './crmContactIndexCache.js';
import { invalidateContactsCountCache } from './repositories/contactsRepository.js';

export type WaNameSyncJobStatus = 'running' | 'done' | 'cancelled' | 'error';

export type WaNameSyncJobPublic = {
  id: string;
  status: WaNameSyncJobStatus;
  mode: 'ids' | 'suspicious';
  total: number;
  scanned: number;
  updated: number;
  skipped: number;
  unavailable: number;
  failed: number;
  percent: number;
  message: string;
  lastError?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
};

type WaNameSyncJob = WaNameSyncJobPublic & {
  tenantId: string;
  connectionId?: string;
  ids: string[] | null;
  afterId: string | null;
  phonebookIndex: PhonebookNameIndex | null;
};

const jobs = new Map<string, WaNameSyncJob>();
const runningLoops = new Map<string, boolean>();

const PAGE_SIZE = 200;
const THROTTLE_MS = 350;

function publicJob(job: WaNameSyncJob): WaNameSyncJobPublic {
  const { tenantId: _t, connectionId: _c, ids: _i, afterId: _a, phonebookIndex: _p, ...pub } = job;
  return { ...pub };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function getWaNameSyncJob(jobId: string, tenantId: string): WaNameSyncJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  return publicJob(job);
}

export function listActiveWaNameSyncJobs(tenantId: string): WaNameSyncJobPublic[] {
  return [...jobs.values()]
    .filter((j) => j.tenantId === tenantId && j.status === 'running')
    .map(publicJob);
}

export function cancelWaNameSyncJob(jobId: string, tenantId: string): WaNameSyncJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'running') {
    job.status = 'cancelled';
    job.message = 'Sincronização de nomes cancelada.';
    job.updatedAt = Date.now();
    job.finishedAt = Date.now();
  }
  return publicJob(job);
}

export async function startWaNameSyncJob(opts: {
  tenantId: string;
  mode: 'ids' | 'suspicious';
  ids?: string[];
  connectionId?: string;
}): Promise<WaNameSyncJobPublic> {
  const active = listActiveWaNameSyncJobs(opts.tenantId);
  if (active.length > 0) {
    throw new Error('Já existe uma sincronização de nomes do WhatsApp em curso. Aguarde ou cancele.');
  }

  const mode = opts.mode === 'ids' ? 'ids' : 'suspicious';
  const ids =
    mode === 'ids'
      ? [...new Set((opts.ids || []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 5000)
      : null;

  if (mode === 'ids' && (!ids || ids.length === 0)) {
    throw new Error('Selecione ao menos um contato.');
  }

  let total = 0;
  if (mode === 'ids' && ids) {
    total = ids.length;
  } else {
    // Contagem aproximada: total da base; o loop só processa suspeitos.
    total = await countContacts(opts.tenantId);
  }
  if (total <= 0) throw new Error('Nenhum contato para sincronizar.');

  const connId =
    opts.connectionId ||
    evolutionService.pickOpenConnectionForTenant(opts.tenantId) ||
    undefined;
  if (!connId) {
    throw new Error('Nenhum canal WhatsApp conectado. Conecte um chip para puxar nomes.');
  }

  const job: WaNameSyncJob = {
    id: randomUUID(),
    tenantId: opts.tenantId,
    connectionId: connId,
    mode,
    ids,
    afterId: null,
    phonebookIndex: null,
    status: 'running',
    total,
    scanned: 0,
    updated: 0,
    skipped: 0,
    unavailable: 0,
    failed: 0,
    percent: 0,
    message: 'A carregar agenda do chip…',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  void processLoop(job.id);
  return publicJob(job);
}

async function processLoop(jobId: string): Promise<void> {
  if (runningLoops.get(jobId)) return;
  runningLoops.set(jobId, true);
  const job = jobs.get(jobId);
  if (!job) {
    runningLoops.set(jobId, false);
    return;
  }

  try {
    job.message = 'A carregar agenda do chip…';
    job.updatedAt = Date.now();
    try {
      job.phonebookIndex = await evolutionService.loadPhonebookNameIndexForConnection(
        job.connectionId || ''
      );
    } catch {
      job.phonebookIndex = null;
    }

    job.message = 'A sincronizar nomes com o WhatsApp…';
    job.updatedAt = Date.now();

    if (job.mode === 'ids' && job.ids) {
      for (let i = 0; i < job.ids.length; i++) {
        if (job.status !== 'running') break;
        const id = job.ids[i];
        const result = await syncContactWaName(job.tenantId, id, {
          connectionId: job.connectionId,
          phonebookIndex: job.phonebookIndex,
          onlyIfSuspicious: true,
        });
        job.scanned += 1;
        if (result.status === 'updated') job.updated += 1;
        else if (result.status === 'skipped') job.skipped += 1;
        else if (result.status === 'unavailable') job.unavailable += 1;
        else job.failed += 1;
        job.percent = Math.min(100, Math.round((job.scanned / Math.max(job.total, 1)) * 100));
        job.message = `Sincronizando ${job.scanned}/${job.total}…`;
        job.updatedAt = Date.now();
        await sleep(THROTTLE_MS);
      }
    } else {
      let suspiciousBudget = 0;
      // Recalcula total como contagem de suspeitos vistos (atualiza progressivamente).
      let afterId: string | null = null;
      let pages = 0;
      while (job.status === 'running' && pages < 5000) {
        pages += 1;
        const page = await listContactsAfterId(job.tenantId, {
          afterId,
          limit: PAGE_SIZE,
        });
        if (page.length === 0) break;
        for (const c of page) {
          if (job.status !== 'running') break;
          afterId = c.id;
          job.scanned += 1;
          if (!isSuspiciousContactName(c.name || '')) {
            job.skipped += 1;
          } else {
            suspiciousBudget += 1;
            const result = await syncContactWaName(job.tenantId, c.id, {
              connectionId: job.connectionId,
              phonebookIndex: job.phonebookIndex,
              onlyIfSuspicious: true,
            });
            if (result.status === 'updated') job.updated += 1;
            else if (result.status === 'skipped') job.skipped += 1;
            else if (result.status === 'unavailable') job.unavailable += 1;
            else job.failed += 1;
            await sleep(THROTTLE_MS);
          }
          job.percent = Math.min(100, Math.round((job.scanned / Math.max(job.total, 1)) * 100));
          job.message = `Varrendo base ${job.scanned}/${job.total} · ${job.updated} atualizados · ${suspiciousBudget} suspeitos`;
          job.updatedAt = Date.now();
        }
        if (page.length < PAGE_SIZE) break;
      }
    }

    if (job.status === 'running') {
      job.status = 'done';
      job.percent = 100;
      job.message = `Concluído: ${job.updated} atualizados, ${job.unavailable} sem nome no WA, ${job.skipped} ignorados.`;
      job.finishedAt = Date.now();
      job.updatedAt = Date.now();
      if (job.updated > 0) {
        invalidateCrmContactIndexCache(job.tenantId);
        invalidateContactsCountCache(job.tenantId);
      }
    }
  } catch (e) {
    job.status = 'error';
    job.lastError = e instanceof Error ? e.message : 'Erro na sincronização.';
    job.message = 'Falha na sincronização de nomes.';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
  } finally {
    runningLoops.set(jobId, false);
  }
}

/** Utilitário de teste / preview: contato ainda existe? */
export async function peekContactExists(tenantId: string, id: string): Promise<boolean> {
  const c = await getContactById(tenantId, id);
  return Boolean(c);
}
