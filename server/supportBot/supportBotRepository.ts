import { getZapmassPool } from '../db/postgres.js';
import { resolvePostgresTenantId } from '../auth/firebaseUidMap.js';
import {
  DEFAULT_SUPPORT_BOT_CONFIG,
  type SupportBotConfig,
  type SupportBotHandoffRow,
  type SupportBotMetrics
} from './supportBotTypes.js';

function pgTenantId(tenantId: string): string {
  return resolvePostgresTenantId(String(tenantId || '').trim());
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function sanitizeOption(raw: unknown, index: number): SupportBotConfig['options'][0] | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? index + 1).trim().slice(0, 8) || String(index + 1);
  const label = String(o.label ?? '').trim().slice(0, 120);
  const reply = String(o.reply ?? '').trim().slice(0, 2000);
  const handoff = o.handoff === true;
  if (!label) return null;
  return { id, label, reply, ...(handoff ? { handoff: true } : {}) };
}

function sanitizeFaqItem(raw: unknown, index: number): SupportBotConfig['faqItems'][0] | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? index + 1).trim().slice(0, 8) || String(index + 1);
  const reply = String(o.reply ?? '').trim().slice(0, 2000);
  const keywords = Array.isArray(o.keywords)
    ? o.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 12)
    : [];
  if (!reply || keywords.length === 0) return null;
  return { id, keywords, reply };
}

export function normalizeSupportBotConfig(raw: unknown): SupportBotConfig {
  const base = DEFAULT_SUPPORT_BOT_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...base, options: [...base.options] };
  const o = raw as Record<string, unknown>;
  const optionsRaw = Array.isArray(o.options) ? o.options : base.options;
  const options = optionsRaw
    .slice(0, 5)
    .map((row, i) => sanitizeOption(row, i))
    .filter((x): x is SupportBotConfig['options'][0] => x != null);
  const faqRaw = Array.isArray(o.faqItems) ? o.faqItems : base.faqItems;
  const faqItems = faqRaw
    .slice(0, 15)
    .map((row, i) => sanitizeFaqItem(row, i))
    .filter((x): x is SupportBotConfig['faqItems'][0] => x != null);
  const bh = (o.businessHours && typeof o.businessHours === 'object'
    ? o.businessHours
    : {}) as Record<string, unknown>;
  const weekdays = Array.isArray(bh.weekdays)
    ? bh.weekdays.map((d) => Number(d)).filter((n) => n >= 0 && n <= 6)
    : base.businessHours.weekdays;
  return {
    enabled: o.enabled === true,
    connectionIds: Array.isArray(o.connectionIds)
      ? o.connectionIds.map((c) => String(c).trim()).filter(Boolean).slice(0, 20)
      : [],
    welcomeMessage: String(o.welcomeMessage ?? base.welcomeMessage).trim().slice(0, 1500) || base.welcomeMessage,
    menuPrompt: String(o.menuPrompt ?? base.menuPrompt).trim().slice(0, 400) || base.menuPrompt,
    options: options.length > 0 ? options : [...base.options],
    offHoursMessage: String(o.offHoursMessage ?? base.offHoursMessage).trim().slice(0, 1500) || base.offHoursMessage,
    handoffMessage: String(o.handoffMessage ?? base.handoffMessage).trim().slice(0, 1500) || base.handoffMessage,
    invalidOptionMessage:
      String(o.invalidOptionMessage ?? base.invalidOptionMessage).trim().slice(0, 800) ||
      base.invalidOptionMessage,
    humanKeywords: Array.isArray(o.humanKeywords)
      ? o.humanKeywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [...base.humanKeywords],
    faqItems: faqItems.length > 0 ? faqItems : [...base.faqItems],
    resetKeywords: Array.isArray(o.resetKeywords)
      ? o.resetKeywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 15)
      : [...base.resetKeywords],
    resetMessage:
      String(o.resetMessage ?? base.resetMessage).trim().slice(0, 400) || base.resetMessage,
    businessHours: {
      enabled: bh.enabled !== false,
      timezone: String(bh.timezone ?? base.businessHours.timezone).trim().slice(0, 64) || base.businessHours.timezone,
      weekdays: weekdays.length > 0 ? weekdays : base.businessHours.weekdays,
      start: String(bh.start ?? base.businessHours.start).trim().slice(0, 5) || base.businessHours.start,
      end: String(bh.end ?? base.businessHours.end).trim().slice(0, 5) || base.businessHours.end
    },
    botOnlyOutsideHours: o.botOnlyOutsideHours === true,
    menuCooldownMinutes: Math.min(
      24 * 60,
      Math.max(5, Math.round(Number(o.menuCooldownMinutes) || base.menuCooldownMinutes))
    )
  };
}

