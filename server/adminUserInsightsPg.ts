import { resolvePostgresTenantId } from './auth/firebaseUidMap.js';
import { filterByConnectionScope } from './connectionScopeServer.js';
import { getZapmassPool } from './db/postgres.js';
import * as evolutionService from './evolutionService.js';
import { listContactLists } from './repositories/contactListsRepository.js';
import { listContacts } from './repositories/contactsRepository.js';
import { rowToCampaign, type CampaignRow } from './repositories/campaignMapper.js';
import { ConnectionStatus, type Campaign } from '../src/types.js';

export type AdminUserInsightsPayload = {
  uid: string;
  email: string;
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  firstActivityAt: string | null;
  daysSinceFirstActivity: number;
  counts: {
    contactsTotal: number;
    contactsValid: number;
    contactsInvalid: number;
    contactLists: number;
    connectionsTotal: number;
    connectionsConnected: number;
    campaignsTotal: number;
    campaignsRunning: number;
    campaignsCompleted: number;
  };
  campaignTotals: {
    targeted: number;
    processed: number;
    success: number;
    failed: number;
  };
  contactTagsTop: Array<{ tag: string; count: number }>;
  listSegmentsTop: Array<{ listName: string; contacts: number }>;
  recentCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string | null;
    successCount: number;
    failedCount: number;
    totalContacts: number;
  }>;
  usage: {
    totalActiveMs: number;
    lastActiveAt: string | null;
  } | null;
};

/** Leitura só leitura para métricas admin — evita heal/requeue pesado de listCampaigns(). */
async function listCampaignsForAdminInsights(tenantId: string): Promise<Campaign[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<CampaignRow>(
    `SELECT id::text, tenant_id::text, name, status, next_run_at, schedule_lock_until, doc, created_at, updated_at
     FROM zapmass.campaigns WHERE tenant_id = $1::uuid ORDER BY created_at DESC`,
    [tenantId]
  );
  return r.rows.map(rowToCampaign);
}

