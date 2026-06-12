/**
 * Repara ownerUid em connections_settings.json usando zapmass.users (Postgres).
 *
 * Uso na VPS:
 *   npm run repair:connection-owners
 *   npm run repair:connection-owners -- --auto --apply
 *   npm run repair:connection-owners -- --assign conn_ID --email dono@mail.com --apply
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

type UserRow = { id: string; email: string; firebase_uid: string | null };
type SettingsRow = { ownerUid?: string; createdByUid?: string; friendlyName?: string };

const FESTA_EMAIL = 'festaimportgabriel@gmail.com';
const SYLVESTER_EMAIL = 'sylvesterstallonealvesdasilva@gmail.com';

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const auto = argv.includes('--auto');
  const assignIdx = argv.indexOf('--assign');
  if (assignIdx >= 0) {
    const connId = argv[assignIdx + 1]?.trim();
    const emailIdx = argv.indexOf('--email', assignIdx);
    const email = emailIdx >= 0 ? argv[emailIdx + 1]?.trim() : '';
    return { mode: 'assign' as const, apply, connId, email };
  }
  if (auto) return { mode: 'auto' as const, apply };
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

function isKnownOwner(raw: string, users: UserRow[]): boolean {
  return Boolean(raw.trim() && resolveCanonicalOwner(raw, users));
}

async function fetchEvolutionLabels(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const apiUrl = (process.env.EVOLUTION_API_URL || 'http://evolution:8080').replace(/\/$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY || '';
  try {
    const res = await axios.get(`${apiUrl}/instance/fetchInstances`, {
      headers: apiKey ? { apikey: apiKey } : {},
      timeout: 20_000
    });
    const raw = res.data;
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.instances) ? raw.instances : [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = String(
        row.name || row.instanceName || (row.instance as Record<string, unknown> | undefined)?.instanceName || ''
      ).trim();
      if (!id) continue;
      const label = String(row.profileName || row.profile_name || id).trim();
      map.set(id, label);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[repair] Evolution indisponível (${msg}) — usa friendlyName salvo.`);
  }
  return map;
}

function backup(file: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, bak);
  console.log(`[repair] Backup: ${bak}`);
}

function userByEmail(users: UserRow[], email: string): UserRow | undefined {
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

function labelFor(connId: string, row: SettingsRow, evo: Map<string, string>): string {
  return (row.friendlyName || evo.get(connId) || connId).trim();
}

function healOwnersFromCreators(settings: Record<string, SettingsRow>): number {
  let changed = 0;
  for (const row of Object.values(settings)) {
    const creator = row.createdByUid?.trim() ?? '';
    const owner = row.ownerUid?.trim() ?? '';
    if (!owner && creator) {
      row.ownerUid = creator;
      changed += 1;
    } else if (owner && !creator) {
      row.createdByUid = owner;
      changed += 1;
    }
  }
  return changed;
}
  const n = label.toLowerCase();
  return n.includes('sylvester') || n.includes('stallone');
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
  const healed = healOwnersFromCreators(settings);
  if (healed > 0) {
    console.log(`\n[repair] Curados via createdByUid: ${healed} canal(is)`);
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  }
  const evo = await fetchEvolutionLabels();

  if (args.mode === 'assign') {
    if (!args.connId || !args.email) {
      console.error('Uso: --assign <conn_id> --email <email> [--apply]');
      process.exit(1);
    }
    const target = userByEmail(users, args.email);
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
    console.log(`\n[repair] ${args.connId} (${labelFor(args.connId, row, evo)})`);
    console.log(`  ${prior} → ${target.id} (${target.email})`);
    if (!args.apply) {
      console.log('\nAdicione --apply para gravar.');
      return;
    }
    backup(settingsFile);
    row.ownerUid = target.id;
    row.createdByUid = target.id;
    settings[args.connId] = row;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    console.log('[repair] OK. Reinicie: docker restart zapmass-zapmass-1');
    return;
  }

  if (args.mode === 'auto') {
    const festa = userByEmail(users, FESTA_EMAIL);
    const sylvester = userByEmail(users, SYLVESTER_EMAIL);
    if (!festa || !sylvester) {
      console.error('[repair] Contas festaimport ou sylvester não encontradas no Postgres.');
      process.exit(1);
    }

    const pending: { connId: string; from: string; to: string; toEmail: string; label: string }[] = [];

    for (const [connId, row] of Object.entries(settings)) {
      const raw = row.ownerUid?.trim() ?? '';
      const label = labelFor(connId, row, evo);

      let target: UserRow | null = null;
      if (isSylvesterChannel(label)) {
        target = sylvester;
      } else if (!isKnownOwner(raw, users)) {
        target = festa;
      } else {
        continue;
      }

      if (!target || raw === target.id) continue;
      pending.push({
        connId,
        from: raw || '(órfão)',
        to: target.id,
        toEmail: target.email,
        label
      });
    }

    console.log('\n=== Reparo automático (proposto) ===');
    if (pending.length === 0) {
      console.log('Nada a alterar.');
      return;
    }
    for (const p of pending) {
      console.log(`  ${p.connId} (${p.label}): ${p.from} → ${p.to} (${p.toEmail})`);
    }
    if (!args.apply) {
      console.log('\nAdicione --apply para gravar.');
      return;
    }
    backup(settingsFile);
    for (const p of pending) {
      settings[p.connId] = { ...settings[p.connId], ownerUid: p.to, createdByUid: p.to };
    }
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
    const label = labelFor(connId, row, evo);
    console.log(
      `${connId} | ${label} | ownerUid=${raw || '(órfão)'} | postgres=${canonical ?? '-'} | ${email}`
    );
    if (canonical && canonical !== raw) {
      pending.push({ connId, from: raw, to: canonical, name: label });
    }
  }

  if (pending.length === 0) {
    console.log('\n[repair] Nenhuma normalização pendente.');
    console.log('Reparo automático (festaimport + sylvester):');
    console.log('  npm run repair:connection-owners -- --auto --apply');
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
    settings[p.connId] = { ...settings[p.connId], ownerUid: p.to, createdByUid: p.to };
  }
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  console.log('[repair] OK. Reinicie: docker restart zapmass-zapmass-1');
}

main().catch((e) => {
  console.error('[repair] Falha:', e instanceof Error ? e.message : e);
  process.exit(1);
});
