/** Query de listagem Evolution (findChats / findContacts).
 *
 * Versões antigas: `page` (1-based) + `offset` = tamanho da página (default 50).
 * Versões novas (fetchChats SQL): só respeitam `take` / `skip`.
 * Sem `take`, o SQL não tem LIMIT e pode estourar timeout — a inbox fica só com
 * o que chegou por webhook.
 */
export const EVO_FIND_PAGE_SIZE = 500;
export const EVO_FIND_MAX_PAGES = 40;

export function evolutionFindPageQuery(
  page: number,
  pageSize = EVO_FIND_PAGE_SIZE
): {
  where: Record<string, never>;
  page: number;
  offset: number;
  limit: number;
  take: number;
  skip: number;
} {
  const p = Math.max(1, Math.floor(Number(page)) || 1);
  const size = Math.max(1, Math.min(1000, Math.floor(Number(pageSize)) || EVO_FIND_PAGE_SIZE));
  return {
    where: {},
    page: p,
    offset: size,
    limit: size,
    take: size,
    skip: (p - 1) * size,
  };
}

export function extractEvolutionList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as Record<string, unknown>;
  for (const key of ['chats', 'contacts', 'records', 'data', 'result', 'response', 'messages'] as const) {
    const v = row[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const nested = v as Record<string, unknown>;
      if (Array.isArray(nested.chats)) return nested.chats;
      if (Array.isArray(nested.records)) return nested.records;
      if (Array.isArray(nested.contacts)) return nested.contacts;
      if (Array.isArray(nested.data)) return nested.data;
    }
  }
  return [];
}