export async function loadSupportBotConfigPg(tenantId: string): Promise<SupportBotConfig> {
  const pool = getZapmassPool();
  if (!pool) return { ...DEFAULT_SUPPORT_BOT_CONFIG, options: [...DEFAULT_SUPPORT_BOT_CONFIG.options] };
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return { ...DEFAULT_SUPPORT_BOT_CONFIG, options: [...DEFAULT_SUPPORT_BOT_CONFIG.options] };
  const r = await pool.query<{ doc: unknown }>(
    `SELECT doc FROM zapmass.tenant_support_bot WHERE tenant_id = $1::uuid`,
    [tid]
  );
  return normalizeSupportBotConfig(r.rows[0]?.doc);
}

export async function saveSupportBotConfigPg(tenantId: string, config: SupportBotConfig): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return;
  const doc = normalizeSupportBotConfig(config);
  await pool.query(
    `INSERT INTO zapmass.tenant_support_bot (tenant_id, doc, updated_at)
     VALUES ($1::uuid, $2::jsonb, now())
     ON CONFLICT (tenant_id) DO UPDATE SET doc = $2::jsonb, updated_at = now()`,
    [tid, JSON.stringify(doc)]
  );
}

export type SupportBotSessionRow = {
  state: 'menu' | 'handoff';
  lastMenuSentAt: Date | null;
  handedOffAt: Date | null;
};

export async function loadSupportBotSessionPg(
  tenantId: string,
  connectionId: string,
  phoneDigits: string
): Promise<SupportBotSessionRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return null;
  const r = await pool.query<{
    state: string;
    last_menu_sent_at: Date | null;
    handed_off_at: Date | null;
  }>(
    `SELECT state, last_menu_sent_at, handed_off_at
     FROM zapmass.support_bot_sessions
     WHERE tenant_id = $1::uuid AND connection_id = $2 AND phone_digits = $3`,
    [tid, connectionId, phoneDigits]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    state: row.state === 'handoff' ? 'handoff' : 'menu',
    lastMenuSentAt: row.last_menu_sent_at,
    handedOffAt: row.handed_off_at
  };
}

export async function upsertSupportBotSessionPg(
  tenantId: string,
  connectionId: string,
  phoneDigits: string,
  conversationId: string,
  patch: Partial<{ state: 'menu' | 'handoff'; lastMenuSentAt: Date; handedOffAt: Date }>
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return;
  const existing = await loadSupportBotSessionPg(tenantId, connectionId, phoneDigits);
  const state = patch.state ?? existing?.state ?? 'menu';
  const lastMenuSentAt = patch.lastMenuSentAt ?? existing?.lastMenuSentAt ?? null;
  const handedOffAt = patch.handedOffAt ?? existing?.handedOffAt ?? null;
  await pool.query(
    `INSERT INTO zapmass.support_bot_sessions
       (tenant_id, connection_id, phone_digits, conversation_id, state, last_menu_sent_at, handed_off_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (tenant_id, connection_id, phone_digits) DO UPDATE SET
       conversation_id = EXCLUDED.conversation_id,
       state = EXCLUDED.state,
       last_menu_sent_at = EXCLUDED.last_menu_sent_at,
       handed_off_at = EXCLUDED.handed_off_at,
       updated_at = now()`,
    [tid, connectionId, phoneDigits, conversationId, state, lastMenuSentAt, handedOffAt]
  );
}

