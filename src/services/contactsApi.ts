import type { Contact, ContactList } from '../types';
import { apiFetchJson } from '../utils/apiFetchAuth';

/** Bases grandes (40k+) podem levar >30s por página — evita falso "sem conexão". */
const CONTACTS_API_TIMEOUT_MS = 120_000;
/** Lotes de import / append de lista — nunca usar o default de 18s. */
const CONTACTS_MUTATION_TIMEOUT_MS = 120_000;
const LISTS_API_TIMEOUT_MS = 60_000;

export async function fetchContacts(opts?: {
  limit?: number;
  offset?: number;
  /** Evita COUNT(*) repetido em páginas seguintes (mais rápido). */
  skipCount?: boolean;
}): Promise<{ contacts: Contact[]; total?: number; hasMore: boolean }> {
  const q = new URLSearchParams();
  if (opts?.limit) q.set('limit', String(opts.limit));
  if (opts?.offset) q.set('offset', String(opts.offset));
  if (opts?.skipCount) q.set('skipCount', '1');
  const path = q.toString() ? `/api/contacts?${q}` : '/api/contacts';
  const j = await apiFetchJson<{
    contacts?: Contact[];
    total?: number;
    hasMore?: boolean;
  }>(path, { timeoutMs: CONTACTS_API_TIMEOUT_MS });
  return {
    contacts: Array.isArray(j.contacts) ? j.contacts : [],
    total: j.total != null ? Number(j.total) : undefined,
    hasMore: !!j.hasMore
  };
}

export async function fetchContactsCount(): Promise<number> {
  const j = await apiFetchJson<{ total?: number }>('/api/contacts/count', {
    timeoutMs: CONTACTS_API_TIMEOUT_MS
  });
  return Number(j.total) || 0;
}

export async function apiCreateContact(contact: Partial<Contact>): Promise<string> {
  const j = await apiFetchJson<{ id?: string; contact?: Contact }>('/api/contacts', {
    method: 'POST',
    body: JSON.stringify(contact)
  });
  return String(j.id || j.contact?.id || '');
}

export async function apiBulkCreateContacts(contacts: Partial<Contact>[]): Promise<string[]> {
  const j = await apiFetchJson<{ ids?: string[] }>('/api/contacts/bulk', {
    method: 'POST',
    body: JSON.stringify({ contacts }),
    timeoutMs: CONTACTS_MUTATION_TIMEOUT_MS,
    retries: 2,
  });
  return Array.isArray(j.ids) ? j.ids : [];
}

export async function apiFetchContactProfilePicture(
  id: string,
  opts?: { connectionId?: string; force?: boolean }
): Promise<string | null> {
  const j = await apiFetchJson<{ profilePicUrl?: string | null }>(
    `/api/contacts/${encodeURIComponent(id)}/profile-picture`,
    {
      method: 'POST',
      body: JSON.stringify(opts || {})
    }
  );
  return j.profilePicUrl ?? null;
}

export async function apiFetchContactProfilePicturesBatch(
  ids: string[],
  connectionId?: string
): Promise<Array<{ id: string; profilePicUrl: string | null }>> {
  const j = await apiFetchJson<{ results?: Array<{ id: string; profilePicUrl: string | null }> }>(
    '/api/contacts/profile-pictures-batch',
    {
      method: 'POST',
      body: JSON.stringify({ ids, connectionId })
    }
  );
  return Array.isArray(j.results) ? j.results : [];
}

export type SaveToChipAction = 'added' | 'updated';

export async function apiSaveContactToChip(
  id: string,
  connectionId: string
): Promise<{
  ok: boolean;
  action?: SaveToChipAction;
  number?: string;
  name?: string;
  error?: string;
  connectionId?: string;
}> {
  return apiFetchJson(`/api/contacts/${encodeURIComponent(id)}/save-to-chip`, {
    method: 'POST',
    body: JSON.stringify({ connectionId }),
    timeoutMs: 45_000
  });
}

