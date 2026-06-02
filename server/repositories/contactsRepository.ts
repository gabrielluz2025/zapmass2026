import { randomUUID } from 'crypto';
import { getZapmassPool } from '../db/postgres.js';
import type { Contact } from '../../src/types.js';
import {
  contactToDocPayload,
  mergeContactUpdates,
  rowToContact,
  sortNameForContact,
  type ContactRow
} from './contactMapper.js';

const DEFAULT_LIMIT = 5000;

export async function countContacts(tenantId: string): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM zapmass.contacts WHERE tenant_id = $1::uuid`,
    [tenantId]
  );
  return Number(r.rows[0]?.n || 0);
}

export async function listContacts(
  tenantId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<Contact[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 10_000);
  const offset = Math.max(opts.offset ?? 0, 0);
  const r = await pool.query<ContactRow>(
    `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
     FROM zapmass.contacts
     WHERE tenant_id = $1::uuid
     ORDER BY sort_name ASC, id ASC
     LIMIT $2 OFFSET $3`,
    [tenantId, limit, offset]
  );
  return r.rows.map(rowToContact);
}

export async function getContactById(tenantId: string, id: string): Promise<Contact | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<ContactRow>(
    `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
     FROM zapmass.contacts WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, id]
  );
  return r.rows[0] ? rowToContact(r.rows[0]) : null;
}

export async function createContact(tenantId: string, contact: Partial<Contact>): Promise<Contact> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const id = contact.id && /^[0-9a-f-]{36}$/i.test(contact.id) ? contact.id : randomUUID();
  const name = String(contact.name || 'Sem Nome').slice(0, 500);
  const phone = String(contact.phone || '').slice(0, 64);
  const doc = contactToDocPayload({ ...contact, name, phone });
  const r = await pool.query<ContactRow>(
    `INSERT INTO zapmass.contacts (id, tenant_id, name, phone, sort_name, doc)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
     RETURNING id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at`,
    [id, tenantId, name, phone, sortNameForContact(name), JSON.stringify(doc)]
  );
  return rowToContact(r.rows[0]!);
}

export async function bulkCreateContacts(
  tenantId: string,
  rows: Partial<Contact>[]
): Promise<string[]> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  if (rows.length === 0) return [];
  const ids: string[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const contact of rows) {
      const id = randomUUID();
      const name = String(contact.name || 'Sem Nome').slice(0, 500);
      const phone = String(contact.phone || '').slice(0, 64);
      const doc = contactToDocPayload({ ...contact, name, phone });
      await client.query(
        `INSERT INTO zapmass.contacts (id, tenant_id, name, phone, sort_name, doc)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)`,
        [id, tenantId, name, phone, sortNameForContact(name), JSON.stringify(doc)]
      );
      ids.push(id);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return ids;
}

export async function updateContact(
  tenantId: string,
  id: string,
  updates: Partial<Contact>
): Promise<Contact | null> {
  const existing = await getContactById(tenantId, id);
  if (!existing) return null;
  const merged = mergeContactUpdates(existing, updates);
  const name = String(merged.name || 'Sem Nome').slice(0, 500);
  const phone = String(merged.phone || '').slice(0, 64);
  const doc = contactToDocPayload(merged);
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const r = await pool.query<ContactRow>(
    `UPDATE zapmass.contacts
     SET name = $3, phone = $4, sort_name = $5, doc = $6::jsonb, updated_at = now()
     WHERE tenant_id = $1::uuid AND id = $2::uuid
     RETURNING id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at`,
    [tenantId, id, name, phone, sortNameForContact(name), JSON.stringify(doc)]
  );
  return r.rows[0] ? rowToContact(r.rows[0]) : null;
}

export async function bulkUpdateContacts(
  tenantId: string,
  items: Array<{ id: string; updates: Partial<Contact> }>
): Promise<void> {
  for (const { id, updates } of items) {
    await updateContact(tenantId, id, updates);
  }
}

export async function deleteContact(tenantId: string, id: string): Promise<boolean> {
  const pool = getZapmassPool();
  if (!pool) return false;
  const r = await pool.query(
    `DELETE FROM zapmass.contacts WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, id]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteAllContacts(tenantId: string): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const r = await pool.query(`DELETE FROM zapmass.contacts WHERE tenant_id = $1::uuid`, [tenantId]);
  return r.rowCount ?? 0;
}
