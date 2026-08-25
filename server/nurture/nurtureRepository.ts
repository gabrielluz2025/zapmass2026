import { getZapmassPool } from '../db/postgres.js';
import { resolvePostgresTenantId } from '../auth/firebaseUidMap.js';
import {
  DEFAULT_NURTURE_JOURNEY_DOC,
  type NurtureEnrollmentRow,
  type NurtureEnrollmentStatus,
  type NurtureJourneyDoc,
  type NurtureJourneyRow,
  type NurtureMetrics,
  type NurtureStep,
  type NurtureStepOption
} from './nurtureTypes.js';

function pgTenantId(tenantId: string): string {
  return resolvePostgresTenantId(String(tenantId || '').trim());
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function sanitizeOption(raw: unknown, index: number): NurtureStepOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? index + 1).trim().slice(0, 8) || String(index + 1);
  const reply = String(o.reply ?? '').trim().slice(0, 2000);
  const tokens = Array.isArray(o.tokens)
    ? o.tokens.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 12)
    : [];
  if (tokens.length === 0) return null;
  return {
    id,
    tokens,
    reply,
    ...(o.handoff === true ? { handoff: true } : {})
  };
}

function sanitizeStep(raw: unknown, index: number): NurtureStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? `step-${index + 1}`).trim().slice(0, 32) || `step-${index + 1}`;
  const body = String(o.body ?? '').trim().slice(0, 4000);
  if (!body) return null;
  const kind: NurtureStep['kind'] = o.kind === 'wait_reply' ? 'wait_reply' : 'message';
  const optionsRaw = Array.isArray(o.options) ? o.options : [];
  const options = optionsRaw
    .slice(0, 6)
    .map((row, i) => sanitizeOption(row, i))
    .filter((x): x is NurtureStepOption => x != null);
  let calendar: NurtureStep['calendar'];
  if (o.calendar && typeof o.calendar === 'object') {
    const c = o.calendar as Record<string, unknown>;
    const weekday = Math.min(6, Math.max(0, Math.round(Number(c.weekday) || 0)));
    const time = String(c.time ?? '09:00').trim().slice(0, 5) || '09:00';
    calendar = { weekday, time };
  }
  return {
    id,
    label: String(o.label ?? '').trim().slice(0, 80) || undefined,
    kind,
    body,
    delayHours: Math.min(24 * 14, Math.max(0, Math.round(Number(o.delayHours) || 0))),
    ...(calendar ? { calendar } : {}),
    ...(options.length > 0 ? { options } : {}),
    timeoutHours: o.timeoutHours != null ? Math.min(168, Math.max(1, Math.round(Number(o.timeoutHours)))) : undefined,
    timeoutMessage: o.timeoutMessage ? String(o.timeoutMessage).trim().slice(0, 1500) : undefined
  };
}

export function normalizeNurtureJourneyDoc(raw: unknown): NurtureJourneyDoc {
  const base = DEFAULT_NURTURE_JOURNEY_DOC;
  if (!raw || typeof raw !== 'object') {
    return { ...base, steps: [...base.steps] };
  }
  const o = raw as Record<string, unknown>;
  const stepsRaw = Array.isArray(o.steps) ? o.steps : base.steps;
  const steps = stepsRaw
    .slice(0, 10)
    .map((row, i) => sanitizeStep(row, i))
    .filter((x): x is NurtureStep => x != null);
  const er = (o.entryRules && typeof o.entryRules === 'object' ? o.entryRules : {}) as Record<
    string,
    unknown
  >;
  const bh = (o.businessHours && typeof o.businessHours === 'object' ? o.businessHours : {}) as Record<
    string,
    unknown
  >;
  const weekdays = Array.isArray(bh.weekdays)
    ? bh.weekdays.map((d) => Number(d)).filter((n) => n >= 0 && n <= 6)
    : base.businessHours.weekdays;
  return {
    enabled: o.enabled === true,
    name: String(o.name ?? base.name).trim().slice(0, 120) || base.name,
    connectionIds: Array.isArray(o.connectionIds)
      ? o.connectionIds.map((c) => String(c).trim()).filter(Boolean).slice(0, 20)
      : [],
    scheduleMode: o.scheduleMode === 'calendar' ? 'calendar' : 'relative',
    entryRules: {
      autoEnrollOnOptIn: er.autoEnrollOnOptIn !== false,
      requireMarketingOptIn: er.requireMarketingOptIn !== false
    },
    steps: steps.length > 0 ? steps : [...base.steps],
    businessHours: {
      enabled: bh.enabled !== false,
      timezone: String(bh.timezone ?? base.businessHours.timezone).trim().slice(0, 64) || base.businessHours.timezone,
      weekdays: weekdays.length > 0 ? weekdays : base.businessHours.weekdays,
      start: String(bh.start ?? base.businessHours.start).trim().slice(0, 5) || base.businessHours.start,
      end: String(bh.end ?? base.businessHours.end).trim().slice(0, 5) || base.businessHours.end
    },
    stopOnHumanClaim: o.stopOnHumanClaim !== false,
    globalOptOutKeywords: Array.isArray(o.globalOptOutKeywords)
      ? o.globalOptOutKeywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [...base.globalOptOutKeywords],
    maxMessagesPerDayPerContact: Math.min(
      3,
      Math.max(1, Math.round(Number(o.maxMessagesPerDayPerContact) || base.maxMessagesPerDayPerContact))
    )
  };
}

