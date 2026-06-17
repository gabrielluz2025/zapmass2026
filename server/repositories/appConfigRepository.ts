import { getZapmassPool } from '../db/postgres.js';
import type { AppConfigGlobal } from '../appConfigStore.js';
import { parseSystemAnnouncement, type SystemAnnouncement } from '../systemAnnouncement.js';

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
  const raw = (await loadAppConfigPg()) || {};
  await pool.query(
    `INSERT INTO zapmass.app_config_global (id, doc, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET doc = $2::jsonb, updated_at = now()`,
    [GLOBAL_ID, JSON.stringify({ ...raw, ...doc })]
  );
}

export async function loadSystemAnnouncementPg(): Promise<SystemAnnouncement | null> {
  const raw = await loadAppConfigPg();
  return parseSystemAnnouncement(raw?.systemAnnouncement);
}

export async function saveSystemAnnouncementPg(
  announcement: SystemAnnouncement | null
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const raw = (await loadAppConfigPg()) || {};
  const next = { ...raw };
  if (announcement) {
    next.systemAnnouncement = announcement;
  } else {
    delete next.systemAnnouncement;
  }
  await pool.query(
    `INSERT INTO zapmass.app_config_global (id, doc, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET doc = $2::jsonb, updated_at = now()`,
    [GLOBAL_ID, JSON.stringify(next)]
  );
}
