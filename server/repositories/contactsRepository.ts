import { randomUUID } from 'crypto';
import { getZapmassPool } from '../db/postgres.js';
import { resolvePostgresTenantId } from '../auth/firebaseUidMap.js';
import type { Contact } from '../../src/types.js';
import { normPhoneKey } from '../../src/utils/brPhoneNormalize.js';
import {
  contactToDocPayload,
  mergeContactUpdates,
  prepareContactForPersistence,
  rowToContact,
  sortNameForContact,
  type ContactRow
} from './contactMapper.js';

const DEFAULT_LIMIT = 10_000;
const BULK_INSERT_CHUNK = 200;

function pgTenantId(tenantId: string): string {
  return resolvePostgresTenantId(String(tenantId || '').trim());
}

/** Chave única por tenant; telefone vazio usa id para não colidir no UNIQUE. */
export function phoneKeyForContact(phone: string, id: string): string {
  const key = normPhoneKey(phone);
  return key || `__empty__:${id}`;
}

function preparedNamePhone(contact: Partial<Contact>): {
  prepared: Partial<Contact>;
  name: string;
  phone: string;
  phoneKey: string;
  id: string;
  doc: Record<string, unknown>;
} {
  const id =
    contact.id && /^[0-9a-f-]{36}$/i.test(String(contact.id))
      ? String(contact.id)
      : randomUUID();
  const prepared = prepareContactForPersistence({
    ...contact,
    name: String(contact.name || 'Sem Nome'),
    phone: String(contact.phone || '')
  });
  const name = String(prepared.name || 'Sem Nome').slice(0, 500);
  const phone = String(prepared.phone || '').slice(0, 64);
  const phoneKey = phoneKeyForContact(phone, id);
  const doc = contactToDocPayload(prepared);
  return { prepared, name, phone, phoneKey, id, doc };
}

export async function countContacts(tenantId: string): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const tid = pgTenantId(tenantId);
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM zapmass.contacts WHERE tenant_id = $1::uuid`,
    [tid]
  );
  return Number(r.rows[0]?.n || 0);
}

const countCache = new Map<string, { n: number; at: number }>();
const COUNT_CACHE_TTL_MS = 45_000;

export function invalidateContactsCountCache(tenantId?: string): void {
  if (!tenantId) {
    countCache.clear();
    return;
  }
  countCache.delete(pgTenantId(tenantId));
}

/** COUNT(*) em 40k+ linhas é pesado — cache curto por tenant. */
export async function countContactsCached(tenantId: string): Promise<number> {
  const tid = pgTenantId(tenantId);
  const hit = countCache.get(tid);
  if (hit && Date.now() - hit.at < COUNT_CACHE_TTL_MS) return hit.n;
  const n = await countContacts(tenantId);
  countCache.set(tid, { n, at: Date.now() });
  return n;
}

export async function listContacts(
  tenantId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<Contact[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const tid = pgTenantId(tenantId);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 10_000);
  const offset = Math.max(opts.offset ?? 0, 0);
  const r = await pool.query<ContactRow>(
    `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
     FROM zapmass.contacts
     WHERE tenant_id = $1::uuid
     ORDER BY sort_name ASC, id ASC
     LIMIT $2 OFFSET $3`,
    [tid, limit, offset]
  );
  return r.rows.map(rowToContact);
}

/** Paginação estável por id (segura quando sort_name muda no meio do job). */
export async function listContactsAfterId(
  tenantId: string,
  opts: { afterId?: string | null; limit?: number } = {}
): Promise<Contact[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const tid = pgTenantId(tenantId);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 10_000);
  const afterId = opts.afterId ? String(opts.afterId) : null;
  const r = afterId
    ? await pool.query<ContactRow>(
        `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
         FROM zapmass.contacts
         WHERE tenant_id = $1::uuid AND id > $2::uuid
         ORDER BY id ASC
         LIMIT $3`,
        [tid, afterId, limit]
      )
    : await pool.query<ContactRow>(
        `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
         FROM zapmass.contacts
         WHERE tenant_id = $1::uuid
         ORDER BY id ASC
         LIMIT $2`,
        [tid, limit]
      );
  return r.rows.map(rowToContact);
}

/** Só nome+telefone — índice CRM no chat (evita parse de doc JSON em massa). */
export async function listContactNamePhones(
  tenantId: string,
  opts: { limit?: number } = {}
): Promise<Array<{ name: string; phone: string }>> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const tid = pgTenantId(tenantId);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 10_000);
  const r = await pool.query<{ name: string; phone: string }>(
    `SELECT name, phone
     FROM zapmass.contacts
     WHERE tenant_id = $1::uuid
     ORDER BY sort_name ASC, id ASC
     LIMIT $2`,
    [tid, limit]
  );
  return r.rows;
}

export async function getContactById(tenantId: string, id: string): Promise<Contact | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const tid = pgTenantId(tenantId);
  const r = await pool.query<ContactRow>(
    `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
     FROM zapmass.contacts WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tid, id]
  );
  return r.rows[0] ? rowToContact(r.rows[0]) : null;
}

