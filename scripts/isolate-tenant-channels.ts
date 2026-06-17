/**
 * Isola canais/conversas por tenant — corrige ownerUid errado após migração legada.
 *
 * Uso na VPS (container demo):
 *   npx tsx scripts/isolate-tenant-channels.ts           # dry-run
 *   npx tsx scripts/isolate-tenant-channels.ts --apply  # grava + migra Postgres
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

type UserRow = { id: string; email: string };
type SettingsRow = { ownerUid?: string; createdByUid?: string; friendlyName?: string };

const GABRIEL_EMAIL = 'festaimportgabriel@gmail.com';
const PATY_EMAIL = 'paty.contact@gmail.com';
const SYLVESTER_EMAIL = 'sylvesterstallonealvesdasilva@gmail.com';

/** Regras: primeiro match ganha (ordem importa). */
const RULES: { test: (connId: string, label: string) => boolean; email: string; note: string }[] = [
  {
    test: (_id, label) => /patr[ií]cia|marcondes|paty/i.test(label),
    email: PATY_EMAIL,
    note: 'Canal Patrícia → paty.contact@gmail.com'
  },
  {
    test: (_id, label) => /sylvester|stallone/i.test(label),
    email: SYLVESTER_EMAIL,
    note: 'Canal Sylvester → sylvesterstallonealvesdasilva@gmail.com'
  }
];

const GABRIEL_KEEP = [
  /^gabriel$/i,
  /^zap-?mass$/i,
  /jeisi|marchiore/i
];

function parseArgs() {
  return { apply: process.argv.includes('--apply') };
}

function resolveDataDir(): string {
  return path.resolve(process.cwd(), process.env.DATA_DIR || 'data');
}

function backup(file: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, bak);
  console.log(`[isolate] Backup: ${bak}`);
}

async function loadUsers(): Promise<UserRow[]> {
  const { getZapmassPool } = await import('../server/db/postgres.js');
  const pool = getZapmassPool();
  if (!pool) {
    console.error('[isolate] Postgres indisponível.');
    process.exit(1);
  }
  const r = await pool.query<UserRow>(`SELECT id::text, email FROM zapmass.users ORDER BY email`);
  return r.rows;
}

