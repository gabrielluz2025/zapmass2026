import pg from 'pg';

/** Garante que zapmass_db existe (volume Postgres já inicializado só com evolution_db). */
export async function ensureZapmassDatabaseExists(
  zapmassUrl: string,
  dbName = 'zapmass_db'
): Promise<void> {
  const admin = new URL(zapmassUrl);
  admin.pathname = '/postgres';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${dbName.replace(/[^a-zA-Z0-9_]/g, '')}`);
      console.log(`[ZapmassDB] Base ${dbName} criada.`);
    }
  } finally {
    await client.end();
  }
}