function mapJourneyRow(row: {
  id: string;
  name: string;
  enabled: boolean;
  doc: unknown;
  created_at: Date;
  updated_at: Date;
}): NurtureJourneyRow {
  const doc = normalizeNurtureJourneyDoc(row.doc);
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    doc,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapEnrollmentRow(row: {
  id: string;
  journey_id: string;
  contact_phone: string;
  connection_id: string;
  conversation_id: string;
  status: string;
  current_step_index: number;
  step_entered_at: Date;
  next_run_at: Date | null;
  enrolled_at: Date;
  completed_at: Date | null;
  pause_reason: string | null;
}): NurtureEnrollmentRow {
  return {
    id: row.id,
    journeyId: row.journey_id,
    contactPhone: row.contact_phone,
    connectionId: row.connection_id,
    conversationId: row.conversation_id,
    status: row.status as NurtureEnrollmentStatus,
    currentStepIndex: row.current_step_index,
    stepEnteredAt: row.step_entered_at.toISOString(),
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    enrolledAt: row.enrolled_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    pauseReason: row.pause_reason
  };
}

export async function getOrCreatePrimaryJourneyPg(tenantId: string): Promise<NurtureJourneyRow> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('PostgreSQL indisponível');
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) throw new Error('Tenant inválido');

  const existing = await pool.query<{
    id: string;
    name: string;
    enabled: boolean;
    doc: unknown;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, enabled, doc, created_at, updated_at
     FROM zapmass.nurture_journeys WHERE tenant_id = $1::uuid ORDER BY created_at ASC LIMIT 1`,
    [tid]
  );
  if (existing.rows[0]) return mapJourneyRow(existing.rows[0]);

  const doc = { ...DEFAULT_NURTURE_JOURNEY_DOC, steps: [...DEFAULT_NURTURE_JOURNEY_DOC.steps] };
  const ins = await pool.query<{
    id: string;
    name: string;
    enabled: boolean;
    doc: unknown;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO zapmass.nurture_journeys (tenant_id, name, enabled, doc)
     VALUES ($1::uuid, $2, false, $3::jsonb)
     RETURNING id, name, enabled, doc, created_at, updated_at`,
    [tid, doc.name, JSON.stringify(doc)]
  );
  return mapJourneyRow(ins.rows[0]);
}

export async function saveNurtureJourneyPg(
  tenantId: string,
  journeyId: string,
  patch: { name?: string; enabled?: boolean; doc?: NurtureJourneyDoc }
): Promise<NurtureJourneyRow> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('PostgreSQL indisponível');
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid) || !isUuid(journeyId)) throw new Error('IDs inválidos');

  const current = await pool.query<{ doc: unknown; name: string }>(
    `SELECT doc, name FROM zapmass.nurture_journeys WHERE id = $1::uuid AND tenant_id = $2::uuid`,
    [journeyId, tid]
  );
  if (!current.rows[0]) throw new Error('Jornada não encontrada');

  const doc = patch.doc ? normalizeNurtureJourneyDoc(patch.doc) : normalizeNurtureJourneyDoc(current.rows[0].doc);
  const name = patch.name?.trim().slice(0, 120) || current.rows[0].name;
  const enabled = patch.enabled ?? doc.enabled;

  const r = await pool.query<{
    id: string;
    name: string;
    enabled: boolean;
    doc: unknown;
    created_at: Date;
    updated_at: Date;
  }>(
    `UPDATE zapmass.nurture_journeys
     SET name = $3, enabled = $4, doc = $5::jsonb, updated_at = now()
     WHERE id = $1::uuid AND tenant_id = $2::uuid
     RETURNING id, name, enabled, doc, created_at, updated_at`,
    [journeyId, tid, name, enabled, JSON.stringify({ ...doc, enabled })]
  );
  return mapJourneyRow(r.rows[0]);
}

