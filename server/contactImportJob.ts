import { randomUUID } from 'crypto';
import type { Contact } from '../src/types.js';
import { normalizeBRPhone, normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import {
  bulkCreateContacts,
  findContactIdsByPhoneKeys
} from './repositories/contactsRepository.js';
import {
  appendContactIdsToContactList,
  createContactList
} from './repositories/contactListsRepository.js';
import { invalidateCrmContactIndexCache } from './crmContactIndexCache.js';
import { invalidateContactsCountCache } from './repositories/contactsRepository.js';
import { runAddressNormalizationBatch } from './addressNormalizationJob.js';

export type ContactImportJobStatus =
  | 'staging'
  | 'running'
  | 'paused'
  | 'done'
  | 'cancelled'
  | 'error';

export type ContactImportTargetMode = 'none' | 'new' | 'existing';

/** Linha compacta enviada pelo browser após o preview/autofix. */
export type ContactImportJobRow = {
  /** upsert = criar/atualizar; link = só vincular à lista (já na base). */
  mode: 'upsert' | 'link';
  phone: string;
  name?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  street?: string;
  zipCode?: string;
  number?: string;
  tags?: string[];
  email?: string;
  notes?: string;
};

export type ContactImportJobPublic = {
  id: string;
  status: ContactImportJobStatus;
  label: string;
  total: number;
  staged: number;
  processed: number;
  upserted: number;
  linked: number;
  failed: number;
  listAttached: number;
  listId?: string;
  listName?: string;
  percent: number;
  phase: 'upload' | 'import' | 'list' | 'done' | 'error';
  message: string;
  lastError?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
};

type ContactImportJob = ContactImportJobPublic & {
  tenantId: string;
  rows: ContactImportJobRow[];
  touchedIds: string[];
  targetMode: ContactImportTargetMode;
  targetListId: string;
  newListName: string;
  originLabel: string;
};

const jobs = new Map<string, ContactImportJob>();
const runningLoops = new Map<string, boolean>();

const PROCESS_CHUNK = 500;
const MAX_ROWS = 80_000;
const MAX_STAGING_CHUNK = 2_000;

function publicJob(job: ContactImportJob): ContactImportJobPublic {
  const {
    tenantId: _t,
    rows: _r,
    touchedIds: _i,
    targetMode: _tm,
    targetListId: _tl,
    newListName: _nl,
    originLabel: _o,
    ...pub
  } = job;
  return { ...pub };
}

export function getContactImportJob(jobId: string, tenantId: string): ContactImportJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  return publicJob(job);
}

export function listActiveContactImportJobs(tenantId: string): ContactImportJobPublic[] {
  const now = Date.now();
  for (const j of jobs.values()) {
    if (j.tenantId !== tenantId) continue;
    // Staging abandonado (aba fechada a meio do upload) — libera para nova importação.
    if (j.status === 'staging' && now - j.updatedAt > 8 * 60 * 1000) {
      j.status = 'cancelled';
      j.phase = 'error';
      j.message = 'Upload interrompido (tempo esgotado).';
      j.finishedAt = now;
      j.updatedAt = now;
    }
  }
  return [...jobs.values()]
    .filter(
      (j) =>
        j.tenantId === tenantId &&
        (j.status === 'staging' || j.status === 'running' || j.status === 'paused')
    )
    .map(publicJob);
}

export function createContactImportJob(opts: {
  tenantId: string;
  label: string;
  total: number;
  targetMode: ContactImportTargetMode;
  targetListId?: string;
  newListName?: string;
  originLabel?: string;
}): ContactImportJobPublic {
  const active = listActiveContactImportJobs(opts.tenantId);
  if (active.length > 0) {
    throw new Error('Já existe uma importação em curso. Aguarde terminar ou cancele.');
  }
  const total = Math.max(0, Math.min(MAX_ROWS, Math.floor(Number(opts.total) || 0)));
  if (total <= 0) throw new Error('Nada para importar.');

  const job: ContactImportJob = {
    id: randomUUID(),
    tenantId: opts.tenantId,
    status: 'staging',
    label: (opts.label || 'Importação').slice(0, 200),
    total,
    staged: 0,
    processed: 0,
    upserted: 0,
    linked: 0,
    failed: 0,
    listAttached: 0,
    percent: 0,
    phase: 'upload',
    message: 'A receber linhas do ficheiro…',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    rows: [],
    touchedIds: [],
    targetMode: opts.targetMode || 'none',
    targetListId: String(opts.targetListId || ''),
    newListName: String(opts.newListName || '').trim(),
    originLabel: opts.originLabel || 'importação de arquivo'
  };
  jobs.set(job.id, job);
  return publicJob(job);
}