export async function apiSaveContactsToChipBatch(
  ids: string[],
  connectionId: string
): Promise<{
  ok: boolean;
  connectionId?: string;
  results?: Array<{
    id: string;
    ok: boolean;
    action?: SaveToChipAction;
    error?: string;
  }>;
  summary?: { ok: number; failed: number; added: number; updated: number };
  error?: string;
}> {
  return apiFetchJson('/api/contacts/save-to-chip-batch', {
    method: 'POST',
    body: JSON.stringify({ ids, connectionId }),
    timeoutMs: 180_000
  });
}

export type ChipBaseSyncJob = {
  id: string;
  connectionId: string;
  status: 'running' | 'paused' | 'done' | 'cancelled' | 'error';
  totalEstimated: number;
  processed: number;
  added: number;
  updated: number;
  failed: number;
  skipped: number;
  delayMs: number;
  lastError?: string;
  recentErrors?: Array<{ id: string; error: string }>;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
};

export async function apiStartSaveToChipBase(opts: {
  connectionId: string;
  delayMs?: number;
}): Promise<{ job: ChipBaseSyncJob }> {
  return apiFetchJson('/api/contacts/save-to-chip-base', {
    method: 'POST',
    body: JSON.stringify(opts),
    timeoutMs: 30_000
  });
}

export async function apiGetSaveToChipBaseJob(jobId: string): Promise<{ job: ChipBaseSyncJob }> {
  return apiFetchJson(`/api/contacts/save-to-chip-base/${encodeURIComponent(jobId)}`, {
    timeoutMs: 15_000
  });
}

export async function apiListActiveSaveToChipBase(): Promise<{ jobs: ChipBaseSyncJob[] }> {
  return apiFetchJson('/api/contacts/save-to-chip-base/active', { timeoutMs: 15_000 });
}

export async function apiPauseSaveToChipBase(jobId: string): Promise<{ job: ChipBaseSyncJob }> {
  return apiFetchJson(`/api/contacts/save-to-chip-base/${encodeURIComponent(jobId)}/pause`, {
    method: 'POST'
  });
}

export async function apiResumeSaveToChipBase(jobId: string): Promise<{ job: ChipBaseSyncJob }> {
  return apiFetchJson(`/api/contacts/save-to-chip-base/${encodeURIComponent(jobId)}/resume`, {
    method: 'POST'
  });
}