export async function listNurtureEnrollmentsPg(
  tenantId: string,
  journeyId: string,
  limit = 50
): Promise<NurtureEnrollmentRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return [];
  const cap = Math.min(200, Math.max(1, Math.round(limit)));
  const r = await pool.query<{
    id: string;
    journey_id: string;
    contact_phone: string;
    connection_id: string;
    conversation_id: string;
    status: string;
    current_step_index: number;
    step_entered_at: Date;
    next_run_at: Date | null;
    enrolled_at: Date;
    completed_at: Date | null;
    pause_reason: string | null;
  }>(
    `SELECT id, journey_id, contact_phone, connection_id, conversation_id, status,
            current_step_index, step_entered_at, next_run_at, enrolled_at, completed_at, pause_reason
     FROM zapmass.nurture_enrollments
     WHERE tenant_id = $1::uuid AND journey_id = $2::uuid
     ORDER BY enrolled_at DESC LIMIT $3`,
    [tid, journeyId, cap]
  );
  return r.rows.map(mapEnrollmentRow);
}

export async function findActiveEnrollmentPg(
  tenantId: string,
  connectionId: string,
  contactPhone: string
): Promise<(NurtureEnrollmentRow & { journeyDoc: NurtureJourneyDoc; journeyEnabled: boolean }) | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return null;
  const r = await pool.query<{
    id: string;
    journey_id: string;
    contact_phone: string;
    connection_id: string;
    conversation_id: string;
    status: string;
    current_step_index: number;
    step_entered_at: Date;
    next_run_at: Date | null;
    enrolled_at: Date;
    completed_at: Date | null;
    pause_reason: string | null;
    doc: unknown;
    journey_enabled: boolean;
  }>(
    `SELECT e.id, e.journey_id, e.contact_phone, e.connection_id, e.conversation_id, e.status,
            e.current_step_index, e.step_entered_at, e.next_run_at, e.enrolled_at, e.completed_at,
            e.pause_reason, j.doc, j.enabled AS journey_enabled
     FROM zapmass.nurture_enrollments e
     JOIN zapmass.nurture_journeys j ON j.id = e.journey_id
     WHERE e.tenant_id = $1::uuid AND e.connection_id = $2 AND e.contact_phone = $3
       AND e.status IN ('enrolled', 'active', 'waiting_reply', 'paused')
     ORDER BY e.enrolled_at DESC LIMIT 1`,
    [tid, connectionId, contactPhone]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    ...mapEnrollmentRow(row),
    journeyDoc: normalizeNurtureJourneyDoc(row.doc),
    journeyEnabled: row.journey_enabled
  };
}

export async function upsertEnrollmentPg(
  tenantId: string,
  journeyId: string,
  data: {
    contactPhone: string;
    connectionId: string;
    conversationId: string;
    status: NurtureEnrollmentStatus;
    currentStepIndex: number;
    nextRunAt: Date | null;
    pauseReason?: string | null;
    lastSentDayKey?: string | null;
  }
): Promise<NurtureEnrollmentRow> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('PostgreSQL indisponível');
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid) || !isUuid(journeyId)) throw new Error('IDs inválidos');

  const r = await pool.query<{
    id: string;
    journey_id: string;
    contact_phone: string;
    connection_id: string;
    conversation_id: string;
    status: string;
    current_step_index: number;
    step_entered_at: Date;
    next_run_at: Date | null;
    enrolled_at: Date;
    completed_at: Date | null;
    pause_reason: string | null;
  }>(
    `INSERT INTO zapmass.nurture_enrollments
       (tenant_id, journey_id, contact_phone, connection_id, conversation_id, status,
        current_step_index, step_entered_at, next_run_at, pause_reason, last_sent_day_key)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, now(), $8, $9, $10)
     ON CONFLICT (journey_id, contact_phone) DO UPDATE SET
       connection_id = EXCLUDED.connection_id,
       conversation_id = EXCLUDED.conversation_id,
       status = EXCLUDED.status,
       current_step_index = EXCLUDED.current_step_index,
       step_entered_at = now(),
       next_run_at = EXCLUDED.next_run_at,
       pause_reason = EXCLUDED.pause_reason,
       last_sent_day_key = COALESCE(EXCLUDED.last_sent_day_key, zapmass.nurture_enrollments.last_sent_day_key),
       completed_at = CASE WHEN EXCLUDED.status IN ('completed','cancelled','failed') THEN now() ELSE NULL END
     RETURNING id, journey_id, contact_phone, connection_id, conversation_id, status,
               current_step_index, step_entered_at, next_run_at, enrolled_at, completed_at, pause_reason`,
    [
      tid,
      journeyId,
      data.contactPhone,
      data.connectionId,
      data.conversationId,
      data.status,
      data.currentStepIndex,
      data.nextRunAt,
      data.pauseReason ?? null,
      data.lastSentDayKey ?? null
    ]
  );
  return mapEnrollmentRow(r.rows[0]);
}

