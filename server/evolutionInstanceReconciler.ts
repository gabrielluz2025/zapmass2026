/**
 * Reconciliação bidirecional ZapMass ↔ Evolution Go.
 * Remove instâncias órfãs no motor, duplicatas UUID e connecting zumbis.
 */
import { pickGoInstanceUuidFromRow } from './evolutionProvider/goUuid.js';
import { isEvolutionGoEngine } from './evolutionConfig.js';
import { runEvolutionReconnectExclusive } from './evolutionReconnectQueue.js';
import * as evolutionService from './evolutionService.js';

const CONN_PREFIX = 'conn_';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const STALE_CONNECTING_MS = 30 * 60 * 1000;

export type ParsedGoInstance = {
  name: string;
  goUuid: string;
  rawState: string;
  mappedStatus: 'open' | 'connecting' | 'created' | 'close';
  connected: boolean;
  updatedAtMs?: number;
};

export type GoInstanceDriftReport = {
  scannedAt: string;
  goTotal: number;
  settingsTotal: number;
  /** Instância no Go sem settings/tombstone ZapMass */
  goOnlyOrphans: ParsedGoInstance[];
  /** Settings ZapMass sem instância correspondente no Go */
  zapmassOnlyOrphans: Array<{ connectionId: string; goUuid?: string }>;
  /** Mesmo conn_* com mais de um UUID no Go */
  duplicateUuids: Array<{ name: string; uuids: string[]; keepUuid: string }>;
  /** connecting parado >30 min sem pairing ativo */
  staleConnecting: ParsedGoInstance[];
};

export type GoInstanceReconcileResult = {
  ok: boolean;
  dryRun: boolean;
  report: GoInstanceDriftReport;
  deletedGoOrphans: string[];
  deletedDuplicates: string[];
  deletedStaleConnecting: string[];
  repairedZapmassOnly: string[];
  errors: Array<{ target: string; error: string }>;
};

function readIntervalMs(): number {
  const n = Number(process.env.GO_INSTANCE_RECONCILE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  return Number.isFinite(n) && n >= 60_000 ? Math.floor(n) : DEFAULT_INTERVAL_MS;
}

function mapGoState(raw: unknown, connected?: boolean): ParsedGoInstance['mappedStatus'] {
  if (connected === true) return 'open';
  const state = String(raw || '').toLowerCase();
  if (state === 'open') return 'open';
  if (state === 'connecting') return 'connecting';
  if (state === 'created' || state === 'qrcode') return 'created';
  return 'close';
}

function parseGoInstanceRow(item: unknown): ParsedGoInstance | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const name = String(row.name || row.instanceName || '').trim();
  if (!name.startsWith(CONN_PREFIX)) return null;
  const goUuid = pickGoInstanceUuidFromRow(row);
  if (!goUuid) return null;
  const connected = row.connected === true;
  const rawState = String(row.connectionStatus ?? row.state ?? row.status ?? '').trim();
  const updatedRaw = row.updatedAt ?? row.updated_at ?? row.lastActivity;
  let updatedAtMs: number | undefined;
  if (typeof updatedRaw === 'number' && Number.isFinite(updatedRaw)) {
    updatedAtMs = updatedRaw > 1e12 ? updatedRaw : updatedRaw * 1000;
  } else if (typeof updatedRaw === 'string') {
    const t = Date.parse(updatedRaw);
    if (Number.isFinite(t)) updatedAtMs = t;
  }
  return {
    name,
    goUuid,
    rawState,
    mappedStatus: mapGoState(rawState, connected),
    connected,
    updatedAtMs,
  };
}

function isStaleConnecting(row: ParsedGoInstance): boolean {
  if (row.mappedStatus !== 'connecting' && !row.connected) return false;
  if (row.mappedStatus === 'open' || row.connected) return false;
  if (evolutionService.isConnectionPairingInProgress(row.name)) return false;
  const started = evolutionService.getPairingStartedAtMs(row.name);
  const ref = started ?? row.updatedAtMs;
  if (!ref) return row.mappedStatus === 'connecting';
  return Date.now() - ref >= STALE_CONNECTING_MS;
}

function settingsKeys(): Set<string> {
  const snap = evolutionService.getConnectionsSettingsSnapshot();
  return new Set(Object.keys(snap).filter((k) => k.startsWith(CONN_PREFIX)));
}

function resolveKeepUuid(name: string, uuids: string[]): string {
  const snap = evolutionService.getConnectionsSettingsSnapshot();
  const cached = snap[name]?.evolutionGoInstanceId?.trim();
  if (cached && uuids.includes(cached)) return cached;
  return uuids[0];
}

