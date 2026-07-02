import { apiUrl } from '../utils/apiBase';
import { getSessionIdToken } from '../utils/sessionAuth';

export interface ConnectionPool {
  id: string;
  tenantId: string;
  name: string;
  connectionIds: string[];
  channelWeights?: Record<string, number>;
  strategy: 'round_robin' | 'weighted' | 'priority';
  createdAt: string;
  updatedAt: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getSessionIdToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export async function listConnectionPools(): Promise<ConnectionPool[]> {
  const res = await fetch(apiUrl('/api/connection-pools'), { headers: await authHeaders() });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao listar pools.');
  return data.pools as ConnectionPool[];
}

export async function createConnectionPool(
  payload: Pick<ConnectionPool, 'name' | 'connectionIds' | 'channelWeights' | 'strategy'>
): Promise<ConnectionPool> {
  const res = await fetch(apiUrl('/api/connection-pools'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao criar pool.');
  return data.pool as ConnectionPool;
}

export async function updateConnectionPool(
  id: string,
  payload: Partial<Pick<ConnectionPool, 'name' | 'connectionIds' | 'channelWeights' | 'strategy'>>
): Promise<ConnectionPool> {
  const res = await fetch(apiUrl(`/api/connection-pools/${id}`), {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao atualizar pool.');
  return data.pool as ConnectionPool;
}

export async function deleteConnectionPool(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/connection-pools/${id}`), {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao excluir pool.');
}
