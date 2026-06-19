/**
 * Corrige (normaliza) nome, telefone e endereço de TODOS os contatos de TODOS os
 * tenants, de forma idempotente e offline (sem rede). Conserta:
 *  - Nome: mojibake, CAIXA ALTA / minúsculo → Title Case, espaços/invisíveis
 *  - Telefone: só dígitos + DDI 55 (padrão BR), remove 0 de tronco
 *  - Endereço: UF, troca cidade↔bairro, gazetteer, CEP no campo errado, abreviações
 *
 * SEGURANÇA:
 *  - Sem `--apply` => DRY-RUN: só mostra o relatório do que mudaria (não grava nada).
 *  - Com `--apply` => cria backup da tabela (zapmass.contacts_backup_<ts>) e grava.
 *
 * Uso na VPS (dentro do container da API):
 *   docker exec -w /app zapmass-zapmass-1 npm run normalize:all-contacts          # dry-run
 *   docker exec -w /app zapmass-zapmass-1 npm run normalize:all-contacts -- --apply
 *   ... -- --apply --tenant <uuid>        # só um tenant
 */
import dotenv from 'dotenv';
import type { Contact } from '../src/types.js';
import { getZapmassPool, closeZapmassPool } from '../server/db/postgres.js';
import { ensureIbgeMunicipiosIndex } from '../server/ibgeMunicipios.js';
import { listContacts, bulkUpdateContacts } from '../server/repositories/contactsRepository.js';
import { prepareContactForPersistence } from '../server/repositories/contactMapper.js';

dotenv.config();

const PAGE_SIZE = 5000;
const UPDATE_CHUNK = 200;
const ADDRESS_FIELDS = ['city', 'state', 'neighborhood', 'street', 'zipCode', 'number'] as const;
const TRACKED_FIELDS = ['name', 'phone', ...ADDRESS_FIELDS] as const;
type TrackedField = (typeof TRACKED_FIELDS)[number];

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const tenantIdx = argv.indexOf('--tenant');
  const tenant = tenantIdx >= 0 ? argv[tenantIdx + 1]?.trim() : undefined;
  return { apply, tenant };
}

function clean(v: unknown): string {
  return String(v ?? '').trim();
}

interface TenantRow {
  id: string;
  email: string;
}

async function listTenants(onlyTenant?: string): Promise<TenantRow[]> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE (verifique ZAPMASS_DATABASE_URL / auth vps)');
  if (onlyTenant) {
    const r = await pool.query<TenantRow>(
      `SELECT id::text, email FROM zapmass.users WHERE id = $1::uuid`,
      [onlyTenant]
    );
    return r.rows;
  }
  const r = await pool.query<TenantRow>(
    `SELECT id::text, email FROM zapmass.users ORDER BY created_at`
  );
  return r.rows;
}

async function backupContactsTable(): Promise<string> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');
  const stamp = new Date().toISOString().replace(/[:.TZ-]/g, '').slice(0, 14);
  const table = `zapmass.contacts_backup_${stamp}`;
  await pool.query(`CREATE TABLE ${table} AS TABLE zapmass.contacts`);
  return table;
}

interface FieldChange {
  field: TrackedField;
  before: string;
  after: string;
}

function diffContact(existing: Contact): { updates: Partial<Contact>; changes: FieldChange[] } {
  const prepared = prepareContactForPersistence(existing);
  const updates: Partial<Contact> = {};
  const changes: FieldChange[] = [];

  for (const field of TRACKED_FIELDS) {
    const before = clean(existing[field]);
    const after = clean(prepared[field]);
    // Não apaga valor existente com vazio: só registra quando há um valor novo e diferente.
    if (after && after !== before) {
      (updates as Record<string, unknown>)[field] = prepared[field];
      changes.push({ field, before, after });
    }
  }

  const addressChanged = changes.some((c) => (ADDRESS_FIELDS as readonly string[]).includes(c.field));
  if (addressChanged) {
    updates.latitude = undefined;
    updates.longitude = undefined;
    updates.geocodedAt = undefined;
    updates.geocodePrecision = undefined;
  }

  return { updates, changes };
}

async function main() {
  const { apply, tenant } = parseArgs(process.argv.slice(2));

  console.log(`\n=== Normalização de contatos (${apply ? 'APLICAR' : 'DRY-RUN'}) ===\n`);
  await ensureIbgeMunicipiosIndex().catch(() => null);

  const tenants = await listTenants(tenant);
  if (tenants.length === 0) {
    console.log('Nenhum tenant encontrado.');
    await closeZapmassPool();
    return;
  }

  let backupTable = '';
  if (apply) {
    backupTable = await backupContactsTable();
    console.log(`Backup criado: ${backupTable}\n`);
  } else {
    console.log('DRY-RUN: nada será gravado. Rode com --apply para corrigir de verdade.\n');
  }

  const fieldTotals: Record<TrackedField, number> = {
    name: 0, phone: 0, city: 0, state: 0, neighborhood: 0, street: 0, zipCode: 0, number: 0
  };
  const samples: string[] = [];
  let grandScanned = 0;
  let grandChanged = 0;

  for (const t of tenants) {
    let scanned = 0;
    let changed = 0;
    let offset = 0;

    for (;;) {
      const page = await listContacts(t.id, { limit: PAGE_SIZE, offset });
      if (page.length === 0) break;
      offset += page.length;
      scanned += page.length;

      const items: Array<{ id: string; updates: Partial<Contact> }> = [];
      for (const c of page) {
        const { updates, changes } = diffContact(c);
        if (changes.length === 0) continue;
        changed++;
        for (const ch of changes) {
          fieldTotals[ch.field]++;
          if (samples.length < 20) {
            samples.push(`  [${ch.field}] "${ch.before}" → "${ch.after}"`);
          }
        }
        items.push({ id: c.id, updates });
      }

      if (apply && items.length > 0) {
        for (let i = 0; i < items.length; i += UPDATE_CHUNK) {
          await bulkUpdateContacts(t.id, items.slice(i, i + UPDATE_CHUNK));
        }
      }

      if (page.length < PAGE_SIZE) break;
    }

    grandScanned += scanned;
    grandChanged += changed;
    console.log(`tenant ${t.email} (${t.id}): ${scanned} lidos, ${changed} ${apply ? 'corrigidos' : 'corrigiriam'}`);
  }

  console.log(`\n--- Resumo ---`);
  console.log(`Total lidos:     ${grandScanned}`);
  console.log(`Total alterados: ${grandChanged}`);
  console.log(`Por campo:`);
  for (const f of TRACKED_FIELDS) {
    if (fieldTotals[f] > 0) console.log(`  ${f.padEnd(13)} ${fieldTotals[f]}`);
  }
  if (samples.length > 0) {
    console.log(`\nAmostras (antes → depois):`);
    console.log(samples.join('\n'));
  }
  if (!apply) {
    console.log(`\nDRY-RUN concluído. Para aplicar: npm run normalize:all-contacts -- --apply`);
  } else {
    console.log(`\nConcluído. Backup em ${backupTable}.`);
    console.log(`Restaurar (se necessário): TRUNCATE zapmass.contacts; INSERT INTO zapmass.contacts SELECT * FROM ${backupTable};`);
  }

  await closeZapmassPool();
}

main().catch(async (e) => {
  console.error('[normalize-all-contacts] Falha:', e instanceof Error ? e.message : e);
  await closeZapmassPool().catch(() => {});
  process.exit(1);
});