export async function findContactByPhoneKey(
  tenantId: string,
  phoneKey: string
): Promise<Contact | null> {
  if (!phoneKey || phoneKey.startsWith('__empty__:')) return null;
  const pool = getZapmassPool();
  if (!pool) return null;
  const tid = pgTenantId(tenantId);
  const r = await pool.query<ContactRow>(
    `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
     FROM zapmass.contacts
     WHERE tenant_id = $1::uuid AND phone_key = $2
     LIMIT 1`,
    [tid, phoneKey]
  );
  return r.rows[0] ? rowToContact(r.rows[0]) : null;
}

export async function createContact(tenantId: string, contact: Partial<Contact>): Promise<Contact> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const tid = pgTenantId(tenantId);
  const { name, phone, phoneKey, id, doc, prepared } = preparedNamePhone(contact);

  if (!phoneKey.startsWith('__empty__:')) {
    const existing = await findContactByPhoneKey(tid, phoneKey);
    if (existing) {
      const updated = await updateContact(tid, existing.id, prepared);
      return updated || existing;
    }
  }

  const r = await pool.query<ContactRow>(
    `INSERT INTO zapmass.contacts (id, tenant_id, name, phone, phone_key, sort_name, doc)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (tenant_id, phone_key) DO UPDATE SET
       name = EXCLUDED.name,
       phone = EXCLUDED.phone,
       sort_name = EXCLUDED.sort_name,
       doc = EXCLUDED.doc,
       updated_at = now()
     RETURNING id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at`,
    [id, tid, name, phone, phoneKey, sortNameForContact(name), JSON.stringify(doc)]
  );
  return rowToContact(r.rows[0]!);
}

/**
 * Cria ou atualiza em lote. Retorna 1 id por linha de entrada
 * (id existente se o telefone já estava na base). Não duplica número no tenant.
 */