function asEpoch(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

export async function loadAdminUserInsightsPg(uid: string): Promise<AdminUserInsightsPayload | null> {
  const pool = getZapmassPool();
  if (!pool) return null;

  const tenantId = resolvePostgresTenantId(String(uid || '').trim());
  if (!tenantId) return null;

  const userR = await pool.query<{ email: string; created_at: Date }>(
    `SELECT email, created_at FROM zapmass.users WHERE id = $1::uuid LIMIT 1`,
    [tenantId]
  );
  const userRow = userR.rows[0];
  if (!userRow) return null;

  const [contacts, lists, campaigns] = await Promise.all([
    listContacts(tenantId, { limit: 10_000 }),
    listContactLists(tenantId),
    listCampaignsForAdminInsights(tenantId)
  ]);

  let conns = evolutionService.getConnections();
  try {
    await evolutionService.ensureConnectionsHydrated();
    conns = filterByConnectionScope(tenantId, evolutionService.getConnections());
  } catch {
    conns = filterByConnectionScope(tenantId, conns);
  }

  const contactsValid = contacts.filter((c) => String(c.status || '').toUpperCase() !== 'INVALID').length;
  const contactsInvalid = contacts.length - contactsValid;
  const campaignsRunning = campaigns.filter((c) => String(c.status || '') === 'RUNNING').length;
  const campaignsCompleted = campaigns.filter((c) => String(c.status || '') === 'COMPLETED').length;
  const connectionsConnected = conns.filter((c) => c.status === ConnectionStatus.CONNECTED).length;

  const targeted = campaigns.reduce((acc, c) => acc + (Number(c.totalContacts) || 0), 0);
  const processed = campaigns.reduce((acc, c) => acc + (Number(c.processedCount) || 0), 0);
  const success = campaigns.reduce((acc, c) => acc + (Number(c.successCount) || 0), 0);
  const failed = campaigns.reduce((acc, c) => acc + (Number(c.failedCount) || 0), 0);

  const tagMap = new Map<string, number>();
  for (const c of contacts) {
    for (const t of Array.isArray(c.tags) ? c.tags : []) {
      const tag = String(t || '').trim();
      if (!tag) continue;
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    }
  }
  const contactTagsTop = Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const listSegmentsTop = lists
    .map((l) => ({
      listName: String(l.name || 'Lista'),
      contacts: Array.isArray(l.contactIds) ? l.contactIds.length : Number(l.count) || 0
    }))
    .sort((a, b) => b.contacts - a.contacts)
    .slice(0, 8);

  const recentCampaigns = campaigns
    .sort((a, b) => asEpoch(b.createdAt) - asEpoch(a.createdAt))
    .slice(0, 6)
    .map((c) => ({
      id: String(c.id || ''),
      name: String(c.name || 'Campanha'),
      status: String(c.status || '—'),
      createdAt: c.createdAt ? String(c.createdAt) : null,
      successCount: Number(c.successCount) || 0,
      failedCount: Number(c.failedCount) || 0,
      totalContacts: Number(c.totalContacts) || 0
    }));

  let usage: AdminUserInsightsPayload['usage'] = null;
  try {
    const usageR = await pool.query<{ total_active_ms: string; last_active_at: Date | null }>(
      `SELECT total_active_ms::text, last_active_at
       FROM zapmass.tenant_usage_stats
       WHERE tenant_id = $1::uuid`,
      [tenantId]
    );
    if (usageR.rows[0]) {
      usage = {
        totalActiveMs: Math.max(0, Math.round(Number(usageR.rows[0].total_active_ms) || 0)),
        lastActiveAt: usageR.rows[0].last_active_at?.toISOString() ?? null
      };
    }
  } catch (e) {
    console.warn('[admin/insights] tenant_usage_stats indisponível:', e);
  }

  const accountCreatedAt = userRow.created_at?.toISOString?.() ?? null;
  const firstActivityMsCandidates = [
    ...lists.map((l) => asEpoch(l.createdAt)),
    ...campaigns.map((c) => asEpoch(c.createdAt)),
    accountCreatedAt ? new Date(accountCreatedAt).getTime() : 0
  ].filter((x) => x > 0);
  const firstActivityMs =
    firstActivityMsCandidates.length > 0 ? Math.min(...firstActivityMsCandidates) : 0;
  const firstActivityAt = firstActivityMs > 0 ? new Date(firstActivityMs).toISOString() : null;
  const daysSinceFirstActivity =
    firstActivityMs > 0 ? Math.max(0, Math.floor((Date.now() - firstActivityMs) / (1000 * 60 * 60 * 24))) : 0;

  return {
    uid: tenantId,
    email: userRow.email,
    accountCreatedAt,
    lastSignInAt: null,
    firstActivityAt,
    daysSinceFirstActivity,
    counts: {
      contactsTotal: contacts.length,
      contactsValid,
      contactsInvalid,
      contactLists: lists.length,
      connectionsTotal: conns.length,
      connectionsConnected,
      campaignsTotal: campaigns.length,
      campaignsRunning,
      campaignsCompleted
    },
    campaignTotals: { targeted, processed, success, failed },
    contactTagsTop,
    listSegmentsTop,
    recentCampaigns,
    usage
  };
}

export type AdminProductSuggestionRow = {
  id: string;
  uid: string;
  text: string;
  userEmail: string;
  screen: string;
  category: string;
  status: string;
  replyCount: number;
  lastRepliedAt: string | null;
  lastRepliedBy: string;
  createdAt: string | null;
};

export type AdminProductSuggestionReplyRow = {
  id: string;
  text: string;
  adminEmail: string;
  adminUid: string;
  emailSent: boolean;
  emailError: string;
  createdAt: string | null;
};

export async function listAdminProductSuggestionsPg(limit: number): Promise<AdminProductSuggestionRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const cap = Math.min(200, Math.max(10, Math.round(limit) || 100));
  const r = await pool.query<{
    id: string;
    tenant_id: string;
    email: string;
    text: string;
    screen: string;
    category: string;
    status: string;
    reply_count: number;
    last_replied_at: Date | null;
    last_replied_by: string;
    created_at: Date;
  }>(
    `SELECT id::text, tenant_id::text, email, text, screen, category,
            COALESCE(status, 'received') AS status,
            COALESCE(reply_count, 0) AS reply_count,
            last_replied_at, COALESCE(last_replied_by, '') AS last_replied_by,
            created_at
     FROM zapmass.product_suggestions
     ORDER BY created_at DESC
     LIMIT $1`,
    [cap]
  );
  return r.rows.map((row) => ({
    id: row.id,
    uid: row.tenant_id,
    text: row.text,
    userEmail: row.email,
    screen: row.screen,
    category: row.category,
    status: row.status || 'received',
    replyCount: Number(row.reply_count) || 0,
    lastRepliedAt: row.last_replied_at ? row.last_replied_at.toISOString() : null,
    lastRepliedBy: row.last_replied_by || '',
    createdAt: row.created_at.toISOString()
  }));
}