export async function apiCancelSaveToChipBase(jobId: string): Promise<{ job: ChipBaseSyncJob }> {
  return apiFetchJson(`/api/contacts/save-to-chip-base/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST'
  });
}

export async function apiUpdateContact(id: string, updates: Partial<Contact>): Promise<void> {
  await apiFetchJson(`/api/contacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
}

export async function apiBulkUpdateContacts(
  items: Array<{ id: string; updates: Partial<Contact> }>
): Promise<void> {
  await apiFetchJson('/api/contacts/bulk-update', {
    method: 'POST',
    body: JSON.stringify({ items }),
    timeoutMs: CONTACTS_MUTATION_TIMEOUT_MS,
    retries: 2,
  });
}

export async function apiNormalizeContactsAll(opts?: {
  offset?: number;
  limit?: number;
  dryRun?: boolean;
}): Promise<{
  scanned: number;
  changed: number;
  fieldTotals: Record<string, number>;
  samples: Array<{ field: string; before: string; after: string }>;
  hasMore: boolean;
  nextOffset: number;
  applied: boolean;
}> {
  const j = await apiFetchJson<{
    scanned?: number;
    changed?: number;
    fieldTotals?: Record<string, number>;
    samples?: Array<{ field: string; before: string; after: string }>;
    hasMore?: boolean;
    nextOffset?: number;
    applied?: boolean;
  }>('/api/contacts/normalize-all', {
    method: 'POST',
    body: JSON.stringify({
      offset: opts?.offset ?? 0,
      limit: opts?.limit ?? 2000,
      dryRun: opts?.dryRun !== false,
    }),
    timeoutMs: CONTACTS_API_TIMEOUT_MS,
  });
  return {
    scanned: Number(j.scanned) || 0,
    changed: Number(j.changed) || 0,
    fieldTotals: j.fieldTotals && typeof j.fieldTotals === 'object' ? j.fieldTotals : {},
    samples: Array.isArray(j.samples) ? j.samples : [],
    hasMore: !!j.hasMore,
    nextOffset: Number(j.nextOffset) || 0,
    applied: !!j.applied,
  };
}

export async function apiNormalizeContactAddresses(opts?: {
  offset?: number;
  limit?: number;
}): Promise<{
  scanned: number;
  updated: number;
  samples: Array<{ from: string; to: string }>;
  hasMore: boolean;
  nextOffset: number;
}> {
  const j = await apiFetchJson<{
    scanned?: number;
    updated?: number;
    samples?: Array<{ from: string; to: string }>;
    hasMore?: boolean;
    nextOffset?: number;
  }>('/api/contacts/normalize-addresses', {
    method: 'POST',
    body: JSON.stringify({
      offset: opts?.offset ?? 0,
      limit: opts?.limit ?? 5000
    })
  });
  return {
    scanned: Number(j.scanned) || 0,
    updated: Number(j.updated) || 0,
    samples: Array.isArray(j.samples) ? j.samples : [],
    hasMore: !!j.hasMore,
    nextOffset: Number(j.nextOffset) || 0
  };
}

export async function apiDeleteContact(id: string): Promise<void> {
  await apiFetchJson(`/api/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchContactLists(): Promise<ContactList[]> {
  const j = await apiFetchJson<{ lists?: ContactList[] }>('/api/contact-lists', {
    timeoutMs: LISTS_API_TIMEOUT_MS,
    retries: 0,
  });
  return Array.isArray(j.lists) ? j.lists : [];
}

export async function apiCreateContactList(input: Partial<ContactList>): Promise<string> {
  const j = await apiFetchJson<{ id?: string; list?: ContactList }>('/api/contact-lists', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: CONTACTS_MUTATION_TIMEOUT_MS,
    retries: 2,
  });
  return String(j.id || j.list?.id || '');
}

export async function apiUpdateContactList(id: string, updates: Partial<ContactList>): Promise<void> {
  await apiFetchJson(`/api/contact-lists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
    timeoutMs: CONTACTS_MUTATION_TIMEOUT_MS,
    retries: 2,
  });
}

export async function apiAppendContactIdsToList(
  id: string,
  contactIds: string[],
  opts?: { notesLine?: string }
): Promise<{ added: number; list: ContactList }> {
  const j = await apiFetchJson<{ added?: number; list?: ContactList }>(
    `/api/contact-lists/${encodeURIComponent(id)}/append`,
    {
      method: 'POST',
      body: JSON.stringify({ contactIds, notesLine: opts?.notesLine }),
      timeoutMs: CONTACTS_MUTATION_TIMEOUT_MS,
      retries: 2,
    }
  );
  return { added: Number(j.added) || 0, list: j.list as ContactList };
}

