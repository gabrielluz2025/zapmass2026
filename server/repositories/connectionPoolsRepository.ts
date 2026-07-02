import { getZapmassPool } from '../db/postgres.js';

export interface ConnectionPoolDoc {
  id: string;
  tenantId: string;
  name: string;
  connectionIds: string[];
  channelWeights?: Record<string, number>;
  strategy: 'round_robin' | 'weighted' | 'priority';
  createdAt: string;
  updatedAt: string;
}

type PoolRow = {
  id: string;
  tenant_id: string;
  name: string;
  doc: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

function rowToDoc(row: PoolRow): ConnectionPoolDoc {
  const doc = row.doc || {};
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    connectionIds: Array.isArray(doc.connectionIds) ? (doc.connectionIds as string[]) : [],
    channelWeights:
      typeof doc.channelWeights === 'object' && doc.channelWeights !== null
        ? (doc.channelWeights as Record<string, number>)
        : undefined,
    strategy: (doc.strategy as ConnectionPoolDoc['strategy']) || 'round_robin',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/** tenantId = UUID da tabela zapmass.users (já resolvido pelo principal.tenantUid). */
export async function listConnectionPoolsPg(tenantId: string): Promise<ConnectionPoolDoc[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const { rows } = await pool.query<PoolRow>(
    `SELECT id::text, tenant_id::text, name, doc, created_at, updated_at
     FROM zapmass.connection_pools
     WHERE tenant_id = $1::uuid
     ORDER BY created_at ASC`,
    [tenantId]
  );
  return rows.map(rowToDoc);
}

export async function getConnectionPoolPg(tenantId: string, poolId: string): Promise<ConnectionPoolDoc | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const { rows } = await pool.query<PoolRow>(
    `SELECT id::text, tenant_id::text, name, doc, created_at, updated_at
     FROM zapmass.connection_pools
     WHERE id = $1::uuid AND tenant_id = $2::uuid`,
    [poolId, tenantId]
  );
  return rows.length > 0 ? rowToDoc(rows[0]) : null;
}

export async function createConnectionPoolPg(
  tenantId: string,
  data: {
    name: string;
    connectionIds: string[];
    channelWeights?: Record<string, number>;
    strategy?: ConnectionPoolDoc['strategy'];
  }
): Promise<ConnectionPoolDoc> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('Banco de dados não disponível.');
  const doc = {
    connectionIds: data.connectionIds,
    channelWeights: data.channelWeights || {},
    strategy: data.strategy || 'round_robin',
  };
  const { rows } = await pool.query<PoolRow>(
    `INSERT INTO zapmass.connection_pools (tenant_id, name, doc)
     VALUES ($1::uuid, $2, $3)
     RETURNING id::text, tenant_id::text, name, doc, created_at, updated_at`,
    [tenantId, data.name.trim(), JSON.stringify(doc)]
  );
  return rowToDoc(rows[0]);
}

export async function updateConnectionPoolPg(
  tenantId: string,
  poolId: string,
  data: {
    name?: string;
    connectionIds?: string[];
    channelWeights?: Record<string, number>;
    strategy?: ConnectionPoolDoc['strategy'];
  }
): Promise<ConnectionPoolDoc | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const existing = await getConnectionPoolPg(tenantId, poolId);
  if (!existing) return null;
  const doc = {
    connectionIds: data.connectionIds ?? existing.connectionIds,
    channelWeights: data.channelWeights ?? existing.channelWeights ?? {},
    strategy: data.strategy ?? existing.strategy,
  };
  const name = data.name?.trim() ?? existing.name;
  const { rows } = await pool.query<PoolRow>(
    `UPDATE zapmass.connection_pools
     SET name = $1, doc = $2, updated_at = now()
     WHERE id = $3::uuid AND tenant_id = $4::uuid
     RETURNING id::text, tenant_id::text, name, doc, created_at, updated_at`,
    [name, JSON.stringify(doc), poolId, tenantId]
  );
  return rows.length > 0 ? rowToDoc(rows[0]) : null;
}

export async function deleteConnectionPoolPg(tenantId: string, poolId: string): Promise<boolean> {
  const pool = getZapmassPool();
  if (!pool) return false;
  const { rowCount } = await pool.query(
    `DELETE FROM zapmass.connection_pools
     WHERE id = $1::uuid AND tenant_id = $2::uuid`,
    [poolId, tenantId]
  );
  return (rowCount ?? 0) > 0;
}