export async function loadAdminProductSuggestionPg(
  tenantId: string,
  suggestionId: string
): Promise<AdminProductSuggestionRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<{
    id: string;
    tenant_id: string;
    email: string;
    text: string;
    screen: string;
    category: string;
    status: string;
    reply_count: number;
    last_replied_at: Date | null;
    last_replied_by: string;
    created_at: Date;
  }>(
    `SELECT id::text, tenant_id::text, email, text, screen, category,
            COALESCE(status, 'received') AS status,
            COALESCE(reply_count, 0) AS reply_count,
            last_replied_at, COALESCE(last_replied_by, '') AS last_replied_by,
            created_at
     FROM zapmass.product_suggestions
     WHERE tenant_id = $1::uuid AND id = $2::uuid
     LIMIT 1`,
    [tenantId, suggestionId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    uid: row.tenant_id,
    text: row.text,
    userEmail: row.email,
    screen: row.screen,
    category: row.category,
    status: row.status || 'received',
    replyCount: Number(row.reply_count) || 0,
    lastRepliedAt: row.last_replied_at ? row.last_replied_at.toISOString() : null,
    lastRepliedBy: row.last_replied_by || '',
    createdAt: row.created_at.toISOString()
  };
}

export async function listAdminProductSuggestionRepliesPg(
  tenantId: string,
  suggestionId: string
): Promise<AdminProductSuggestionReplyRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<{
    id: string;
    text: string;
    admin_email: string;
    admin_uid: string;
    email_sent: boolean;
    email_error: string;
    created_at: Date;
  }>(
    `SELECT r.id::text, r.text, r.admin_email, r.admin_uid, r.email_sent,
            COALESCE(r.email_error, '') AS email_error, r.created_at
     FROM zapmass.product_suggestion_replies r
     INNER JOIN zapmass.product_suggestions s ON s.id = r.suggestion_id
     WHERE s.tenant_id = $1::uuid AND s.id = $2::uuid
     ORDER BY r.created_at ASC
     LIMIT 50`,
    [tenantId, suggestionId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    text: row.text,
    adminEmail: row.admin_email,
    adminUid: row.admin_uid,
    emailSent: row.email_sent === true,
    emailError: row.email_error || '',
    createdAt: row.created_at.toISOString()
  }));
}

export async function insertAdminProductSuggestionReplyPg(params: {
  tenantId: string;
  suggestionId: string;
  text: string;
  adminEmail: string;
  adminUid: string;
  emailSent: boolean;
  emailError?: string;
}): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('Postgres indisponível.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query(
      `SELECT id FROM zapmass.product_suggestions WHERE tenant_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
      [params.tenantId, params.suggestionId]
    );
    if (exists.rowCount === 0) {
      throw new Error('Sugestão não encontrada.');
    }
    await client.query(
      `INSERT INTO zapmass.product_suggestion_replies
         (suggestion_id, text, admin_email, admin_uid, email_sent, email_error)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [
        params.suggestionId,
        params.text,
        params.adminEmail,
        params.adminUid,
        params.emailSent,
        (params.emailError || '').slice(0, 500)
      ]
    );
    await client.query(
      `UPDATE zapmass.product_suggestions
          SET reply_count = COALESCE(reply_count, 0) + 1,
              last_replied_at = now(),
              last_replied_by = $3,
              status = CASE WHEN status = 'received' THEN 'reviewing' ELSE status END,
              updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [params.tenantId, params.suggestionId, params.adminEmail]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const SUGGESTION_STATUSES = new Set(['received', 'reviewing', 'planned', 'done', 'declined']);

export async function patchAdminProductSuggestionStatusPg(
  tenantId: string,
  suggestionId: string,
  status: string
): Promise<boolean> {
  if (!SUGGESTION_STATUSES.has(status)) return false;
  const pool = getZapmassPool();
  if (!pool) return false;
  const r = await pool.query(
    `UPDATE zapmass.product_suggestions
        SET status = $3, updated_at = now()
      WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantId, suggestionId, status]
  );
  return (r.rowCount ?? 0) > 0;
}
