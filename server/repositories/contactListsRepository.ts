import { randomUUID } from 'crypto';
import { getZapmassPool } from '../db/postgres.js';
import type { ContactList } from '../../src/types.js';
import {
  contactListToDocPayload,
  rowToContactList,
  type ContactListRow
} from './contactMapper.js';

export async function listContactLists(tenantId: string): Promise<ContactList[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<ContactListRow>(
    `SELECT id::text, tenant_id::text, name, contact_ids, description, tags, created_at, updated_at
     FROM zapmass.contact_lists
     WHERE tenant_id = $1::uuid
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return r.rows.map((row) =>
    rowToContactList({
      ...row,
      contact_ids: Array.isArray(row.contact_ids)
        ? row.contact_ids
        : (row.contact_ids as unknown as string[])
    })
  );
}

export async function createContactList(
  tenantId: string,
  input: Partial<ContactList>
): Promise<ContactList> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const id = randomUUID();
  const payload = contactListToDocPayload(input);
  const r = await pool.query<ContactListRow>(
    `INSERT INTO zapmass.contact_lists (id, tenant_id, name, contact_ids, description, tags)
     VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6::jsonb)
     RETURNING id::text, tenant_id::text, name, contact_ids, description, tags, created_at, updated_at`,
    [
      id,
      tenantId,
      payload.name,
      JSON.stringify(payload.contact_ids),
      payload.description,
      payload.tags ? JSON.stringify(payload.tags) : null
    ]
  );
  const row = r.rows[0]!;
  return rowToContactList({
    ...row,
    contact_ids: payload.contact_ids
  });
}

export async function updateContactList(
  tenantId: string,
  id: string,
  updates: Partial<ContactList>
): Promise<ContactList | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const lists = await listContactLists(tenantId);
  const existing = lists.find((l) => l.id === id);
  if (!existing) return null;
  const merged: ContactList = { ...existing, ...updates, id };
  const payload = contactListToDocPayload(merged);
  const r = await pool.query<ContactListRow>(
    `UPDATE zapmass.contact_lists
     SET name = $3, contact_ids = $4::jsonb, description = $5, tags = $6::jsonb, updated_at = now()
     WHERE tenant_id = $1::uuid AND id = $2::uuid
     RETURNING id::text, tenant_id::text, name, contact_ids, description, tags, created_at, updated_at`,
    [
      tenantId,
      id,
      payload.name,
      JSON.stringify(payload.contact_ids),
      payload.description,
      payload.tags ? JSON.stringify(payload.tags) : null
    ]
  );
  const row = r.rows[0];
  if (!row) return null;
  return rowToContactList({ ...row, contact_ids: payload.contact_ids });
}

export async function deleteContactList(tenantId: string, id: string): Promise<boolean> {
  const pool = getZapmassPool();
  if (!pool) return false;
  const r = await pool.query(
    `DELETE FROM zapmass.contact_lists WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, id]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteAllContactLists(tenantId: string): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const r = await pool.query(`DELETE FROM zapmass.contact_lists WHERE tenant_id = $1::uuid`, [
    tenantId
  ]);
  return r.rowCount ?? 0;
}
