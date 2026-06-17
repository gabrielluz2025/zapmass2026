/**
 * Reconcilia ownerUid de canais legados (conn_*) com base nos utilizadores Postgres.
 * Corrige vazamento quando um canal foi criado sob a conta errada (ex.: Patrícia na conta Gabriel).
 */
import { tenantScopeUidsMatch } from './auth/tenantUidScopeServer.js';

export type ConnectionSettingsRow = {
  ownerUid?: string;
  createdByUid?: string;
  friendlyName?: string;
};

export type TenantUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export type ReconcileAssignAction = {
  kind: 'assign';
  connId: string;
  label: string;
  fromOwnerUid: string | null;
  toOwnerUid: string;
  toEmail: string;
  reason: string;
};

export type ReconcileRemoveAction = {
  kind: 'remove';
  connId: string;
  label: string;
  reason: string;
};

export type ReconcileAction = ReconcileAssignAction | ReconcileRemoveAction;

const MIN_MATCH_SCORE = 50;

function normalizeLabel(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

function labelOf(connId: string, row: ConnectionSettingsRow): string {
  return (row.friendlyName || connId).trim();
}

function isOrphanOffline(connId: string, row: ConnectionSettingsRow): boolean {
  const label = labelOf(connId, row);
  if (label !== connId) return false;
  return /^conn_\d+_\d+$/.test(connId);
}

/** Pontua quão bem um utilizador corresponde ao nome do canal. */
export function scoreUserForConnectionLabel(user: TenantUser, label: string): number {
  const lab = normalizeLabel(label);
  if (!lab) return 0;

  const display = normalizeLabel(user.displayName || '');
  const email = user.email.toLowerCase();
  const emailLocal = normalizeLabel(email.split('@')[0] || '');

  let score = 0;

  if (display.length >= 3 && lab.includes(display)) score += 80;

  const firstName = display.split(/\s+/)[0] || '';
  if (firstName.length >= 3 && lab.includes(firstName)) score += 45;

  if (emailLocal.length >= 4 && lab.includes(emailLocal)) score += 50;

  // Padrões conhecidos no ambiente demo/produção atual
  if (/patr[ií]cia|marcondes/.test(lab) && email.includes('paty.contact')) score += 120;
  if (/sylvester|stallone/.test(lab) && email.includes('sylvesterstallone')) score += 120;
  if (/^gabriel$/i.test(label.trim()) && email.includes('festaimportgabriel')) score += 100;
  if (/^zap-?mass$/i.test(label.trim()) && email.includes('festaimportgabriel')) score += 90;
  if (/jeisi|marchiore/.test(lab) && email.includes('festaimportgabriel')) score += 90;

  return score;
}

function resolveBestOwner(label: string, users: TenantUser[]): { user: TenantUser; score: number } | null {
  let best: TenantUser | null = null;
  let bestScore = 0;
  for (const user of users) {
    const score = scoreUserForConnectionLabel(user, label);
    if (score > bestScore) {
      bestScore = score;
      best = user;
    }
  }
  if (!best || bestScore < MIN_MATCH_SCORE) return null;
  return { user: best, score: bestScore };
}

function resolveUserByUid(users: TenantUser[], uid: string | null | undefined): TenantUser | undefined {
  const raw = String(uid || '').trim();
  if (!raw) return undefined;
  return users.find((u) => tenantScopeUidsMatch(u.id, raw));
}

export async function loadTenantUsersFromPostgres(): Promise<TenantUser[]> {
  const { getZapmassPool } = await import('./db/postgres.js');
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<{ id: string; email: string; display_name: string | null }>(
    `SELECT id::text, email, display_name
     FROM zapmass.users
     WHERE disabled_at IS NULL
     ORDER BY email`
  );
  return r.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name
  }));
}

/** Simula correções sem gravar. */
export async function planConnectionOwnerReconciliation(
  settings: Record<string, ConnectionSettingsRow>,
  users?: TenantUser[]
): Promise<ReconcileAction[]> {
  const tenantUsers = users ?? (await loadTenantUsersFromPostgres());
  if (tenantUsers.length === 0) return [];

  const actions: ReconcileAction[] = [];

  for (const [connId, row] of Object.entries(settings)) {
    const label = labelOf(connId, row);
    const currentOwnerRaw = row.ownerUid?.trim() || null;
    const currentUser = resolveUserByUid(tenantUsers, currentOwnerRaw);
    const currentOwnerUid = currentUser?.id ?? currentOwnerRaw;

    const best = resolveBestOwner(label, tenantUsers);
    if (!best) {
      if (isOrphanOffline(connId, row)) {
        actions.push({
          kind: 'remove',
          connId,
          label,
          reason: 'Canal offline órfão (sem nome amigável)'
        });
      }
      continue;
    }

    if (currentOwnerUid && tenantScopeUidsMatch(currentOwnerUid, best.user.id)) {
      continue;
    }

    const currentScore = currentUser ? scoreUserForConnectionLabel(currentUser, label) : 0;
    if (currentScore >= best.score) {
      continue;
    }

    actions.push({
      kind: 'assign',
      connId,
      label,
      fromOwnerUid: currentOwnerUid,
      toOwnerUid: best.user.id,
      toEmail: best.user.email,
      reason: `Nome "${label}" corresponde a ${best.user.email} (score ${best.score}${currentScore ? ` vs ${currentScore}` : ''})`
    });
  }

  return actions;
}

export async function resolveCanonicalTenantId(uid: string): Promise<string> {
  const raw = String(uid || '').trim();
  if (!raw) return raw;
  const { getZapmassPool } = await import('./db/postgres.js');
  const pool = getZapmassPool();
  if (!pool) return raw;
  const r = await pool.query<{ id: string }>(
    `SELECT id::text FROM zapmass.users
     WHERE id::text = $1 OR firebase_uid = $1 OR id = $1::uuid
     LIMIT 1`,
    [raw]
  );
  return r.rows[0]?.id?.trim() || raw;
}

export async function migrateChatForConnection(
  fromTenantId: string,
  toTenantId: string,
  connectionId: string
): Promise<{ threads: number; messages: number }> {
  const fromId = await resolveCanonicalTenantId(fromTenantId);
  const toId = await resolveCanonicalTenantId(toTenantId);
  if (!fromId || !toId || fromId === toId) {
    return { threads: 0, messages: 0 };
  }

  const { getZapmassPool } = await import('./db/postgres.js');
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
    [fromId, connectionId]
  );
  const threads = Number(countR.rows[0]?.threads || 0);
  const messages = Number(countR.rows[0]?.messages || 0);
  if (threads === 0) return { threads, messages };

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
      [fromId, connectionId, toId]
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
      [fromId, connectionId, toId]
    );

    await client.query(
      `DELETE FROM zapmass.wa_chat_threads
       WHERE tenant_id = $1::uuid AND last_connection_id = $2`,
      [fromId, connectionId]
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