export async function apiDeleteContactList(id: string): Promise<void> {
  await apiFetchJson(`/api/contact-lists/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiClearTenantContactsData(): Promise<{ contacts: number; contactLists: number }> {
  const j = await apiFetchJson<{ contacts?: number; contactLists?: number }>(
    '/api/tenant/contacts-data',
    { method: 'DELETE' }
  );
  return {
    contacts: Number(j.contacts) || 0,
    contactLists: Number(j.contactLists) || 0
  };
}

export type ContactImportJobDto = {
  id: string;
  status: string;
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
  phase: string;
  message: string;
  lastError?: string;
};

export type ContactImportJobRowDto = {
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

export async function apiCreateContactImportJob(input: {
  label: string;
  total: number;
  targetMode: 'none' | 'new' | 'existing';
  targetListId?: string;
  newListName?: string;
  originLabel?: string;
}): Promise<ContactImportJobDto> {
  const j = await apiFetchJson<{ job?: ContactImportJobDto }>('/api/contacts/import-jobs', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: CONTACTS_MUTATION_TIMEOUT_MS,
    retries: 1,
  });
  if (!j.job?.id) throw new Error('Não foi possível criar a importação no servidor.');
  return j.job;
}

export async function apiAppendContactImportJobRows(
  jobId: string,
  rows: ContactImportJobRowDto[]
): Promise<ContactImportJobDto> {
  const j = await apiFetchJson<{ job?: ContactImportJobDto }>(
    `/api/contacts/import-jobs/${encodeURIComponent(jobId)}/rows`,
    {
      method: 'POST',
      body: JSON.stringify({ rows }),
      timeoutMs: CONTACTS_MUTATION_TIMEOUT_MS,
      retries: 2,
    }
  );
  if (!j.job) throw new Error('Falha ao enviar linhas da importação.');
  return j.job;
}

export async function apiStartContactImportJob(jobId: string): Promise<ContactImportJobDto> {
  const j = await apiFetchJson<{ job?: ContactImportJobDto }>(
    `/api/contacts/import-jobs/${encodeURIComponent(jobId)}/start`,
    { method: 'POST', timeoutMs: 30_000, retries: 1 }
  );
  if (!j.job) throw new Error('Falha ao iniciar importação no servidor.');
  return j.job;
}

export async function apiGetContactImportJob(jobId: string): Promise<ContactImportJobDto> {
  const j = await apiFetchJson<{ job?: ContactImportJobDto }>(
    `/api/contacts/import-jobs/${encodeURIComponent(jobId)}`,
    { timeoutMs: 30_000, retries: 1 }
  );
  if (!j.job) throw new Error('Importação não encontrada.');
  return j.job;
}

export async function apiGetActiveContactImportJob(): Promise<ContactImportJobDto | null> {
  const j = await apiFetchJson<{ job?: ContactImportJobDto | null }>(
    '/api/contacts/import-jobs/active',
    { timeoutMs: 15_000, retries: 1 }
  );
  return j.job || null;
}

export async function apiCancelContactImportJob(jobId: string): Promise<void> {
  await apiFetchJson(`/api/contacts/import-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    timeoutMs: 15_000,
  });
}

export type NameNormalizeJobDto = {
  id: string;
  status: string;
  total: number;
  scanned: number;
  updated: number;
  unchanged: number;
  percent: number;
  message: string;
  lastError?: string;
};

export async function apiPreviewNameNormalize(opts: {
  stripPrefixes: boolean;
  titleCase: boolean;
  firstAndLastOnly: boolean;
  sanitizeCharacters: boolean;
  extraPrefixes: string[];
}): Promise<{ total: number; changed: number }> {
  const j = await apiFetchJson<{ total?: number; changed?: number }>(
    '/api/contacts/normalize-names/preview',
    {
      method: 'POST',
      body: JSON.stringify(opts),
      timeoutMs: 180_000,
      retries: 0,
    }
  );
  return { total: Number(j.total) || 0, changed: Number(j.changed) || 0 };
}

export async function apiStartNameNormalize(opts: {
  stripPrefixes: boolean;
  titleCase: boolean;
  firstAndLastOnly: boolean;
  sanitizeCharacters: boolean;
  extraPrefixes: string[];
}): Promise<NameNormalizeJobDto> {
  const j = await apiFetchJson<{ job?: NameNormalizeJobDto }>('/api/contacts/normalize-names', {
    method: 'POST',
    body: JSON.stringify(opts),
    timeoutMs: 30_000,
    retries: 1,
  });
  if (!j.job?.id) throw new Error('Não foi possível iniciar a padronização.');
  return j.job;
}

export async function apiGetNameNormalizeJob(jobId: string): Promise<NameNormalizeJobDto> {
  const j = await apiFetchJson<{ job?: NameNormalizeJobDto }>(
    `/api/contacts/normalize-names/${encodeURIComponent(jobId)}`,
    { timeoutMs: 30_000, retries: 1 }
  );
  if (!j.job) throw new Error('Job não encontrado.');
  return j.job;
}

