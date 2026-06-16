import { getZapmassPool } from '../db/postgres.js';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export interface LibraryItem {
  id: string;
  name: string;
  doc: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

type Kind = 'templates' | 'segments';

function tableFor(kind: Kind): string {
  return kind === 'templates' ? 'zapmass.campaign_templates' : 'zapmass.campaign_segments';
}

export async function listLibraryItems(tenantId: string, kind: Kind): Promise<LibraryItem[]> {
  if (!isUuid(tenantId)) return [];
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<{
    id: string;
    name: string;
    doc: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, doc, created_at, updated_at FROM ${tableFor(kind)}
     WHERE tenant_id = $1::uuid ORDER BY updated_at DESC LIMIT 200`,
    [tenantId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    doc: row.doc ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }));
}

export async function createLibraryItem(
  tenantId: string,
  kind: Kind,
  name: string,
  doc: Record<string, unknown>
): Promise<LibraryItem | null> {
  if (!isUuid(tenantId)) return null;
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<{
    id: string;
    name: string;
    doc: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO ${tableFor(kind)} (tenant_id, name, doc)
     VALUES ($1::uuid, $2, $3::jsonb)
     RETURNING id, name, doc, created_at, updated_at`,
    [tenantId, name.slice(0, 200), JSON.stringify(doc ?? {})]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    doc: row.doc ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function deleteLibraryItem(tenantId: string, kind: Kind, id: string): Promise<boolean> {
  if (!isUuid(tenantId) || !isUuid(id)) return false;
  const pool = getZapmassPool();
  if (!pool) return false;
  const r = await pool.query(
    `DELETE FROM ${tableFor(kind)} WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, id]
  );
  return (r.rowCount ?? 0) > 0;
}