export async function updateEnrollmentStatusPg(
  tenantId: string,
  enrollmentId: string,
  patch: Partial<{
    status: NurtureEnrollmentStatus;
    currentStepIndex: number;
    nextRunAt: Date | null;
    pauseReason: string | null;
    lastSentDayKey: string | null;
  }>
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid) || !isUuid(enrollmentId)) return;

  const sets: string[] = [];
  const vals: unknown[] = [enrollmentId, tid];
  let idx = 3;
  if (patch.status) {
    sets.push(`status = $${idx++}`);
    vals.push(patch.status);
    if (['completed', 'cancelled', 'failed'].includes(patch.status)) {
      sets.push(`completed_at = now()`);
    }
  }
  if (patch.currentStepIndex != null) {
    sets.push(`current_step_index = $${idx++}`);
    vals.push(patch.currentStepIndex);
    sets.push(`step_entered_at = now()`);
  }
  if (patch.nextRunAt !== undefined) {
    sets.push(`next_run_at = $${idx++}`);
    vals.push(patch.nextRunAt);
  }
  if (patch.pauseReason !== undefined) {
    sets.push(`pause_reason = $${idx++}`);
    vals.push(patch.pauseReason);
  }
  if (patch.lastSentDayKey !== undefined) {
    sets.push(`last_sent_day_key = $${idx++}`);
    vals.push(patch.lastSentDayKey);
  }
  if (sets.length === 0) return;
  await pool.query(
    `UPDATE zapmass.nurture_enrollments SET ${sets.join(', ')} WHERE id = $1::uuid AND tenant_id = $2::uuid`,
    vals
  );
}

export async function listDueEnrollmentsPg(limit = 100): Promise<
  Array<
    NurtureEnrollmentRow & {
      tenantId: string;
      journeyDoc: NurtureJourneyDoc;
      lastSentDayKey: string | null;
    }
  >
> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const cap = Math.min(500, Math.max(1, Math.round(limit)));
  const r = await pool.query<{
    id: string;
    tenant_id: string;
    journey_id: string;
    contact_phone: string;
    connection_id: string;
    conversation_id: string;
    status: string;
    current_step_index: number;
    step_entered_at: Date;
    next_run_at: Date | null;
    enrolled_at: Date;
    completed_at: Date | null;
    pause_reason: string | null;
    last_sent_day_key: string | null;
    doc: unknown;
  }>(
    `SELECT e.id, e.tenant_id, e.journey_id, e.contact_phone, e.connection_id, e.conversation_id,
            e.status, e.current_step_index, e.step_entered_at, e.next_run_at, e.enrolled_at,
            e.completed_at, e.pause_reason, e.last_sent_day_key, j.doc
     FROM zapmass.nurture_enrollments e
     JOIN zapmass.nurture_journeys j ON j.id = e.journey_id AND j.enabled = true
     WHERE e.status IN ('enrolled', 'active', 'waiting_reply')
       AND e.next_run_at IS NOT NULL AND e.next_run_at <= now()
     ORDER BY e.next_run_at ASC
     LIMIT $1`,
    [cap]
  );
  return r.rows.map((row) => ({
    ...mapEnrollmentRow(row),
    tenantId: row.tenant_id,
    journeyDoc: normalizeNurtureJourneyDoc(row.doc),
    lastSentDayKey: row.last_sent_day_key
  }));
}

