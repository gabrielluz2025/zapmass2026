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
import {
  migrateChatForConnection,
  planConnectionOwnerReconciliation,
  type ConnectionSettingsRow
} from '../server/reconcileConnectionOwners.js';

dotenv.config();

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

async function main() {
  const { apply } = parseArgs();
  const settingsFile = path.join(resolveDataDir(), 'connections_settings.json');
  if (!fs.existsSync(settingsFile)) {
    console.error(`[isolate] Não encontrado: ${settingsFile}`);
    process.exit(1);
  }

  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, ConnectionSettingsRow>;
  const actions = await planConnectionOwnerReconciliation(settings);

  console.log(`\n=== Isolamento de canais (${apply ? 'APLICAR' : 'simulação'}) ===\n`);
  if (actions.length === 0) {
    console.log('Nada a alterar.');
    return;
  }

  for (const a of actions) {
    if (a.kind === 'assign') {
      console.log(`  ATRIBUIR ${a.connId} (${a.label})`);
      console.log(`    ${a.fromOwnerUid ?? '(sem)'} → ${a.toOwnerUid} (${a.toEmail})`);
      console.log(`    ${a.reason}`);
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

    const prevOwner = a.fromOwnerUid?.trim();
    settings[a.connId] = {
      ...settings[a.connId],
      ownerUid: a.toOwnerUid,
      createdByUid: a.toOwnerUid
    };

    if (prevOwner && prevOwner !== a.toOwnerUid) {
      const migrated = await migrateChatForConnection(prevOwner, a.toOwnerUid, a.connId);
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
