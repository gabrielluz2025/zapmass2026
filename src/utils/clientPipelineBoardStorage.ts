export interface PipelineColumnDef {
  id: string;
  name: string;
}

export interface ClientPipelineBoardPersisted {
  version: 1;
  columns: PipelineColumnDef[];
  /** conversationId -> columnId */
  cardColumn: Record<string, string>;
}

const STORAGE_PREFIX = 'zapmass-client-pipeline-v1:';

export const defaultPipelineColumns = (): PipelineColumnDef[] => [
  { id: 'col_novo', name: 'Novo' },
  { id: 'col_contato', name: 'Em contato' },
  { id: 'col_proposta', name: 'Proposta' },
  { id: 'col_ganho', name: 'Ganho' }
];

export function defaultPipelineState(): ClientPipelineBoardPersisted {
  return {
    version: 1,
    columns: defaultPipelineColumns(),
    cardColumn: {}
  };
}

function normalizeLoaded(raw: unknown): ClientPipelineBoardPersisted {
  const base = defaultPipelineState();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return base;
  const cols = Array.isArray(o.columns) ? o.columns : [];
  const columns: PipelineColumnDef[] = cols
    .filter((c: unknown) => c && typeof c === 'object' && typeof (c as PipelineColumnDef).id === 'string')
    .map((c: unknown) => ({
      id: String((c as PipelineColumnDef).id),
      name: String((c as PipelineColumnDef).name || 'Coluna')
    }));
  const cardColumn =
    o.cardColumn && typeof o.cardColumn === 'object' && !Array.isArray(o.cardColumn)
      ? { ...(o.cardColumn as Record<string, string>) }
      : {};
  if (columns.length === 0) return base;
  const colIds = new Set(columns.map((c) => c.id));
  for (const [convId, colId] of Object.entries(cardColumn)) {
    if (!colIds.has(colId)) cardColumn[convId] = columns[0].id;
  }
  return { version: 1, columns, cardColumn };
}

export function loadClientPipeline(uid: string | null | undefined): ClientPipelineBoardPersisted {
  const key = `${STORAGE_PREFIX}${uid || 'anon'}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultPipelineState();
    return normalizeLoaded(JSON.parse(raw));
  } catch {
    return defaultPipelineState();
  }
}

export function saveClientPipeline(uid: string | null | undefined, data: ClientPipelineBoardPersisted) {
  const key = `${STORAGE_PREFIX}${uid || 'anon'}`;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}