/** Varredura read-only — lista drift Go ↔ ZapMass. */
export async function scanGoInstanceDrift(): Promise<GoInstanceDriftReport> {
  const list = await evolutionService.listGoInstancesRaw();
  const parsed = list.map(parseGoInstanceRow).filter((x): x is ParsedGoInstance => Boolean(x));
  const settings = settingsKeys();

  const byName = new Map<string, ParsedGoInstance[]>();
  for (const row of parsed) {
    const arr = byName.get(row.name) ?? [];
    arr.push(row);
    byName.set(row.name, arr);
  }

  const goOnlyOrphans: ParsedGoInstance[] = [];
  const duplicateUuids: GoInstanceDriftReport['duplicateUuids'] = [];
  const staleConnecting: ParsedGoInstance[] = [];

  for (const [name, rows] of byName.entries()) {
    if (rows.length > 1) {
      const uuids = [...new Set(rows.map((r) => r.goUuid))];
      duplicateUuids.push({ name, uuids, keepUuid: resolveKeepUuid(name, uuids) });
    }
    const primary = rows[0];
    if (!settings.has(name) && !evolutionService.isConnectionTombstoned(name)) {
      if (primary.mappedStatus !== 'open' && !primary.connected) {
        goOnlyOrphans.push(primary);
      }
    }
    for (const row of rows) {
      if (isStaleConnecting(row)) staleConnecting.push(row);
    }
  }

  const goNames = new Set(parsed.map((r) => r.name));
  const goUuidSet = new Set(parsed.map((r) => r.goUuid));
  const zapmassOnlyOrphans: GoInstanceDriftReport['zapmassOnlyOrphans'] = [];

  for (const connectionId of settings) {
    if (evolutionService.isConnectionTombstoned(connectionId)) continue;
    if (goNames.has(connectionId)) continue;
    const snap = evolutionService.getConnectionsSettingsSnapshot()[connectionId];
    const goUuid = snap?.evolutionGoInstanceId?.trim();
    if (goUuid && goUuidSet.has(goUuid)) continue;
    zapmassOnlyOrphans.push({ connectionId, goUuid });
  }

  return {
    scannedAt: new Date().toISOString(),
    goTotal: parsed.length,
    settingsTotal: settings.size,
    goOnlyOrphans,
    zapmassOnlyOrphans,
    duplicateUuids,
    staleConnecting,
  };
}

async function deleteGoRow(row: ParsedGoInstance, reason: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    runEvolutionReconnectExclusive(async () => {
      try {
        await evolutionService.purgeGoInstanceByUuid(row.name, row.goUuid, reason);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** Reconcilia instâncias — remove órfãs Go, duplicatas e connecting zumbis. */
export async function reconcileGoInstances(opts?: {
  dryRun?: boolean;
  deleteGoOrphans?: boolean;
}): Promise<GoInstanceReconcileResult> {
  const dryRun = Boolean(opts?.dryRun);
  const deleteGoOrphans = opts?.deleteGoOrphans !== false;
  const report = await scanGoInstanceDrift();
  const result: GoInstanceReconcileResult = {
    ok: true,
    dryRun,
    report,
    deletedGoOrphans: [],
    deletedDuplicates: [],
    deletedStaleConnecting: [],
    repairedZapmassOnly: [],
    errors: [],
  };

  if (!isEvolutionGoEngine()) return result;

  const targets = new Map<string, ParsedGoInstance>();

  const queue = (row: ParsedGoInstance, bucket: 'orphan' | 'dup' | 'stale') => {
    if (row.mappedStatus === 'open' || row.connected) return;
    if (evolutionService.isConnectionPairingInProgress(row.name)) return;
    if (!evolutionService.isConnectionEligibleForAutoPruneDelete(row.name, row.mappedStatus)) {
      if (bucket !== 'stale') return;
    }
    targets.set(`${row.name}:${row.goUuid}`, row);
  };

  if (deleteGoOrphans) {
    for (const row of report.goOnlyOrphans) queue(row, 'orphan');
  }
  if (report.duplicateUuids.length > 0) {
    const list = await evolutionService.listGoInstancesRaw();
    for (const dup of report.duplicateUuids) {
      for (const item of list) {
        const row = parseGoInstanceRow(item);
        if (!row || row.name !== dup.name) continue;
        if (row.goUuid === dup.keepUuid) continue;
        queue(row, 'dup');
      }
    }
  }
  for (const row of report.staleConnecting) queue(row, 'stale');

  if (dryRun) return result;

  for (const row of targets.values()) {
    try {
      await deleteGoRow(row, 'go-instance-reconciler');
      if (report.goOnlyOrphans.some((o) => o.goUuid === row.goUuid)) {
        result.deletedGoOrphans.push(row.name);
      } else if (report.staleConnecting.some((s) => s.goUuid === row.goUuid)) {
        result.deletedStaleConnecting.push(row.name);
      } else {
        result.deletedDuplicates.push(`${row.name}:${row.goUuid.slice(0, 8)}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({ target: `${row.name}:${row.goUuid}`, error: msg });
      result.ok = false;
    }
  }

  for (const orphan of report.zapmassOnlyOrphans.slice(0, 20)) {
    try {
      const ok = await evolutionService.ensureEvolutionGoInstanceExistsPublic(orphan.connectionId);
      if (ok) result.repairedZapmassOnly.push(orphan.connectionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({ target: orphan.connectionId, error: msg });
    }
  }

  evolutionService.invalidateGoInstanceListCache();
  return result;
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let bootReconcileDone = false;

export function startGoInstanceReconcilerTimer(): void {
  if (!isEvolutionGoEngine()) return;
  if (reconcileTimer) return;

  const intervalMs = readIntervalMs();
  reconcileTimer = setInterval(() => {
    void reconcileGoInstances({ dryRun: false }).then((r) => {
      const removed =
        r.deletedGoOrphans.length +
        r.deletedDuplicates.length +
        r.deletedStaleConnecting.length;
      if (removed > 0 || r.errors.length > 0) {
        console.warn('[go-instance-reconciler]', {
          removed,
          orphans: r.deletedGoOrphans.length,
          duplicates: r.deletedDuplicates.length,
          stale: r.deletedStaleConnecting.length,
          repaired: r.repairedZapmassOnly.length,
          errors: r.errors.length,
        });
      }
    });
  }, intervalMs);

  if (!bootReconcileDone) {
    bootReconcileDone = true;
    setTimeout(() => {
      void reconcileGoInstances({ dryRun: false }).catch((e) => {
        console.warn('[go-instance-reconciler] boot reconcile falhou', e instanceof Error ? e.message : e);
      });
    }, 180_000);
  }
}

export function stopGoInstanceReconcilerTimer(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
}
