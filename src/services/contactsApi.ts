import type { Contact, ContactList } from '../types';
import { apiFetchJson } from '../utils/apiFetchAuth';

/** Bases grandes (40k+) podem levar >30s por página — evita falso "sem conexão". */
const CONTACTS_API_TIMEOUT_MS = 120_000;

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
    body: JSON.stringify({ contacts })
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
    body: JSON.stringify({ items })
  });
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
  const j = await apiFetchJson<{ lists?: ContactList[] }>('/api/contact-lists');
  return Array.isArray(j.lists) ? j.lists : [];
}

export async function apiCreateContactList(input: Partial<ContactList>): Promise<string> {
  const j = await apiFetchJson<{ id?: string; list?: ContactList }>('/api/contact-lists', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return String(j.id || j.list?.id || '');
}

export async function apiUpdateContactList(id: string, updates: Partial<ContactList>): Promise<void> {
  await apiFetchJson(`/api/contact-lists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
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
      body: JSON.stringify({ contactIds, notesLine: opts?.notesLine })
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