export function appendContactImportJobRows(
  jobId: string,
  tenantId: string,
  rows: ContactImportJobRow[]
): ContactImportJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status !== 'staging') {
    throw new Error('Só é possível enviar linhas enquanto a importação está em preparação.');
  }
  if (!Array.isArray(rows) || rows.length === 0) return publicJob(job);
  if (rows.length > MAX_STAGING_CHUNK) {
    throw new Error(`Máximo ${MAX_STAGING_CHUNK} linhas por envio.`);
  }
  if (job.rows.length + rows.length > MAX_ROWS) {
    throw new Error(`Limite de ${MAX_ROWS} linhas por importação.`);
  }

  for (const raw of rows) {
    const phone = normalizeBRPhone(String(raw.phone || '')) || String(raw.phone || '').trim();
    if (!phone) {
      job.failed += 1;
      continue;
    }
    const mode = raw.mode === 'link' ? 'link' : 'upsert';
    job.rows.push({
      mode,
      phone,
      name: raw.name,
      city: raw.city,
      state: raw.state,
      neighborhood: raw.neighborhood,
      street: raw.street,
      zipCode: raw.zipCode,
      number: raw.number,
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 20) : undefined,
      email: raw.email,
      notes: raw.notes
    });
  }
  job.staged = job.rows.length;
  job.total = Math.max(job.total, job.staged);
  job.percent = Math.min(5, Math.round((job.staged / Math.max(1, job.total)) * 5));
  job.message = `Recebidas ${job.staged} de ${job.total} linhas…`;
  job.updatedAt = Date.now();
  return publicJob(job);
}

export function startContactImportJob(jobId: string, tenantId: string): ContactImportJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status !== 'staging' && job.status !== 'paused') {
    throw new Error('Importação não está pronta para iniciar.');
  }
  if (job.rows.length === 0) throw new Error('Nenhuma linha válida para importar.');
  job.status = 'running';
  job.phase = 'import';
  job.total = job.rows.length;
  job.message = 'A importar no servidor — pode fechar a aba.';
  job.updatedAt = Date.now();
  void processLoop(job.id);
  return publicJob(job);
}

export function pauseContactImportJob(jobId: string, tenantId: string): ContactImportJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'running') {
    job.status = 'paused';
    job.message = 'Importação pausada.';
    job.updatedAt = Date.now();
  }
  return publicJob(job);
}

export function resumeContactImportJob(jobId: string, tenantId: string): ContactImportJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'paused') {
    job.status = 'running';
    job.message = 'A retomar importação…';
    job.updatedAt = Date.now();
    void processLoop(job.id);
  }
  return publicJob(job);
}

