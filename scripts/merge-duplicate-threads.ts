/**
 * Une threads duplicadas no Postgres (`wa_chat_threads`) do mesmo contato lógico
 * (@lid vs @s.whatsapp.net, variantes BR com/sem 9º dígito quando DDD ≤ 27).
 *
 * Para cada cluster no mesmo `last_connection_id`:
 * - Mantém a thread canônica (mais mensagens; empate: `updated_at` mais recente; empate: `p_*` > `lid_*`)
 * - Move `wa_chat_messages` para a canônica (dedupe por message_id)
 * - Remove threads órfãs e reconcilia `wa_inbox_conversations` quando aplicável
 *
 * SEGURANÇA:
 * - Padrão é DRY-RUN (`--dry-run` explícito ou omitido): só imprime o plano.
 * - Com `--apply` executa UPDATE/DELETE em transação por cluster.
 *
 * Uso na VPS (container da API, cwd /app):
 *   docker exec -w /app zapmass-zapmass-1 npm run merge:duplicate-threads -- --dry-run
 *   docker exec -w /app zapmass-zapmass-1 npm run merge:duplicate-threads -- --dry-run --tenant <uuid>
 *   docker exec -w /app zapmass-zapmass-1 npm run merge:duplicate-threads -- --apply --tenant <uuid>
 */
import dotenv from 'dotenv';
import { getZapmassPool, closeZapmassPool } from '../server/db/postgres.js';
import { contactPhoneLookupVariants } from '../server/contactIdentity/contactPhone.js';
import {
  brInboxMergeKeyIgnoreNinthWhenDddLe27,
  inboxMergeEquivalenceKeys,
  localDigitsFromWaAddress,
  looksLikeLongLidDigits,
} from '../src/utils/contactPhoneLookup.js';

dotenv.config();

type ThreadRow = {
  thread_id: string;
  contact_name: string;
  contact_phone: string;
  last_connection_id: string;
  updated_at: Date;
  msg_count: string;
};

type MergePlan = {
  tenantId: string;
  connectionId: string;
  canonical: ThreadRow;
  duplicates: ThreadRow[];
  keys: string[];
};

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const tenantIdx = argv.indexOf('--tenant');
  const tenant = tenantIdx >= 0 ? argv[tenantIdx + 1]?.trim() : undefined;
  return { apply, tenant };
}

function threadRank(threadId: string): number {
  if (threadId.startsWith('p_')) return 3;
  if (threadId.startsWith('lid_')) return 1;
  if (threadId.startsWith('grp_')) return 2;
  return 0;
}

function mergeKeysForThread(row: ThreadRow): string[] {
  const keys = new Set<string>();
  const conn = row.last_connection_id || '_';
  const cp = String(row.contact_phone || '').trim();
  const cpLower = cp.toLowerCase();

  if (cpLower.endsWith('@lid')) {
    keys.add(`jid:${conn}:${cpLower}`);
    const lidLocal = localDigitsFromWaAddress(cp);
    if (lidLocal.length >= 10 && lidLocal.length <= 13 && !looksLikeLongLidDigits(lidLocal)) {
      for (const k of inboxMergeEquivalenceKeys(lidLocal)) keys.add(`${conn}:${k}`);
    } else if (lidLocal.length > 13) {
      keys.add(`${conn}:lidtail:${lidLocal.slice(-11)}`);
    }
  }

  const digits = localDigitsFromWaAddress(cp);
  if (digits.length >= 10 && digits.length <= 13 && !looksLikeLongLidDigits(digits)) {
    for (const k of inboxMergeEquivalenceKeys(digits)) keys.add(`${conn}:${k}`);
    for (const v of contactPhoneLookupVariants(digits)) {
      for (const k of inboxMergeEquivalenceKeys(v)) keys.add(`${conn}:${k}`);
    }
  }

  if (row.thread_id.startsWith('lid_')) {
    keys.add(`${conn}:thread:${row.thread_id}`);
  }

  const br9 = brInboxMergeKeyIgnoreNinthWhenDddLe27(digits);
  if (br9) keys.add(`${conn}:${br9}`);

  return Array.from(keys);
}