export async function loadNurtureMetricsPg(tenantId: string, journeyId: string): Promise<NurtureMetrics> {
  const pool = getZapmassPool();
  const empty: NurtureMetrics = {
    materialsSent: 0,
    repliesReceived: 0,
    handoffs: 0,
    optOuts: 0,
    completed: 0,
    activeEnrollments: 0
  };
  if (!pool) return empty;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return empty;
  const r = await pool.query<{
    materials_sent: number;
    replies_received: number;
    handoffs: number;
    opt_outs: number;
    completed: number;
    active_enrollments: number;
  }>(
    `SELECT materials_sent, replies_received, handoffs, opt_outs, completed, active_enrollments
     FROM zapmass.nurture_metrics WHERE tenant_id = $1::uuid AND journey_id = $2::uuid`,
    [tid, journeyId]
  );
  const row = r.rows[0];
  if (!row) {
    const active = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM zapmass.nurture_enrollments
       WHERE tenant_id = $1::uuid AND journey_id = $2::uuid
         AND status IN ('enrolled','active','waiting_reply','paused')`,
      [tid, journeyId]
    );
    return { ...empty, activeEnrollments: Number(active.rows[0]?.n) || 0 };
  }
  return {
    materialsSent: Number(row.materials_sent) || 0,
    repliesReceived: Number(row.replies_received) || 0,
    handoffs: Number(row.handoffs) || 0,
    optOuts: Number(row.opt_outs) || 0,
    completed: Number(row.completed) || 0,
    activeEnrollments: Number(row.active_enrollments) || 0
  };
}

export async function bumpNurtureMetricPg(
  tenantId: string,
  journeyId: string,
  field: keyof Omit<NurtureMetrics, 'activeEnrollments'>,
  delta = 1
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid) || !isUuid(journeyId)) return;
  const colMap: Record<string, string> = {
    materialsSent: 'materials_sent',
    repliesReceived: 'replies_received',
    handoffs: 'handoffs',
    optOuts: 'opt_outs',
    completed: 'completed'
  };
  const col = colMap[field];
  if (!col) return;
  await pool.query(
    `INSERT INTO zapmass.nurture_metrics (tenant_id, journey_id, ${col}, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, now())
     ON CONFLICT (tenant_id, journey_id) DO UPDATE SET
       ${col} = zapmass.nurture_metrics.${col} + $3,
       updated_at = now()`,
    [tid, journeyId, delta]
  );
}

export async function refreshActiveEnrollmentCountPg(tenantId: string, journeyId: string): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid)) return;
  await pool.query(
    `INSERT INTO zapmass.nurture_metrics (tenant_id, journey_id, active_enrollments, updated_at)
     SELECT $1::uuid, $2::uuid,
            (SELECT COUNT(*)::int FROM zapmass.nurture_enrollments
             WHERE tenant_id = $1::uuid AND journey_id = $2::uuid
               AND status IN ('enrolled','active','waiting_reply','paused')),
            now()
     ON CONFLICT (tenant_id, journey_id) DO UPDATE SET
       active_enrollments = EXCLUDED.active_enrollments,
       updated_at = now()`,
    [tid, journeyId]
  );
}

export async function loadJourneyByIdPg(tenantId: string, journeyId: string): Promise<NurtureJourneyRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid) || !isUuid(journeyId)) return null;
  const r = await pool.query<{
    id: string;
    name: string;
    enabled: boolean;
    doc: unknown;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, enabled, doc, created_at, updated_at
     FROM zapmass.nurture_journeys WHERE id = $1::uuid AND tenant_id = $2::uuid`,
    [journeyId, tid]
  );
  return r.rows[0] ? mapJourneyRow(r.rows[0]) : null;
}

export async function pauseEnrollmentsByConversationPg(
  tenantId: string,
  conversationId: string,
  reason: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid) || !conversationId.trim()) return;
  await pool.query(
    `UPDATE zapmass.nurture_enrollments
     SET status = 'paused', pause_reason = $3, next_run_at = NULL
     WHERE tenant_id = $1::uuid AND conversation_id = $2
       AND status IN ('enrolled','active','waiting_reply')`,
    [tid, conversationId.trim(), reason]
  );
}

export async function resumeEnrollmentsByConversationPg(tenantId: string, conversationId: string): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const tid = pgTenantId(tenantId);
  if (!tid || !isUuid(tid) || !conversationId.trim()) return;
  await pool.query(
    `UPDATE zapmass.nurture_enrollments
     SET status = 'active', pause_reason = NULL, next_run_at = now() + interval '5 minutes'
     WHERE tenant_id = $1::uuid AND conversation_id = $2 AND status = 'paused'`,
    [tid, conversationId.trim()]
  );
}