function userByEmail(users: UserRow[], email: string): UserRow | undefined {
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

function labelOf(connId: string, row: SettingsRow): string {
  return (row.friendlyName || connId).trim();
}

function isOrphanOffline(connId: string, row: SettingsRow): boolean {
  const label = labelOf(connId, row);
  if (label !== connId) return false;
  return /^conn_\d+_\d+$/.test(connId);
}

function targetEmail(connId: string, row: SettingsRow, gabrielId: string): string | null {
  const label = labelOf(connId, row);
  for (const rule of RULES) {
    if (rule.test(connId, label)) return rule.email;
  }
  if (row.ownerUid === gabrielId && GABRIEL_KEEP.some((re) => re.test(label))) {
    return GABRIEL_EMAIL;
  }
  if (row.ownerUid === gabrielId && isOrphanOffline(connId, row)) {
    return null; // remover
  }
  return null;
}

async function migrateChatForConnection(
  fromTenantId: string,
  toTenantId: string,
  connectionId: string,
  apply: boolean
): Promise<{ threads: number; messages: number }> {
  const { getZapmassPool } = await import('../server/db/postgres.js');
  const pool = getZapmassPool();
  if (!pool) return { threads: 0, messages: 0 };

  const countR = await pool.query<{ threads: string; messages: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM zapmass.wa_chat_threads
        WHERE tenant_id = $1::uuid AND last_connection_id = $2) AS threads,
       (SELECT COUNT(*)::text FROM zapmass.wa_chat_messages m
        JOIN zapmass.wa_chat_threads t
          ON t.tenant_id = m.tenant_id AND t.thread_id = m.thread_id
        WHERE t.tenant_id = $1::uuid AND t.last_connection_id = $2) AS messages`,
    [fromTenantId, connectionId]
  );
  const threads = Number(countR.rows[0]?.threads || 0);
  const messages = Number(countR.rows[0]?.messages || 0);
  if (!apply || threads === 0) return { threads, messages };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO zapmass.wa_chat_threads
         (tenant_id, thread_id, contact_name, contact_phone, last_connection_id, updated_at, schema_version)
       SELECT $3::uuid, thread_id, contact_name, contact_phone, last_connection_id, updated_at, schema_version
       FROM zapmass.wa_chat_threads
       WHERE tenant_id = $1::uuid AND last_connection_id = $2
       ON CONFLICT (tenant_id, thread_id) DO UPDATE SET
         contact_name = EXCLUDED.contact_name,
         contact_phone = EXCLUDED.contact_phone,
         last_connection_id = EXCLUDED.last_connection_id,
         updated_at = EXCLUDED.updated_at`,
      [fromTenantId, connectionId, toTenantId]
    );

    await client.query(
      `INSERT INTO zapmass.wa_chat_messages
         (tenant_id, thread_id, message_id, text, sender, status, type, timestamp_ms,
          media_url, from_campaign, campaign_id, archived_at)
       SELECT $3::uuid, m.thread_id, m.message_id, m.text, m.sender, m.status, m.type, m.timestamp_ms,
              m.media_url, m.from_campaign, m.campaign_id, m.archived_at
       FROM zapmass.wa_chat_messages m
       JOIN zapmass.wa_chat_threads t
         ON t.tenant_id = m.tenant_id AND t.thread_id = m.thread_id
       WHERE t.tenant_id = $1::uuid AND t.last_connection_id = $2
       ON CONFLICT (tenant_id, thread_id, message_id) DO NOTHING`,
      [fromTenantId, connectionId, toTenantId]
    );

    await client.query(
      `DELETE FROM zapmass.wa_chat_threads
       WHERE tenant_id = $1::uuid AND last_connection_id = $2`,
      [fromTenantId, connectionId]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { threads, messages };
}

async function main() {
  const { apply } = parseArgs();
  const settingsFile = path.join(resolveDataDir(), 'connections_settings.json');
  if (!fs.existsSync(settingsFile)) {
    console.error(`[isolate] Não encontrado: ${settingsFile}`);
    process.exit(1);
  }

  const users = await loadUsers();
  const gabriel = userByEmail(users, GABRIEL_EMAIL);
  if (!gabriel) {
    console.error('[isolate] Conta Gabriel não encontrada.');
    process.exit(1);
  }

  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, SettingsRow>;

  type Action =
    | { kind: 'assign'; connId: string; label: string; from: string; to: string; toEmail: string }
    | { kind: 'remove'; connId: string; label: string; reason: string };

  const actions: Action[] = [];

  for (const [connId, row] of Object.entries(settings)) {
    const label = labelOf(connId, row);
    const current = row.ownerUid?.trim() || '(sem)';
    const email = targetEmail(connId, row, gabriel.id);

    if (email === null) {
      if (isOrphanOffline(connId, row) && (current === gabriel.id || current === '(sem)')) {
        actions.push({ kind: 'remove', connId, label, reason: 'Canal offline órfão (sem nome)' });
      }
      continue;
    }

    const target = userByEmail(users, email);
    if (!target) {
      console.warn(`[isolate] E-mail alvo ausente: ${email} (${connId})`);
      continue;
    }
    if (current === target.id) continue;

    actions.push({
      kind: 'assign',
      connId,
      label,
      from: current,
      to: target.id,
      toEmail: target.email
    });
  }

  console.log(`\n=== Isolamento de canais (${apply ? 'APLICAR' : 'simulação'}) ===\n`);
  if (actions.length === 0) {
    console.log('Nada a alterar.');
    return;
  }

  for (const a of actions) {
    if (a.kind === 'assign') {
      console.log(`  ATRIBUIR ${a.connId} (${a.label})`);
      console.log(`    ${a.from} → ${a.to} (${a.toEmail})`);
    } else {
      console.log(`  REMOVER ${a.connId} (${a.label}) — ${a.reason}`);
    }
  }

  if (!apply) {
    console.log('\nAdicione --apply para gravar e migrar conversas no Postgres.');
    return;
  }

  backup(settingsFile);

  for (const a of actions) {
    if (a.kind === 'remove') {
      delete settings[a.connId];
      continue;
    }
    const prevOwner = settings[a.connId].ownerUid?.trim() || gabriel.id;
    settings[a.connId] = {
      ...settings[a.connId],
      ownerUid: a.to,
      createdByUid: a.to
    };
    if (prevOwner !== a.to) {
      const migrated = await migrateChatForConnection(prevOwner, a.to, a.connId, true);
      if (migrated.threads > 0) {
        console.log(
          `[isolate] Postgres: ${a.connId} — ${migrated.threads} thread(s), ${migrated.messages} msg(s) migradas`
        );
      }
    }
  }

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  console.log('\n[isolate] connections_settings.json atualizado.');
  console.log('[isolate] Reinicie: docker restart zapmass-cli-demo');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
