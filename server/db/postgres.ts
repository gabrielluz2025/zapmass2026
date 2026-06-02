import pg from 'pg';
import { vpsAuthEnabled } from '../auth/authMode.js';
import { vpsDataEnabled } from '../auth/dataMode.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function defaultDatabaseUrl(): string {
  const pass = process.env.POSTGRES_PASSWORD || 'evolution-secure-pass-2026';
  const host = process.env.ZAPMASS_PG_HOST || process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.ZAPMASS_PG_PORT || '5432';
  return `postgresql://postgres:${encodeURIComponent(pass)}@${host}:${port}/zapmass_db`;
}

export function zapmassDatabaseUrl(): string {
  return (process.env.ZAPMASS_DATABASE_URL || defaultDatabaseUrl()).trim();
}

export function isZapmassPostgresConfigured(): boolean {
  if (!vpsAuthEnabled() && !vpsDataEnabled()) return false;
  return zapmassDatabaseUrl().length > 0;
}

export function getZapmassPool(): pg.Pool | null {
  if (!isZapmassPostgresConfigured()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: zapmassDatabaseUrl(),
      max: Number(process.env.ZAPMASS_PG_POOL_MAX || 8),
      idleTimeoutMillis: 30_000
    });
    pool.on('error', (err) => {
      console.error('[ZapmassDB] pool error:', err?.message || err);
    });
  }
  return pool;
}

export async function closeZapmassPool(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}