function pickCanonical(members: ThreadRow[]): ThreadRow {
  return [...members].sort((a, b) => {
    const mc = Number(b.msg_count) - Number(a.msg_count);
    if (mc !== 0) return mc;
    const ta = a.updated_at?.getTime?.() ?? 0;
    const tb = b.updated_at?.getTime?.() ?? 0;
    if (tb !== ta) return tb - ta;
    const rankDiff = threadRank(b.thread_id) - threadRank(a.thread_id);
    if (rankDiff !== 0) return rankDiff;
    return a.thread_id.localeCompare(b.thread_id);
  })[0]!;
}

function clusterThreads(rows: ThreadRow[]): ThreadRow[][] {
  const parent = new Map<number, number>();
  const keyToIdx = new Map<string, number>();
  const find = (i: number): number => {
    let root = i;
    while (true) {
      const p = parent.get(root);
      if (p == null || p === root) return root;
      root = p;
    }
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (let i = 0; i < rows.length; i++) parent.set(i, i);

  for (let i = 0; i < rows.length; i++) {
    const keys = mergeKeysForThread(rows[i]!);
    for (const k of keys) {
      const prev = keyToIdx.get(k);
      if (prev != null) unite(i, prev);
      else keyToIdx.set(k, i);
    }
  }

  const clusters = new Map<number, ThreadRow[]>();
  for (let i = 0; i < rows.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(rows[i]!);
  }
  return [...clusters.values()].filter((c) => c.length > 1);
}

function conversationIdsForThread(row: ThreadRow): string[] {
  const conn = row.last_connection_id;
  if (!conn) return [];
  const cp = String(row.contact_phone || '').trim();
  const out = new Set<string>();
  if (cp.toLowerCase().endsWith('@lid')) {
    out.add(`${conn}:${cp}`);
  }
  const digits = localDigitsFromWaAddress(cp);
  if (digits.length >= 8 && !looksLikeLongLidDigits(digits)) {
    out.add(`${conn}:${digits}@s.whatsapp.net`);
    out.add(`${conn}:${digits}@c.us`);
  }
  return [...out];
}

async function listTenants(onlyTenant?: string): Promise<string[]> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  if (onlyTenant) return [onlyTenant];
  const r = await pool.query<{ id: string }>(`SELECT id::text FROM zapmass.users ORDER BY created_at`);
  return r.rows.map((x) => x.id);
}

async function loadThreads(tenantId: string): Promise<ThreadRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<ThreadRow>(
    `SELECT t.thread_id, t.contact_name, t.contact_phone, t.last_connection_id, t.updated_at,
            COUNT(m.message_id)::text AS msg_count
     FROM zapmass.wa_chat_threads t
     LEFT JOIN zapmass.wa_chat_messages m
       ON m.tenant_id = t.tenant_id AND m.thread_id = t.thread_id
     WHERE t.tenant_id = $1::uuid
     GROUP BY t.thread_id, t.contact_name, t.contact_phone, t.last_connection_id, t.updated_at`,
    [tenantId]
  );
  return r.rows;
}

