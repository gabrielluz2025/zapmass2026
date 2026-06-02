import type { Contact, ContactList } from '../types';
import { apiFetchJson } from '../utils/apiFetchAuth';

export async function fetchContacts(opts?: {
  limit?: number;
  offset?: number;
}): Promise<{ contacts: Contact[]; total: number; hasMore: boolean }> {
  const q = new URLSearchParams();
  if (opts?.limit) q.set('limit', String(opts.limit));
  if (opts?.offset) q.set('offset', String(opts.offset));
  const path = q.toString() ? `/api/contacts?${q}` : '/api/contacts';
  const j = await apiFetchJson<{
    contacts?: Contact[];
    total?: number;
    hasMore?: boolean;
  }>(path);
  return {
    contacts: Array.isArray(j.contacts) ? j.contacts : [],
    total: Number(j.total) || 0,
    hasMore: !!j.hasMore
  };
}

export async function fetchContactsCount(): Promise<number> {
  const j = await apiFetchJson<{ total?: number }>('/api/contacts/count');
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
