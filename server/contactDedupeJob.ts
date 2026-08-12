import { randomUUID } from 'crypto';
import type { Contact } from '../src/types.js';
import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { mergeDuplicateGroup, remapListContactIds } from '../src/utils/contactDedupe.js';
import { invalidateCrmContactIndexCache } from './crmContactIndexCache.js';
import {
  bulkDeleteContacts,
  bulkUpdateContacts,
  countContacts,
  invalidateContactsCountCache,
  listContactsAfterId,
  neutralizeContactPhoneKeys
} from './repositories/contactsRepository.js';
import { listContactLists, updateContactList } from './repositories/contactListsRepository.js';

export type ContactDedupeJobStatus = 'running' | 'done' | 'cancelled' | 'error';

export type ContactDedupeJobPublic = {
  id: string;
  status: ContactDedupeJobStatus;
  total: number;
  scanned: number;
  groups: number;
  merged: number;
  deleted: number;
  listsUpdated: number;
  percent: number;
  message: string;
  lastError?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
};

type ContactDedupeJob = ContactDedupeJobPublic & {
  tenantId: string;
};

const jobs = new Map<string, ContactDedupeJob>();
const runningLoops = new Map<string, boolean>();

const PAGE_SIZE = 500;
const UPDATE_CHUNK = 80;
const DELETE_CHUNK = 200;

function publicJob(job: ContactDedupeJob): ContactDedupeJobPublic {
  const { tenantId: _t, ...pub } = job;
  return { ...pub };
}

export function getContactDedupeJob(jobId: string, tenantId: string): ContactDedupeJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  return publicJob(job);
}

export function listActiveContactDedupeJobs(tenantId: string): ContactDedupeJobPublic[] {
  return [...jobs.values()]
    .filter((j) => j.tenantId === tenantId && j.status === 'running')
    .map(publicJob);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stillRunning(jobId: string): ContactDedupeJob | null {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') return null;
  return job;
}

export async function startContactDedupeJob(opts: { tenantId: string }): Promise<ContactDedupeJobPublic> {
  const active = listActiveContactDedupeJobs(opts.tenantId);
  if (active.length > 0) {
    throw new Error('Já existe uma união de duplicados em curso. Aguarde ou cancele.');
  }

  const total = await countContacts(opts.tenantId);
  if (total <= 0) throw new Error('Nenhum contato na base.');

  const job: ContactDedupeJob = {
    id: randomUUID(),
    tenantId: opts.tenantId,
    status: 'running',
    total,
    scanned: 0,
    groups: 0,
    merged: 0,
    deleted: 0,
    listsUpdated: 0,
    percent: 0,
    message: 'A varrer a base no servidor — o mesmo número continua nas listas.',
    startedAt: Date.now(),
    updatedAt: Date.now()
  };
  jobs.set(job.id, job);
  void processLoop(job.id);
  return publicJob(job);
}

export function cancelContactDedupeJob(jobId: string, tenantId: string): ContactDedupeJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'running') {
    job.status = 'cancelled';
    job.message = 'União de duplicados cancelada.';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
  }
  return publicJob(job);
}

