/**
 * Repara ownerUid em connections_settings.json usando zapmass.users (Postgres).
 *
 * Uso na VPS:
 *   npm run repair:connection-owners
 *   npm run repair:connection-owners -- --apply
 *   npm run repair:connection-owners -- --assign conn_1781020701080_1 --email usuario@exemplo.com --apply
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

type UserRow = { id: string; email: string; firebase_uid: string | null };
type SettingsRow = { ownerUid?: string; friendlyName?: string };

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const assignIdx = argv.indexOf('--assign');
  if (assignIdx >= 0) {
    const connId = argv[assignIdx + 1]?.trim();
    const emailIdx = argv.indexOf('--email', assignIdx);
    const email = emailIdx >= 0 ? argv[emailIdx + 1]?.trim() : '';
    return { mode: 'assign' as const, apply, connId, email };
  }
  return { mode: 'normalize' as const, apply };
}

function resolveDataDir(): string {
  return path.resolve(process.cwd(), process.env.DATA_DIR || 'data');
}

async function loadUsers(): Promise<UserRow[]> {
  const { getZapmassPool } = await import('../server/db/postgres.js');
  const pool = getZapmassPool();
  if (!pool) {
    console.error('[repair] Postgres indisponível (ZAPMASS_DATABASE_URL).');
    process.exit(1);
  }
  const r = await pool.query<UserRow>(
    `SELECT id::text, email, firebase_uid FROM zapmass.users ORDER BY email`
  );
  return r.rows;
}

function resolveCanonicalOwner(raw: string, users: UserRow[]): string | null {
  const u = raw.trim();
  if (!u) return null;
  const byFirebase = users.find((row) => row.firebase_uid === u);
  if (byFirebase) return byFirebase.id;
  const byId = users.find((row) => row.id === u);
  if (byId) return byId.id;
  return null;
}

function backup(file: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, bak);
  console.log(`[repair] Backup: ${bak}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settingsFile = path.join(resolveDataDir(), 'connections_settings.json');
  if (!fs.existsSync(settingsFile)) {
    console.error(`[repair] Não encontrado: ${settingsFile}`);
    process.exit(1);
  }

  const users = await loadUsers();
  console.log('\n=== Utilizadores Postgres ===');
  for (const u of users) {
    console.log(`${u.id} | ${u.email} | firebase_uid=${u.firebase_uid ?? '-'}`);
  }

  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, SettingsRow>;

  if (args.mode === 'assign') {
    if (!args.connId || !args.email) {
      console.error('Uso: --assign <conn_id> --email <email> [--apply]');
      process.exit(1);
    }
    const target = users.find((u) => u.email.toLowerCase() === args.email!.toLowerCase());
    if (!target) {
      console.error(`[repair] E-mail não encontrado: ${args.email}`);
      process.exit(1);
    }
    const row = settings[args.connId];
    if (!row) {
      console.error(`[repair] Canal ausente: ${args.connId}`);
      process.exit(1);
    }
    const prior = row.ownerUid ?? '(sem dono)';
    console.log(`\n[repair] ${args.connId} (${row.friendlyName ?? '-'})`);
    console.log(`  ${prior} → ${target.id} (${target.email})`);
    if (!args.apply) {
      console.log('\nAdicione --apply para gravar.');
      return;
    }
    backup(settingsFile);
    row.ownerUid = target.id;
    settings[args.connId] = row;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    console.log('[repair] OK. Reinicie: docker restart zapmass-zapmass-1');
    return;
  }

  console.log('\n=== Canais (antes) ===');
  const pending: { connId: string; from: string; to: string; name?: string }[] = [];
  for (const [connId, row] of Object.entries(settings).sort(([a], [b]) => a.localeCompare(b))) {
    const raw = row.ownerUid?.trim() ?? '';
    const canonical = raw ? resolveCanonicalOwner(raw, users) : null;
    const email = canonical ? users.find((u) => u.id === canonical)?.email : '-';
    console.log(
      `${connId} | ${row.friendlyName ?? connId} | ownerUid=${raw || '(órfão)'} | postgres=${canonical ?? '-'} | ${email}`
    );
    if (canonical && canonical !== raw) {
      pending.push({ connId, from: raw, to: canonical, name: row.friendlyName });
    }
  }

  if (pending.length === 0) {
    console.log('\n[repair] Nenhuma normalização pendente.');
    console.log('Para mover canal entre contas:');
    console.log('  npm run repair:connection-owners -- --assign conn_ID --email dono@email.com --apply');
    return;
  }

  console.log(`\n[repair] ${pending.length} canal(is) para normalizar:`);
  for (const p of pending) {
    console.log(`  ${p.connId} (${p.name ?? '-'}) : ${p.from} → ${p.to}`);
  }

  if (!args.apply) {
    console.log('\nAdicione --apply para gravar.');
    return;
  }

  backup(settingsFile);
  for (const p of pending) {
    settings[p.connId] = { ...settings[p.connId], ownerUid: p.to };
  }
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  console.log('[repair] OK. Reinicie: docker restart zapmass-zapmass-1');
}

main().catch((e) => {
  console.error('[repair] Falha:', e instanceof Error ? e.message : e);
  process.exit(1);
});
