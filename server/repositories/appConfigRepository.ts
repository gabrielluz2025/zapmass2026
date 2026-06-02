import { getZapmassPool } from '../db/postgres.js';
import type { AppConfigGlobal } from '../appConfigStore.js';

const GLOBAL_ID = 'global';

export async function loadAppConfigPg(): Promise<Record<string, unknown> | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<{ doc: Record<string, unknown> }>(
    `SELECT doc FROM zapmass.app_config_global WHERE id = $1`,
    [GLOBAL_ID]
  );
  return r.rows[0]?.doc ?? null;
}

export async function saveAppConfigPg(doc: AppConfigGlobal): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO zapmass.app_config_global (id, doc, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET doc = $2::jsonb, updated_at = now()`,
    [GLOBAL_ID, JSON.stringify(doc)]
  );
}
