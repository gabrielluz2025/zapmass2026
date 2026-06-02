import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureZapmassDatabaseExists } from './ensureZapmassDatabase.js';
import { vpsAuthEnabled } from '../auth/authMode.js';
import { vpsDataEnabled } from '../auth/dataMode.js';
import { getZapmassPool, isZapmassPostgresConfigured, zapmassDatabaseUrl } from './postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runZapmassMigrations(): Promise<void> {
  if (!vpsAuthEnabled() && !vpsDataEnabled()) return;
  if (!isZapmassPostgresConfigured()) return;

  const url = zapmassDatabaseUrl();
  try {
    await ensureZapmassDatabaseExists(url);
  } catch (e) {
    console.warn('[ZapmassDB] ensure database:', (e as Error)?.message || e);
  }

  const pool = getZapmassPool();
  if (!pool) return;

  const dir = path.join(__dirname, 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS zapmass');
    await client.query(`
      CREATE TABLE IF NOT EXISTS zapmass.schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const id = file;
      const applied = await client.query(
        'SELECT 1 FROM zapmass.schema_migrations WHERE id = $1',
        [id]
      );
      if (applied.rowCount && applied.rowCount > 0) continue;

      const sql = readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO zapmass.schema_migrations (id) VALUES ($1)', [id]);
        await client.query('COMMIT');
        console.log(`[ZapmassDB] Migration aplicada: ${id}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    client.release();
  }
}
