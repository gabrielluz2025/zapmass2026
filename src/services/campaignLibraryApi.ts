import { apiFetchJson } from '../utils/apiFetchAuth';

export interface LibraryItem<T = Record<string, unknown>> {
  id: string;
  name: string;
  doc: T;
  createdAt: string;
  updatedAt: string;
}

type Kind = 'templates' | 'segments';

export async function listLibrary<T = Record<string, unknown>>(kind: Kind): Promise<LibraryItem<T>[]> {
  const j = await apiFetchJson<{ items?: LibraryItem<T>[] }>(`/api/campaign-library/${kind}`);
  return Array.isArray(j.items) ? j.items : [];
}

export async function createLibraryItem<T = Record<string, unknown>>(
  kind: Kind,
  name: string,
  doc: T
): Promise<LibraryItem<T>> {
  const j = await apiFetchJson<{ item: LibraryItem<T> }>(`/api/campaign-library/${kind}`, {
    method: 'POST',
    body: JSON.stringify({ name, doc })
  });
  return j.item;
}

export async function deleteLibraryItem(kind: Kind, id: string): Promise<void> {
  await apiFetchJson(`/api/campaign-library/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