export async function apiGetActiveNameNormalizeJob(): Promise<NameNormalizeJobDto | null> {
  const j = await apiFetchJson<{ job?: NameNormalizeJobDto | null }>(
    '/api/contacts/normalize-names/active',
    { timeoutMs: 15_000, retries: 1 }
  );
  return j.job || null;
}

export async function apiCancelNameNormalizeJob(jobId: string): Promise<void> {
  await apiFetchJson(`/api/contacts/normalize-names/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    timeoutMs: 15_000,
  });
}

export type WaNameSyncJobDto = {
  id: string;
  status: string;
  mode: string;
  total: number;
  scanned: number;
  updated: number;
  skipped: number;
  unavailable: number;
  failed: number;
  percent: number;
  message: string;
  lastError?: string;
};

export async function apiStartWaNameSync(opts: {
  mode: 'ids' | 'suspicious';
  ids?: string[];
  connectionId?: string;
}): Promise<WaNameSyncJobDto> {
  const j = await apiFetchJson<{ job?: WaNameSyncJobDto }>('/api/contacts/sync-wa-names', {
    method: 'POST',
    body: JSON.stringify(opts),
    timeoutMs: 30_000,
    retries: 1,
  });
  if (!j.job?.id) throw new Error('Não foi possível iniciar a sincronização de nomes.');
  return j.job;
}

export async function apiGetWaNameSyncJob(jobId: string): Promise<WaNameSyncJobDto> {
  const j = await apiFetchJson<{ job?: WaNameSyncJobDto }>(
    `/api/contacts/sync-wa-names/${encodeURIComponent(jobId)}`,
    { timeoutMs: 30_000, retries: 1 }
  );
  if (!j.job) throw new Error('Job não encontrado.');
  return j.job;
}

export async function apiGetActiveWaNameSyncJob(): Promise<WaNameSyncJobDto | null> {
  const j = await apiFetchJson<{ job?: WaNameSyncJobDto | null }>(
    '/api/contacts/sync-wa-names/active',
    { timeoutMs: 15_000, retries: 1 }
  );
  return j.job || null;
}

export async function apiCancelWaNameSyncJob(jobId: string): Promise<void> {
  await apiFetchJson(`/api/contacts/sync-wa-names/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    timeoutMs: 15_000,
  });
}

export type ContactDedupeJobDto = {
  id: string;
  status: string;
  total: number;
  scanned: number;
  groups: number;
  merged: number;
  deleted: number;
  listsUpdated: number;
  percent: number;
  message: string;
  lastError?: string;
};

export async function apiStartContactDedupe(): Promise<ContactDedupeJobDto> {
  const j = await apiFetchJson<{ job?: ContactDedupeJobDto }>('/api/contacts/dedupe', {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 30_000,
    retries: 1,
  });
  if (!j.job?.id) throw new Error('Não foi possível iniciar a união de duplicados.');
  return j.job;
}

export async function apiGetContactDedupeJob(jobId: string): Promise<ContactDedupeJobDto> {
  const j = await apiFetchJson<{ job?: ContactDedupeJobDto }>(
    `/api/contacts/dedupe/${encodeURIComponent(jobId)}`,
    { timeoutMs: 30_000, retries: 1 }
  );
  if (!j.job) throw new Error('Job não encontrado.');
  return j.job;
}

export async function apiGetActiveContactDedupeJob(): Promise<ContactDedupeJobDto | null> {
  const j = await apiFetchJson<{ job?: ContactDedupeJobDto | null }>(
    '/api/contacts/dedupe/active',
    { timeoutMs: 15_000, retries: 1 }
  );
  return j.job || null;
}

export async function apiCancelContactDedupeJob(jobId: string): Promise<void> {
  await apiFetchJson(`/api/contacts/dedupe/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    timeoutMs: 15_000,
  });
}
