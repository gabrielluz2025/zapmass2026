import { resolvePostgresTenantId } from './auth/firebaseUidMap.js';
import { filterByConnectionScope } from './connectionScopeServer.js';
import { getZapmassPool } from './db/postgres.js';
import * as evolutionService from './evolutionService.js';
import { listContactLists } from './repositories/contactListsRepository.js';
import { listContacts } from './repositories/contactsRepository.js';
import { listCampaigns } from './repositories/campaignsRepository.js';
import { ConnectionStatus } from '../src/types.js';

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
    listCampaigns(tenantId)
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
    created_at: Date;
  }>(
    `SELECT id::text, tenant_id::text, email, text, screen, category, created_at
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
    createdAt: row.created_at.toISOString()
  }));
}
