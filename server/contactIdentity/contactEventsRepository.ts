import { resolvePostgresTenantId } from '../auth/firebaseUidMap.js';
import { getZapmassPool } from '../db/postgres.js';
import { canonicalContactPhoneDigits } from './contactPhone.js';
import { leadBandFromScore, scoreDeltaForEvent, type LeadBand } from './contactLeadScore.js';

export type ContactEventRow = {
  id: string;
  kind: string;
  connection_id: string | null;
  campaign_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
};

function pgTenant(tenantId: string): string {
  return resolvePostgresTenantId(String(tenantId || '').trim());
}

export async function appendContactEvent(params: {
  tenantId: string;
  phone: string;
  kind: string;
  connectionId?: string;
  campaignId?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const phoneDigits = canonicalContactPhoneDigits(params.phone);
  if (phoneDigits.length < 8) return;
  const tid = pgTenant(params.tenantId);
  const delta = scoreDeltaForEvent(params.kind);
  const optedOut = params.kind === 'opt_out';
  try {
    await pool.query(
      `INSERT INTO zapmass.contact_events
         (tenant_id, phone_digits, kind, connection_id, campaign_id, payload)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::jsonb)`,
      [
        tid,
        phoneDigits,
        params.kind,
        params.connectionId ? String(params.connectionId).slice(0, 220) : null,
        params.campaignId || null,
        JSON.stringify(params.payload || {}),
      ]
    );
    const prev = await pool.query<{ lead_score: number }>(
      `SELECT lead_score FROM zapmass.contact_identity
        WHERE tenant_id = $1::uuid AND phone_digits = $2`,
      [tid, phoneDigits]
    );
    const base = prev.rows[0]?.lead_score ?? 0;
    const nextScore = optedOut ? 0 : Math.max(0, Math.min(100, base + delta));
    const band = leadBandFromScore(nextScore, optedOut);
    await pool.query(
      `INSERT INTO zapmass.contact_identity
         (tenant_id, phone_digits, lead_score, lead_band, preferred_connection_id,
          last_campaign_id, last_event_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, NOW(), NOW())
       ON CONFLICT (tenant_id, phone_digits) DO UPDATE SET
         lead_score = EXCLUDED.lead_score,
         lead_band = EXCLUDED.lead_band,
         preferred_connection_id = COALESCE(EXCLUDED.preferred_connection_id, zapmass.contact_identity.preferred_connection_id),
         last_campaign_id = COALESCE(EXCLUDED.last_campaign_id, zapmass.contact_identity.last_campaign_id),
         last_event_at = NOW(),
         updated_at = NOW()`,
      [
        tid,
        phoneDigits,
        nextScore,
        band,
        params.connectionId || null,
        params.campaignId || null,
      ]
    );
  } catch (err) {
    console.warn('[ContactEvents] append falhou:', (err as Error)?.message);
  }
}

export async function listContactEvents(
  tenantId: string,
  phone: string,
  limit = 50
): Promise<ContactEventRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const phoneDigits = canonicalContactPhoneDigits(phone);
  const tid = pgTenant(tenantId);
  const r = await pool.query<ContactEventRow>(
    `SELECT id::text, kind, connection_id, campaign_id::text, payload, created_at
       FROM zapmass.contact_events
      WHERE tenant_id = $1::uuid AND phone_digits = $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [tid, phoneDigits, Math.min(200, Math.max(1, limit))]
  );
  return r.rows.map((row) => ({
    ...row,
    payload: (row.payload as Record<string, unknown>) || {},
  }));
}

export async function upsertPreferredConnection(
  tenantId: string,
  phone: string,
  connectionId: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const phoneDigits = canonicalContactPhoneDigits(phone);
  const tid = pgTenant(tenantId);
  await pool.query(
    `INSERT INTO zapmass.contact_identity (tenant_id, phone_digits, preferred_connection_id, updated_at)
     VALUES ($1::uuid, $2, $3, NOW())
     ON CONFLICT (tenant_id, phone_digits) DO UPDATE SET
       preferred_connection_id = EXCLUDED.preferred_connection_id,
       updated_at = NOW()`,
    [tid, phoneDigits, connectionId.slice(0, 220)]
  );
}

export async function saveReplyFlowStateForContact(
  tenantId: string,
  phone: string,
  state: Record<string, unknown>
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const phoneDigits = canonicalContactPhoneDigits(phone);
  const tid = pgTenant(tenantId);
  await pool.query(
    `INSERT INTO zapmass.contact_identity (tenant_id, phone_digits, reply_flow_state, updated_at)
     VALUES ($1::uuid, $2, $3::jsonb, NOW())
     ON CONFLICT (tenant_id, phone_digits) DO UPDATE SET
       reply_flow_state = EXCLUDED.reply_flow_state,
       updated_at = NOW()`,
    [tid, phoneDigits, JSON.stringify(state)]
  );
}

export async function loadReplyFlowStateForContact(
  tenantId: string,
  phone: string
): Promise<Record<string, unknown> | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const phoneDigits = canonicalContactPhoneDigits(phone);
  const tid = pgTenant(tenantId);
  const r = await pool.query<{ reply_flow_state: Record<string, unknown> | null }>(
    `SELECT reply_flow_state FROM zapmass.contact_identity
      WHERE tenant_id = $1::uuid AND phone_digits = $2`,
    [tid, phoneDigits]
  );
  return r.rows[0]?.reply_flow_state ?? null;
}

export async function getContactIdentityRow(
  tenantId: string,
  phone: string
): Promise<{
  phoneDigits: string;
  preferredConnectionId: string | null;
  leadScore: number;
  leadBand: LeadBand;
  lastCampaignId: string | null;
  replyFlowState: Record<string, unknown> | null;
} | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const phoneDigits = canonicalContactPhoneDigits(phone);
  const tid = pgTenant(tenantId);
  const r = await pool.query<{
    phone_digits: string;
    preferred_connection_id: string | null;
    lead_score: number;
    lead_band: LeadBand;
    last_campaign_id: string | null;
    reply_flow_state: Record<string, unknown> | null;
  }>(
    `SELECT phone_digits, preferred_connection_id, lead_score, lead_band,
            last_campaign_id::text, reply_flow_state
       FROM zapmass.contact_identity
      WHERE tenant_id = $1::uuid AND phone_digits = $2`,
    [tid, phoneDigits]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    phoneDigits: row.phone_digits,
    preferredConnectionId: row.preferred_connection_id,
    leadScore: row.lead_score,
    leadBand: row.lead_band,
    lastCampaignId: row.last_campaign_id,
    replyFlowState: row.reply_flow_state,
  };
}