async function applyMergePlan(plan: MergePlan): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const dupeIds = plan.duplicates.map((d) => d.thread_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const dupeId of dupeIds) {
      await client.query(
        `DELETE FROM zapmass.wa_chat_messages dup
         WHERE dup.tenant_id = $1::uuid AND dup.thread_id = $2
           AND EXISTS (
             SELECT 1 FROM zapmass.wa_chat_messages keep
             WHERE keep.tenant_id = dup.tenant_id
               AND keep.thread_id = $3
               AND keep.message_id = dup.message_id
           )`,
        [plan.tenantId, dupeId, plan.canonical.thread_id]
      );
      await client.query(
        `UPDATE zapmass.wa_chat_messages
         SET thread_id = $3
         WHERE tenant_id = $1::uuid AND thread_id = $2`,
        [plan.tenantId, dupeId, plan.canonical.thread_id]
      );
    }

    const canonMeta = plan.canonical;
    await client.query(
      `UPDATE zapmass.wa_chat_threads
       SET contact_name = CASE WHEN length(trim($3)) > length(trim(contact_name)) THEN $3 ELSE contact_name END,
           contact_phone = CASE
             WHEN lower(trim(coalesce(contact_phone, ''))) LIKE '%@lid'
               AND lower(trim(coalesce($4, ''))) NOT LIKE '%@lid'
               AND length(regexp_replace(coalesce($4, ''), '\\D', '', 'g')) >= 10
             THEN $4
             ELSE contact_phone
           END,
           updated_at = GREATEST(updated_at, now())
       WHERE tenant_id = $1::uuid AND thread_id = $2`,
      [plan.tenantId, canonMeta.thread_id, canonMeta.contact_name, canonMeta.contact_phone]
    );

    await client.query(
      `DELETE FROM zapmass.wa_chat_threads
       WHERE tenant_id = $1::uuid AND thread_id = ANY($2::text[])`,
      [plan.tenantId, dupeIds]
    );

    const canonConvIds = new Set(conversationIdsForThread(plan.canonical));
    for (const dupe of plan.duplicates) {
      for (const convId of conversationIdsForThread(dupe)) {
        if (canonConvIds.size === 0) continue;
        const target = [...canonConvIds][0]!;
        await client.query(
          `UPDATE zapmass.wa_inbox_conversations
           SET deleted = true, updated_at = now()
           WHERE tenant_id = $1::uuid AND conversation_id = $2 AND conversation_id <> $3`,
          [plan.tenantId, convId, target]
        );
        await client.query(
          `UPDATE zapmass.wa_inbox_conversations
           SET conversation_id = $3,
               contact_phone = COALESCE(NULLIF(trim($4), ''), contact_phone),
               last_msg_ts = GREATEST(last_msg_ts, 0),
               deleted = false,
               updated_at = now()
           WHERE tenant_id = $1::uuid AND conversation_id = $2
             AND NOT EXISTS (
               SELECT 1 FROM zapmass.wa_inbox_conversations x
               WHERE x.tenant_id = $1::uuid AND x.conversation_id = $3
             )`,
          [plan.tenantId, convId, target, plan.canonical.contact_phone]
        );
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const { apply, tenant } = parseArgs(process.argv.slice(2));
  const pool = getZapmassPool();
  if (!pool) {
    console.error('POSTGRES indisponível — defina ZAPMASS_DATABASE_URL');
    process.exit(1);
  }

  const tenants = await listTenants(tenant);
  let totalPlans = 0;
  let totalDupes = 0;

  for (const tenantId of tenants) {
    const rows = await loadThreads(tenantId);
    const byConn = new Map<string, ThreadRow[]>();
    for (const row of rows) {
      const conn = row.last_connection_id || '_none_';
      if (!byConn.has(conn)) byConn.set(conn, []);
      byConn.get(conn)!.push(row);
    }

    for (const [connectionId, group] of byConn) {
      const clusters = clusterThreads(group);
      for (const cluster of clusters) {
        const canonical = pickCanonical(cluster);
        const duplicates = cluster.filter((t) => t.thread_id !== canonical.thread_id);
        if (duplicates.length === 0) continue;
        totalPlans += 1;
        totalDupes += duplicates.length;
        const plan: MergePlan = {
          tenantId,
          connectionId,
          canonical,
          duplicates,
          keys: mergeKeysForThread(canonical),
        };
        console.log(
          JSON.stringify({
            mode: apply ? 'apply' : 'dry-run',
            tenantId,
            connectionId,
            canonical: {
              thread_id: canonical.thread_id,
              contact_phone: canonical.contact_phone,
              msg_count: canonical.msg_count,
            },
            duplicates: duplicates.map((d) => ({
              thread_id: d.thread_id,
              contact_phone: d.contact_phone,
              msg_count: d.msg_count,
            })),
          })
        );
        if (apply) await applyMergePlan(plan);
      }
    }
  }

  console.log(
    `[merge-duplicate-threads] ${apply ? 'APLICADO' : 'DRY-RUN'}: ${totalPlans} cluster(s), ${totalDupes} thread(s) duplicada(s)`
  );
  if (!apply) {
    console.log('Nenhuma alteração gravada. Use --apply para executar.');
  }
  await closeZapmassPool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