export function cancelContactImportJob(jobId: string, tenantId: string): ContactImportJobPublic | null {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return null;
  if (job.status === 'running' || job.status === 'paused' || job.status === 'staging') {
    job.status = 'cancelled';
    job.phase = 'error';
    job.message = 'Importação cancelada.';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
  }
  return publicJob(job);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function processLoop(jobId: string): Promise<void> {
  if (runningLoops.get(jobId)) return;
  runningLoops.set(jobId, true);
  try {
    while (true) {
      const job = jobs.get(jobId);
      if (!job) return;
      if (job.status !== 'running') return;

      if (job.processed >= job.rows.length) {
        await finishListPhase(job);
        return;
      }

      const slice = job.rows.slice(job.processed, job.processed + PROCESS_CHUNK);
      const upserts: Partial<Contact>[] = [];
      const linkKeys: string[] = [];

      for (const row of slice) {
        const key = normPhoneKey(row.phone);
        if (!key) {
          job.failed += 1;
          continue;
        }
        if (row.mode === 'link') {
          linkKeys.push(key);
          continue;
        }
        upserts.push({
          name: (row.name || '').trim() || 'Sem Nome',
          phone: row.phone,
          city: row.city,
          state: row.state,
          neighborhood: row.neighborhood,
          street: row.street,
          zipCode: row.zipCode,
          number: row.number,
          email: row.email,
          notes: row.notes,
          tags: row.tags?.length ? row.tags : ['Importado'],
          status: String(row.phone).replace(/\D/g, '').length >= 10 ? 'VALID' : 'INVALID'
        });
      }

      if (upserts.length > 0) {
        const ids = await bulkCreateContacts(job.tenantId, upserts);
        for (const id of ids) {
          if (id) job.touchedIds.push(id);
        }
        job.upserted += ids.length;
      }

      if (linkKeys.length > 0) {
        const found = await findContactIdsByPhoneKeys(job.tenantId, linkKeys);
        for (const id of found.values()) {
          job.touchedIds.push(id);
          job.linked += 1;
        }
      }

      job.processed += slice.length;
      const pct = Math.min(95, Math.round((100 * job.processed) / Math.max(1, job.rows.length)));
      job.percent = pct;
      job.phase = 'import';
      job.message = `A importar contatos (${job.processed} de ${job.rows.length})…`;
      job.updatedAt = Date.now();

      // Pequena pausa para não saturar o Postgres em bases enormes.
      await sleep(15);
    }
  } catch (e) {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.phase = 'error';
      job.lastError = e instanceof Error ? e.message : String(e);
      job.message = 'Erro na importação';
      job.finishedAt = Date.now();
      job.updatedAt = Date.now();
    }
  } finally {
    runningLoops.delete(jobId);
  }
}

async function finishListPhase(job: ContactImportJob): Promise<void> {
  if (job.status !== 'running') return;

  const uniqIds = [...new Set(job.touchedIds.filter(Boolean))];
  invalidateCrmContactIndexCache(job.tenantId);
  invalidateContactsCountCache(job.tenantId);

  if (job.targetMode === 'none' || (uniqIds.length === 0 && job.targetMode !== 'new')) {
    job.status = 'done';
    job.phase = 'done';
    job.percent = 100;
    job.message = 'Importação concluída.';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
    void runAddressNormalizationBatch(job.tenantId, 200).catch(() => undefined);
    return;
  }

  job.phase = 'list';
  job.percent = 97;
  job.message = `A gravar lista (${uniqIds.length} contato(s))…`;
  job.updatedAt = Date.now();

  try {
    if (job.targetMode === 'existing' && job.targetListId) {
      const result = await appendContactIdsToContactList(job.tenantId, job.targetListId, uniqIds, {
        notesLine: `Atualizada por ${job.originLabel} em ${new Date().toLocaleString('pt-BR')}`
      });
      job.listId = job.targetListId;
      job.listName = result?.list.name;
      job.listAttached = result?.added ?? uniqIds.length;
    } else if (job.targetMode === 'new') {
      const listName = job.newListName.trim() || job.label || 'Importação';
      const created = await createContactList(job.tenantId, {
        name: listName,
        contactIds: uniqIds,
        description: `Lista criada por ${job.originLabel} com ${uniqIds.length} contato(s).`
      });
      job.listId = created.id;
      job.listName = created.name;
      job.listAttached = uniqIds.length;
    }

    job.status = 'done';
    job.phase = 'done';
    job.percent = 100;
    job.message = job.listName
      ? `Concluído — lista "${job.listName}" com ${job.listAttached} contato(s).`
      : 'Importação concluída.';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
    void runAddressNormalizationBatch(job.tenantId, 200).catch(() => undefined);
  } catch (e) {
    job.status = 'error';
    job.phase = 'error';
    job.lastError = e instanceof Error ? e.message : String(e);
    job.message = 'Contatos gravados, mas falhou ao atualizar a lista.';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
  }
}
