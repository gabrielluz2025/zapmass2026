/**
 * Dedupe da inbox persistida no Postgres (`wa_inbox_conversations`) + limpeza de nomes lixo
 * ("0", JID cru `5547...@s.whatsapp.net`) em `wa_inbox_conversations` e `wa_chat_threads`.
 *
 * Usa a MESMA regra do servidor (`canonicalizeInboxList`): mesmo telefone + mesmo chip = 1 thread
 * (id preferido @s.whatsapp.net), fichas "0"/JID curto/broadcast/@lid vazio saem da lista.
 * Nunca junta por nome de exibição.
 *
 * SEGURANÇA: padrão é DRY-RUN. `--apply` marca duplicatas/lixo como `deleted = true` (soft delete)
 * e corrige nomes. A RAM do servidor é limpa no boot (v2.3.368+) ou via
 * `POST /api/admin/dedupe-inbox-ram` — este script cuida só do que está no Postgres.
 *
 * Uso na VPS (container da API, cwd /app):
 *   docker exec -w /app zapmass-zapmass-1 npm run dedupe:inbox -- --tenant <uuid>
 *   docker exec -w /app zapmass-zapmass-1 npm run dedupe:inbox -- --apply --tenant <uuid>
 */
import dotenv from 'dotenv';
import { getZapmassPool, closeZapmassPool } from '../server/db/postgres.js';
import { canonicalizeInboxList } from '../src/utils/collapseConversationsByPhone.js';
import type { Conversation } from '../server/types.js';

dotenv.config();

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const tenantIdx = argv.indexOf('--tenant');
  const tenant = tenantIdx >= 0 ? argv[tenantIdx + 1]?.trim() : undefined;
  return { apply, tenant };
}

type InboxRow = {
  tenant_id: string;
  conversation_id: string;
  connection_id: string;
  contact_name: string;
  contact_phone: string;
  last_message: string;
  last_msg_ts: string;
  unread_count: number;
};

function rowToConversation(row: InboxRow): Conversation {
  const ts = Number(row.last_msg_ts) || 0;
  return {
    id: row.conversation_id,
    connectionId: row.connection_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    unreadCount: Number(row.unread_count) || 0,
    lastMessage: row.last_message,
    lastMessageTime: '',
    lastMessageTimestamp: ts,
    messages: [],
    tags: [],
  };
}

async function main(): Promise<void> {
  const { apply, tenant } = parseArgs(process.argv.slice(2));
  const pool = getZapmassPool();
  if (!pool) {
    console.error('Postgres indisponível (ZAPMASS_DATABASE_URL / modo VPS).');
    process.exitCode = 1;
    return;
  }

  console.log(`[dedupe-inbox] modo=${apply ? 'APPLY' : 'DRY-RUN'} tenant=${tenant || '(todos)'}`);

  const rows = await pool.query<InboxRow>(
    `SELECT tenant_id::text, conversation_id, connection_id, contact_name, contact_phone,
            last_message, last_msg_ts::text, unread_count
     FROM zapmass.wa_inbox_conversations
     WHERE deleted = false AND ($1::uuid IS NULL OR tenant_id = $1::uuid)`,
    [tenant || null]
  );

  const byTenant = new Map<string, InboxRow[]>();
  for (const r of rows.rows) {
    const bucket = byTenant.get(r.tenant_id) || [];
    bucket.push(r);
    byTenant.set(r.tenant_id, bucket);
  }

  let totalDrop = 0;
  const dropByTenant = new Map<string, string[]>();
  for (const [tenantId, list] of byTenant) {
    const result = canonicalizeInboxList(list.map(rowToConversation));
    const kept = new Set(result.list.map((c) => c.id));
    const drop = list.map((r) => r.conversation_id).filter((id) => !kept.has(id));
    if (drop.length === 0) continue;
    dropByTenant.set(tenantId, drop);
    totalDrop += drop.length;
    console.log(
      `[dedupe-inbox] tenant ${tenantId}: ${list.length} -> ${result.list.length} ` +
        `(${result.aliases.size} fundidas, ${result.junkIds.length} lixo)`
    );
    for (const id of drop.slice(0, 30)) {
      const alias = result.aliases.get(id);
      console.log(`    - ${id}${alias ? `  => ${alias}` : '  (lixo)'}`);
    }
    if (drop.length > 30) console.log(`    ... +${drop.length - 30}`);
  }

  const dirtyNames = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM zapmass.wa_chat_threads
     WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid)
       AND (contact_name = '0' OR contact_name LIKE '%@%')`,
    [tenant || null]
  );
  console.log(
    `[dedupe-inbox] total a remover/fundir: ${totalDrop}; nomes lixo em wa_chat_threads: ${dirtyNames.rows[0]?.n ?? '0'}`
  );

  if (!apply) {
    console.log('[dedupe-inbox] DRY-RUN: nada alterado. Rode com --apply para gravar.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [tenantId, ids] of dropByTenant) {
      await client.query(
        `UPDATE zapmass.wa_inbox_conversations
         SET deleted = true, updated_at = now()
         WHERE tenant_id = $1::uuid AND conversation_id = ANY($2::text[])`,
        [tenantId, ids]
      );
    }
    const fixedThreads = await client.query(
      `UPDATE zapmass.wa_chat_threads
       SET contact_name = CASE
             WHEN length(regexp_replace(contact_phone, '\\D', '', 'g')) BETWEEN 8 AND 13
               THEN '+' || regexp_replace(contact_phone, '\\D', '', 'g')
             ELSE 'Contato'
           END,
           updated_at = now()
       WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid)
         AND (contact_name = '0' OR contact_name LIKE '%@%')`,
      [tenant || null]
    );
    const fixedInbox = await client.query(
      `UPDATE zapmass.wa_inbox_conversations
       SET contact_name = CASE
             WHEN length(regexp_replace(contact_phone, '\\D', '', 'g')) BETWEEN 8 AND 13
               THEN '+' || regexp_replace(contact_phone, '\\D', '', 'g')
             ELSE 'Contato'
           END,
           updated_at = now()
       WHERE deleted = false AND ($1::uuid IS NULL OR tenant_id = $1::uuid)
         AND (contact_name = '0' OR contact_name LIKE '%@%')`,
      [tenant || null]
    );
    await client.query('COMMIT');
    console.log(
      `[dedupe-inbox] APPLY ok: ${totalDrop} marcadas deleted, ` +
        `${fixedThreads.rowCount ?? 0} nomes em wa_chat_threads, ${fixedInbox.rowCount ?? 0} em wa_inbox_conversations.`
    );
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

main()
  .catch((e) => {
    console.error('[dedupe-inbox] falhou:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeZapmassPool().catch(() => undefined));
