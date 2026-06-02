import type { Contact, ContactList } from '../../src/types.js';

export type ContactRow = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  sort_name: string;
  doc: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type ContactListRow = {
  id: string;
  tenant_id: string;
  name: string;
  contact_ids: string[];
  description: string | null;
  tags: string[] | null;
  created_at: Date;
  updated_at: Date;
};

export function sortNameForContact(name: string): string {
  return (name || 'Sem Nome').trim().toLowerCase();
}

/** Payload Firestore-compatível (sem id). */
export function contactToDocPayload(contact: Partial<Contact>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(contact)) {
    if (k === 'id' || k === 'profilePicUrl') continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function rowToContact(row: ContactRow): Contact {
  const base = (row.doc && typeof row.doc === 'object' ? row.doc : {}) as Record<string, unknown>;
  return {
    ...(base as unknown as Contact),
    id: row.id,
    name: row.name || (base.name as string) || 'Sem Nome',
    phone: row.phone || (base.phone as string) || '',
    tags: Array.isArray(base.tags) ? (base.tags as string[]) : [],
    status: base.status === 'INVALID' ? 'INVALID' : 'VALID'
  };
}

export function mergeContactUpdates(existing: Contact, updates: Partial<Contact>): Contact {
  return { ...existing, ...updates, id: existing.id };
}

export function rowToContactList(row: ContactListRow): ContactList {
  const ids = Array.isArray(row.contact_ids) ? row.contact_ids.map(String) : [];
  return {
    id: row.id,
    name: row.name || 'Lista',
    contactIds: ids,
    description: row.description || undefined,
    createdAt: row.created_at.toISOString(),
    tags: Array.isArray(row.tags) ? row.tags : undefined,
    count: ids.length
  };
}

export function contactListToDocPayload(list: Partial<ContactList>): {
  name: string;
  contact_ids: string[];
  description: string | null;
  tags: string[] | null;
} {
  return {
    name: String(list.name || 'Lista').slice(0, 200),
    contact_ids: Array.isArray(list.contactIds) ? list.contactIds.map(String) : [],
    description:
      typeof list.description === 'string' && list.description.trim() ? list.description.trim() : null,
    tags: Array.isArray(list.tags) ? list.tags.map(String) : null
  };
}
