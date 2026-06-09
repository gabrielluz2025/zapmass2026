/**
 * Lista donos (ownerUid) de cada canal conn_* em connections_settings.json.
 * Uso na VPS:
 *   npm run diagnose:connection-owners
 *   npm run diagnose:connection-owners -- --json
 *   npm run diagnose:connection-owners -- --fix conn_123 firebaseUidDoDono --prior uidErrado
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface SettingsRow {
  dailyLimit?: number;
  growthRate?: number;
  friendlyName?: string;
  ownerUid?: string;
}

interface EvolutionMeta {
  status?: string;
  phoneNumber?: string;
  profileName?: string;
}

function parseArgs(argv: string[]) {
  const json = argv.includes('--json');
  const fixIdx = argv.indexOf('--fix');
  if (fixIdx >= 0) {
    const id = argv[fixIdx + 1]?.trim();
    const ownerUid = argv[fixIdx + 2]?.trim();
    const priorIdx = argv.indexOf('--prior', fixIdx);
    const priorOwnerUid = priorIdx >= 0 ? argv[priorIdx + 1]?.trim() : undefined;
    return { mode: 'fix' as const, id, ownerUid, priorOwnerUid, json };
  }
  return { mode: 'list' as const, json };
}

function resolveDataDir(): string {
  const root = process.cwd();
  return path.resolve(root, process.env.DATA_DIR || 'data');
}

function loadSettings(file: string): Record<string, SettingsRow> {
  if (!fs.existsSync(file)) {
    console.error(`[diagnose] Arquivo não encontrado: ${file}`);
    return {};
  }
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as Record<string, SettingsRow>;
}

function phoneFromEvolutionRow(row: Record<string, unknown>): string | undefined {
  const owner = row.owner as Record<string, unknown> | undefined;
  const candidates = [
    row.number,
    row.phoneNumber,
    owner?.number,
    owner?.phoneNumber,
    (row.instance as Record<string, unknown> | undefined)?.number
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return undefined;
}

async function fetchEvolutionMeta(): Promise<Map<string, EvolutionMeta>> {
  const apiUrl = (process.env.EVOLUTION_API_URL || 'http://evolution:8080').replace(/\/$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY || '';
  const map = new Map<string, EvolutionMeta>();
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
      map.set(id, {
        status: String(row.connectionStatus ?? row.state ?? row.status ?? ''),
        phoneNumber: phoneFromEvolutionRow(row),
        profileName: typeof row.profileName === 'string' ? row.profileName : undefined
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[diagnose] Evolution indisponível (${msg}) — mostrando só settings.`);
  }
  return map;
}

function backupSettings(file: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, bak);
  console.log(`[diagnose] Backup: ${bak}`);
}

function applyFix(
  file: string,
  settings: Record<string, SettingsRow>,
  id: string,
  ownerUid: string,
  priorOwnerUid?: string
) {
  const row = settings[id];
  if (!row) {
    console.error(`[diagnose] Canal "${id}" não existe em connections_settings.json`);
    process.exit(1);
  }
  const current = row.ownerUid?.trim();
  if (priorOwnerUid && current && current !== priorOwnerUid) {
    console.error(
      `[diagnose] ownerUid atual (${current}) ≠ --prior (${priorOwnerUid}). Abortado por segurança.`
    );
    process.exit(1);
  }
  backupSettings(file);
  row.ownerUid = ownerUid;
  settings[id] = row;
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  console.log(`[diagnose] OK: ${id} → ownerUid=${ownerUid}${current ? ` (antes: ${current})` : ''}`);
  console.log('[diagnose] Reinicie o container da API para aplicar na RAM.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolveDataDir();
  const settingsFile = path.join(dataDir, 'connections_settings.json');
  const settings = loadSettings(settingsFile);

  if (args.mode === 'fix') {
    if (!args.id || !args.ownerUid) {
      console.error('Uso: npm run diagnose:connection-owners -- --fix <conn_id> <ownerUid> [--prior <uid>]');
      process.exit(1);
    }
    applyFix(settingsFile, settings, args.id, args.ownerUid, args.priorOwnerUid);
    return;
  }

  const evo = await fetchEvolutionMeta();
  const ids = new Set([...Object.keys(settings), ...evo.keys()]);
  const rows = [...ids].sort().map((id) => {
    const s = settings[id] ?? {};
    const e = evo.get(id);
    const name = s.friendlyName || e?.profileName || id;
    return {
      id,
      name,
      ownerUid: s.ownerUid ?? null,
      phoneNumber: e?.phoneNumber ?? null,
      evolutionStatus: e?.status ?? null,
      orphan: id.startsWith('conn_') && !s.ownerUid
    };
  });

  const byOwner = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.ownerUid) continue;
    const list = byOwner.get(r.ownerUid) ?? [];
    list.push(r.id);
    byOwner.set(r.ownerUid, list);
  }

  const payload = {
    at: new Date().toISOString(),
    settingsFile,
    total: rows.length,
    orphanCount: rows.filter((r) => r.orphan).length,
    owners: [...byOwner.entries()].map(([ownerUid, connectionIds]) => ({ ownerUid, connectionIds })),
    connections: rows
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`\n=== Donos de conexões (${settingsFile}) ===\n`);
  console.log('ID | Nome | Telefone | ownerUid | Status Evo | Órfão?');
  console.log('-'.repeat(100));
  for (const r of rows) {
    console.log(
      `${r.id} | ${r.name} | ${r.phoneNumber ?? '-'} | ${r.ownerUid ?? '(sem dono)'} | ${r.evolutionStatus ?? '-'} | ${r.orphan ? 'SIM' : 'não'}`
    );
  }
  console.log(`\nTotal: ${rows.length} | Órfãos: ${payload.orphanCount}`);
  if (payload.orphanCount > 0) {
    console.log('\n⚠ Canais órfãos não devem ser auto-vinculados — defina ownerUid manualmente.');
  }
  console.log('\nCorrigir dono:');
  console.log('  npm run diagnose:connection-owners -- --fix <conn_id> <firebaseUid> [--prior <uidErrado>]');
}

main().catch((e) => {
  console.error('[diagnose] Falha:', e instanceof Error ? e.message : e);
  process.exit(1);
});