async function processLoop(jobId: string): Promise<void> {
  if (runningLoops.get(jobId)) return;
  runningLoops.set(jobId, true);
  try {
    const start = jobs.get(jobId);
    if (!start || start.status !== 'running') return;

    const groups = new Map<string, Contact[]>();
    let afterId: string | null = null;
    while (true) {
      const job = stillRunning(jobId);
      if (!job) return;
      const page = await listContactsAfterId(job.tenantId, { afterId, limit: PAGE_SIZE });
      if (page.length === 0) break;
      for (const c of page) {
        const key = normPhoneKey(c.phone);
        if (!key || key.length < 10) continue;
        const list = groups.get(key);
        if (list) list.push(c);
        else groups.set(key, [c]);
      }
      afterId = page[page.length - 1]!.id;
      job.scanned += page.length;
      job.percent = Math.min(35, Math.round((35 * job.scanned) / Math.max(1, job.total)));
      job.message = `A localizar números repetidos (${job.scanned.toLocaleString('pt-BR')} de ${job.total.toLocaleString('pt-BR')})…`;
      job.updatedAt = Date.now();
      await sleep(15);
    }

    const jobAfterScan = stillRunning(jobId);
    if (!jobAfterScan) return;

    const dupGroups: Array<{ key: string; contacts: Contact[] }> = [];
    for (const [key, contacts] of groups) {
      if (contacts.length > 1) dupGroups.push({ key, contacts });
    }
    jobAfterScan.groups = dupGroups.length;
    if (dupGroups.length === 0) {
      jobAfterScan.status = 'done';
      jobAfterScan.percent = 100;
      jobAfterScan.message = 'Concluído — nenhum número duplicado na base.';
      jobAfterScan.finishedAt = Date.now();
      jobAfterScan.updatedAt = Date.now();
      return;
    }

    jobAfterScan.message = `Encontrados ${dupGroups.length.toLocaleString('pt-BR')} número(s) com mais de uma linha. A unir…`;
    jobAfterScan.percent = 40;
    jobAfterScan.updatedAt = Date.now();

    const idMap = new Map<string, string>();
    const extraIds: string[] = [];
    const keeperUpdates: Array<{ id: string; updates: Partial<Contact> }> = [];

    for (const g of dupGroups) {
      const { keeper, extraIds: extras, updates } = mergeDuplicateGroup(g.contacts, g.key);
      for (const id of extras) idMap.set(id, keeper.id);
      extraIds.push(...extras);
      keeperUpdates.push({ id: keeper.id, updates });
    }

    const listsJob = stillRunning(jobId);
    if (!listsJob) return;
    listsJob.message = 'A atualizar listas (o número permanece em cada lista)…';
    listsJob.percent = 48;
    listsJob.updatedAt = Date.now();

    const lists = await listContactLists(listsJob.tenantId);
    for (const list of lists) {
      const current = stillRunning(jobId);
      if (!current) return;
      const remapped = remapListContactIds(list.contactIds || [], idMap);
      if (!remapped.changed) continue;
      await updateContactList(current.tenantId, list.id, { contactIds: remapped.ids });
      current.listsUpdated += 1;
      current.updatedAt = Date.now();
    }

    const neutJob = stillRunning(jobId);
    if (!neutJob) return;
    neutJob.message = 'A liberar chaves de telefone duplicadas…';
    neutJob.percent = 58;
    neutJob.updatedAt = Date.now();
    for (let i = 0; i < extraIds.length; i += DELETE_CHUNK) {
      const current = stillRunning(jobId);
      if (!current) return;
      await neutralizeContactPhoneKeys(current.tenantId, extraIds.slice(i, i + DELETE_CHUNK));
      await sleep(10);
    }

    const updJob = stillRunning(jobId);
    if (!updJob) return;
    updJob.message = 'A gravar o cadastro único de cada número…';
    updJob.percent = 70;
    updJob.updatedAt = Date.now();
    for (let i = 0; i < keeperUpdates.length; i += UPDATE_CHUNK) {
      const current = stillRunning(jobId);
      if (!current) return;
      const slice = keeperUpdates.slice(i, i + UPDATE_CHUNK);
      await bulkUpdateContacts(current.tenantId, slice);
      current.merged += slice.length;
      current.percent = Math.min(
        88,
        70 + Math.round((18 * current.merged) / Math.max(1, keeperUpdates.length))
      );
      current.message = `A unir cadastros (${current.merged.toLocaleString('pt-BR')} de ${keeperUpdates.length.toLocaleString('pt-BR')})…`;
      current.updatedAt = Date.now();
      await sleep(15);
    }

    const delJob = stillRunning(jobId);
    if (!delJob) return;
    delJob.message = 'A remover linhas extras da base…';
    delJob.percent = 90;
    delJob.updatedAt = Date.now();
    let deleted = 0;
    for (let i = 0; i < extraIds.length; i += DELETE_CHUNK) {
      const current = stillRunning(jobId);
      if (!current) return;
      deleted += await bulkDeleteContacts(current.tenantId, extraIds.slice(i, i + DELETE_CHUNK));
      current.deleted = deleted;
      current.percent = Math.min(
        99,
        90 + Math.round((9 * deleted) / Math.max(1, extraIds.length))
      );
      current.updatedAt = Date.now();
      await sleep(10);
    }

    const done = stillRunning(jobId);
    if (!done) return;
    done.status = 'done';
    done.percent = 100;
    done.deleted = deleted;
    done.message = `Concluído — ${deleted.toLocaleString('pt-BR')} linha(s) extra(s) removida(s), ${done.merged.toLocaleString('pt-BR')} número(s) únicos. Listas mantidas.`;
    done.finishedAt = Date.now();
    done.updatedAt = Date.now();
    invalidateCrmContactIndexCache(done.tenantId);
    invalidateContactsCountCache(done.tenantId);
  } catch (e) {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.lastError = e instanceof Error ? e.message : String(e);
      job.message = 'Erro ao unir duplicados na base';
      job.finishedAt = Date.now();
      job.updatedAt = Date.now();
    }
    console.error('[contactDedupeJob]', e);
  } finally {
    runningLoops.delete(jobId);
  }
}