export async function loadSupportBotMetricsPg(tenantId: string): Promise<SupportBotMetrics> {
  const pool = getZapmassPool();
  if (!pool) return { botReplies: 0, handoffs: 0, menuShown: 0 };
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return { botReplies: 0, handoffs: 0, menuShown: 0 };
  const r = await pool.query<{ bot_replies: number; handoffs: number; menu_shown: number }>(
    `SELECT bot_replies, handoffs, menu_shown FROM zapmass.support_bot_metrics WHERE tenant_id = $1::uuid`,
    [tid]
  );
  const row = r.rows[0];
  if (!row) return { botReplies: 0, handoffs: 0, menuShown: 0 };
  return {
    botReplies: Number(row.bot_replies) || 0,
    handoffs: Number(row.handoffs) || 0,
    menuShown: Number(row.menu_shown) || 0
  };
}

export async function bumpSupportBotMetricPg(
  tenantId: string,
  field: keyof SupportBotMetrics
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return;
  const col =
    field === 'botReplies' ? 'bot_replies' : field === 'handoffs' ? 'handoffs' : 'menu_shown';
  await pool.query(
    `INSERT INTO zapmass.support_bot_metrics (tenant_id, ${col}, updated_at)
     VALUES ($1::uuid, 1, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       ${col} = zapmass.support_bot_metrics.${col} + 1,
       updated_at = now()`,
    [tid]
  );
}

export async function resetSupportBotSessionPg(
  tenantId: string,
  connectionId: string,
  phoneDigits: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return;
  await pool.query(
    `UPDATE zapmass.support_bot_sessions
     SET state = 'menu', handed_off_at = NULL, last_menu_sent_at = NULL, updated_at = now()
     WHERE tenant_id = $1::uuid AND connection_id = $2 AND phone_digits = $3`,
    [tid, connectionId, phoneDigits]
  );
}

export async function resetSupportBotSessionByConversationPg(
  tenantId: string,
  conversationId: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid) || !conversationId.trim()) return;
  await pool.query(
    `UPDATE zapmass.support_bot_sessions
     SET state = 'menu', handed_off_at = NULL, last_menu_sent_at = NULL, updated_at = now()
     WHERE tenant_id = $1::uuid AND conversation_id = $2`,
    [tid, conversationId.trim()]
  );
}

export async function insertSupportBotHandoffPg(
  tenantId: string,
  connectionId: string,
  phoneDigits: string,
  conversationId: string,
  previewMessage: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return;
  await pool.query(
    `INSERT INTO zapmass.support_bot_handoffs
       (tenant_id, connection_id, phone_digits, conversation_id, preview_message)
     VALUES ($1::uuid, $2, $3, $4, $5)`,
    [tid, connectionId, phoneDigits, conversationId, previewMessage.slice(0, 500)]
  );
}

export async function listSupportBotHandoffsPg(
  tenantId: string,
  limit = 30
): Promise<SupportBotHandoffRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return [];
  const cap = Math.min(100, Math.max(1, Math.round(limit)));
  const r = await pool.query<{
    id: string;
    connection_id: string;
    phone_digits: string;
    conversation_id: string;
    preview_message: string;
    created_at: Date;
  }>(
    `SELECT id, connection_id, phone_digits, conversation_id, preview_message, created_at
     FROM zapmass.support_bot_handoffs
     WHERE tenant_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2`,
    [tid, cap]
  );
  return r.rows.map((row) => ({
    id: row.id,
    connectionId: row.connection_id,
    phoneDigits: row.phone_digits,
    conversationId: row.conversation_id,
    previewMessage: row.preview_message,
    createdAt: row.created_at.toISOString()
  }));
}