export async function bulkCreateContacts(
  tenantId: string,
  rows: Partial<Contact>[]
): Promise<string[]> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  if (rows.length === 0) return [];

  const tid = pgTenantId(tenantId);
  const preparedRows = rows.map((contact) => preparedNamePhone(contact));
  const outIds: string[] = new Array(preparedRows.length);

  const canonByKey = new Map<string, number>();
  for (let i = 0; i < preparedRows.length; i++) {
    const k = preparedRows[i]!.phoneKey;
    if (!k.startsWith('__empty__:') && !canonByKey.has(k)) canonByKey.set(k, i);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const keys = [...canonByKey.keys()];
    const existingByKey = new Map<string, Contact>();
    if (keys.length > 0) {
      const found = await client.query<ContactRow & { phone_key: string }>(
        `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at, phone_key
         FROM zapmass.contacts
         WHERE tenant_id = $1::uuid AND phone_key = ANY($2::text[])`,
        [tid, keys]
      );
      for (const row of found.rows) {
        if (row.phone_key) existingByKey.set(row.phone_key, rowToContact(row));
      }
    }

    const toUpsert: ReturnType<typeof preparedNamePhone>[] = [];
    const upsertAt: number[] = [];

    for (let i = 0; i < preparedRows.length; i++) {
      const row = preparedRows[i]!;
      const existing = !row.phoneKey.startsWith('__empty__:')
        ? existingByKey.get(row.phoneKey)
        : undefined;

      if (existing) {
        // Reusa id existente e faz upsert multi-row (evita UPDATE 1×1, gargalo do import).
        const merged = prepareContactForPersistence(mergeContactUpdates(existing, row.prepared));
        const name = String(merged.name || 'Sem Nome').slice(0, 500);
        const phone = String(merged.phone || '').slice(0, 64);
        const phoneKey = phoneKeyForContact(phone, existing.id);
        const doc = contactToDocPayload(merged);
        toUpsert.push({
          ...row,
          id: existing.id,
          name,
          phone,
          phoneKey,
          doc,
          prepared: merged
        });
        upsertAt.push(i);
        existingByKey.set(row.phoneKey, { ...existing, ...merged, id: existing.id, name, phone });
        continue;
      }

      const isCanon =
        row.phoneKey.startsWith('__empty__:') || canonByKey.get(row.phoneKey) === i;
      if (isCanon) {
        toUpsert.push(row);
        upsertAt.push(i);
      }
    }

    for (let offset = 0; offset < toUpsert.length; offset += BULK_INSERT_CHUNK) {
      const chunk = toUpsert.slice(offset, offset + BULK_INSERT_CHUNK);
      const chunkIdx = upsertAt.slice(offset, offset + BULK_INSERT_CHUNK);
      if (chunk.length === 0) continue;

      const values: string[] = [];
      const params: unknown[] = [tid];
      let paramIdx = 2;
      for (const row of chunk) {
        values.push(
          `($${paramIdx}::uuid, $1::uuid, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}::jsonb)`
        );
        params.push(
          row.id,
          row.name,
          row.phone,
          row.phoneKey,
          sortNameForContact(row.name),
          JSON.stringify(row.doc)
        );
        paramIdx += 6;
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO zapmass.contacts (id, tenant_id, name, phone, phone_key, sort_name, doc)
         VALUES ${values.join(', ')}
         ON CONFLICT (tenant_id, phone_key) DO UPDATE SET
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           sort_name = EXCLUDED.sort_name,
           doc = EXCLUDED.doc,
           updated_at = now()
         RETURNING id::text`,
        params
      );

      for (let j = 0; j < chunkIdx.length; j++) {
        outIds[chunkIdx[j]!] = inserted.rows[j]?.id || chunk[j]!.id;
      }
    }

    for (let i = 0; i < preparedRows.length; i++) {
      if (outIds[i]) continue;
      const canon = canonByKey.get(preparedRows[i]!.phoneKey);
      outIds[i] = (canon != null && outIds[canon]) || preparedRows[i]!.id;
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return outIds;
}

const ADDRESS_GEO_KEYS = ['street', 'number', 'city', 'state', 'neighborhood', 'zipCode'] as const;

function addressFieldsChanged(existing: Contact, updates: Partial<Contact>): boolean {
  for (const k of ADDRESS_GEO_KEYS) {
    if (!(k in updates)) continue;
    if (String(updates[k] ?? '').trim() !== String(existing[k] ?? '').trim()) return true;
  }
  return false;
}

export async function updateContact(
  tenantId: string,
  id: string,
  updates: Partial<Contact>
): Promise<Contact | null> {
  const existing = await getContactById(tenantId, id);
  if (!existing) return null;
  const patch = addressFieldsChanged(existing, updates)
    ? {
        ...updates,
        latitude: undefined,
        longitude: undefined,
        geocodedAt: undefined,
        geocodePrecision: undefined
      }
    : updates;
  const merged = prepareContactForPersistence(mergeContactUpdates(existing, patch));
  const name = String(merged.name || 'Sem Nome').slice(0, 500);
  const phone = String(merged.phone || '').slice(0, 64);
  const phoneKey = phoneKeyForContact(phone, id);
  const doc = contactToDocPayload(merged);
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const tid = pgTenantId(tenantId);

  const r = await pool.query<ContactRow>(
    `UPDATE zapmass.contacts
     SET name = $3, phone = $4, phone_key = $5, sort_name = $6, doc = $7::jsonb, updated_at = now()
     WHERE tenant_id = $1::uuid AND id = $2::uuid
     RETURNING id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at`,
    [tid, id, name, phone, phoneKey, sortNameForContact(name), JSON.stringify(doc)]
  );
  return r.rows[0] ? rowToContact(r.rows[0]) : null;
}

export async function bulkUpdateContacts(
  tenantId: string,
  items: Array<{ id: string; updates: Partial<Contact> }>
): Promise<void> {
  if (items.length === 0) return;
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const tid = pgTenantId(tenantId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = items.map((i) => i.id);
    const r = await client.query<ContactRow>(
      `SELECT id::text, tenant_id::text, name, phone, sort_name, doc, created_at, updated_at
       FROM zapmass.contacts WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
      [tid, ids]
    );
    const existingById = new Map(r.rows.map((row) => [row.id, rowToContact(row)]));
    for (const { id, updates } of items) {
      const existing = existingById.get(id);
      if (!existing) continue;
      const merged = prepareContactForPersistence(mergeContactUpdates(existing, updates));
      const name = String(merged.name || 'Sem Nome').slice(0, 500);
      const phone = String(merged.phone || '').slice(0, 64);
      const phoneKey = phoneKeyForContact(phone, id);
      const doc = contactToDocPayload(merged);
      await client.query(
        `UPDATE zapmass.contacts
         SET name = $3, phone = $4, phone_key = $5, sort_name = $6, doc = $7::jsonb, updated_at = now()
         WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tid, id, name, phone, phoneKey, sortNameForContact(name), JSON.stringify(doc)]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteContact(tenantId: string, id: string): Promise<boolean> {
  const pool = getZapmassPool();
  if (!pool) return false;
  const tid = pgTenantId(tenantId);
  const r = await pool.query(
    `DELETE FROM zapmass.contacts WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tid, id]
  );
  return (r.rowCount ?? 0) > 0;
}

/** Libera o UNIQUE (tenant_id, phone_key) antes de unir duplicados no keeper. */
export async function neutralizeContactPhoneKeys(tenantId: string, ids: string[]): Promise<void> {
  const uniq = [...new Set(ids.map(String).filter(Boolean))];
  if (uniq.length === 0) return;
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  const CHUNK = 200;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const slice = uniq.slice(i, i + CHUNK);
    await pool.query(
      `UPDATE zapmass.contacts
       SET phone_key = '__empty__:' || id::text, updated_at = now()
       WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
      [tid, slice]
    );
  }
}

export async function bulkDeleteContacts(tenantId: string, ids: string[]): Promise<number> {
  const uniq = [...new Set(ids.map(String).filter(Boolean))];
  if (uniq.length === 0) return 0;
  const pool = getZapmassPool();
  if (!pool) return 0;
  const tid = pgTenantId(tenantId);
  let deleted = 0;
  const CHUNK = 200;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const slice = uniq.slice(i, i + CHUNK);
    const r = await pool.query(
      `DELETE FROM zapmass.contacts WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
      [tid, slice]
    );
    deleted += r.rowCount ?? 0;
  }
  return deleted;
}

/** Resolve ids por phone_key (útil para vincular duplicados à lista sem UPDATE). */
export async function findContactIdsByPhoneKeys(
  tenantId: string,
  phoneKeys: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const keys = [...new Set(phoneKeys.map(String).filter((k) => k && !k.startsWith('__empty__:')))];
  if (keys.length === 0) return out;
  const pool = getZapmassPool();
  if (!pool) return out;
  const tid = pgTenantId(tenantId);
  const r = await pool.query<{ id: string; phone_key: string }>(
    `SELECT id::text, phone_key
     FROM zapmass.contacts
     WHERE tenant_id = $1::uuid AND phone_key = ANY($2::text[])`,
    [tid, keys]
  );
  for (const row of r.rows) {
    if (row.phone_key) out.set(row.phone_key, row.id);
  }
  return out;
}

export async function deleteAllContacts(tenantId: string): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const tid = pgTenantId(tenantId);
  const r = await pool.query(`DELETE FROM zapmass.contacts WHERE tenant_id = $1::uuid`, [tid]);
  return r.rowCount ?? 0;
}
