import { getZapmassPool } from '../db/postgres.js';

export type ContactStateStatus =
  | 'pending'
  | 'waiting_reply'
  | 'waiting_delay'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface CampaignContactStateRow {
  id: string;
  campaign_id: string;
  contact_id: string;
  tenant_id: string;
  current_step_index: number;
  status: ContactStateStatus;
  step_entered_at: Date;
  last_message_at: Date | null;
  attempts: number;
  error_message: string | null;
  reply_received_at: Date | null;
  reply_text: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Agrega contagens por status e step para o dashboard de progresso. */
export interface ContactStateStepSummary {
  step_index: number;
  status: ContactStateStatus;
  count: number;
}

export async function upsertContactState(
  tenantId: string,
  campaignId: string,
  contactId: string,
  stepIndex: number,
  status: ContactStateStatus = 'pending'
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO zapmass.campaign_contact_state
       (campaign_id, contact_id, tenant_id, current_step_index, status)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5)
     ON CONFLICT (campaign_id, contact_id)
     DO UPDATE SET
       current_step_index = EXCLUDED.current_step_index,
       status             = EXCLUDED.status,
       step_entered_at    = CASE WHEN zapmass.campaign_contact_state.current_step_index <> EXCLUDED.current_step_index
                                 THEN NOW() ELSE zapmass.campaign_contact_state.step_entered_at END,
       updated_at         = NOW()`,
    [campaignId, contactId, tenantId, stepIndex, status]
  );
}

export async function bulkInitContactStates(
  tenantId: string,
  campaignId: string,
  contactIds: string[]
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool || contactIds.length === 0) return;

  // Insere em lotes de 500 para não explodir o statement
  const BATCH = 500;
  for (let i = 0; i < contactIds.length; i += BATCH) {
    const slice = contactIds.slice(i, i + BATCH);
    const values = slice
      .map((_, j) => {
        const base = j * 3;
        return `($${base + 1}::uuid, $${base + 2}, $${base + 3}::uuid)`;
      })
      .join(', ');
    const params: unknown[] = [];
    for (const cid of slice) {
      params.push(campaignId, cid, tenantId);
    }
    await pool.query(
      `INSERT INTO zapmass.campaign_contact_state
         (campaign_id, contact_id, tenant_id)
       VALUES ${values}
       ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
      params
    );
  }
}

export async function getContactState(
  campaignId: string,
  contactId: string
): Promise<CampaignContactStateRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<CampaignContactStateRow>(
    `SELECT id::text, campaign_id::text, contact_id, tenant_id::text,
            current_step_index, status, step_entered_at, last_message_at,
            attempts, error_message, reply_received_at, reply_text, created_at, updated_at
     FROM zapmass.campaign_contact_state
     WHERE campaign_id = $1::uuid AND contact_id = $2`,
    [campaignId, contactId]
  );
  return r.rows[0] ?? null;
}

export async function advanceContactToStep(
  campaignId: string,
  contactId: string,
  newStepIndex: number,
  newStatus: ContactStateStatus,
  lastMessageAt?: Date
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `UPDATE zapmass.campaign_contact_state
     SET current_step_index = $3,
         status             = $4,
         step_entered_at    = NOW(),
         last_message_at    = COALESCE($5, last_message_at),
         attempts           = 0,
         updated_at         = NOW()
     WHERE campaign_id = $1::uuid AND contact_id = $2`,
    [campaignId, contactId, newStepIndex, newStatus, lastMessageAt ?? null]
  );
}

export async function markContactWaitingReply(
  campaignId: string,
  contactId: string,
  stepIndex: number
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `UPDATE zapmass.campaign_contact_state
     SET status             = 'waiting_reply',
         current_step_index = $3,
         step_entered_at    = NOW(),
         last_message_at    = NOW(),
         updated_at         = NOW()
     WHERE campaign_id = $1::uuid AND contact_id = $2`,
    [campaignId, contactId, stepIndex]
  );
}

export async function recordContactReply(
  campaignId: string,
  contactId: string,
  replyText: string
): Promise<CampaignContactStateRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<CampaignContactStateRow>(
    `UPDATE zapmass.campaign_contact_state
     SET reply_text        = $3,
         reply_received_at = NOW(),
         updated_at        = NOW()
     WHERE campaign_id = $1::uuid AND contact_id = $2
       AND status = 'waiting_reply'
     RETURNING id::text, campaign_id::text, contact_id, tenant_id::text,
               current_step_index, status, step_entered_at, last_message_at,
               attempts, error_message, reply_received_at, reply_text, created_at, updated_at`,
    [campaignId, contactId, replyText.slice(0, 4000)]
  );
  return r.rows[0] ?? null;
}

export async function markContactFailed(
  campaignId: string,
  contactId: string,
  errorMessage: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `UPDATE zapmass.campaign_contact_state
     SET status        = 'failed',
         error_message = $3,
         attempts      = attempts + 1,
         updated_at    = NOW()
     WHERE campaign_id = $1::uuid AND contact_id = $2`,
    [campaignId, contactId, errorMessage.slice(0, 2000)]
  );
}

export async function markContactCompleted(
  campaignId: string,
  contactId: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `UPDATE zapmass.campaign_contact_state
     SET status     = 'completed',
         updated_at = NOW()
     WHERE campaign_id = $1::uuid AND contact_id = $2`,
    [campaignId, contactId]
  );
}

export async function markContactSkipped(
  campaignId: string,
  contactId: string
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  await pool.query(
    `UPDATE zapmass.campaign_contact_state
     SET status     = 'skipped',
         updated_at = NOW()
     WHERE campaign_id = $1::uuid AND contact_id = $2`,
    [campaignId, contactId]
  );
}

/** Contatos aguardando resposta antes da próxima etapa (motor multi-etapas). */
export async function countWaitingReplyForCampaign(campaignId: string): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count
     FROM zapmass.campaign_contact_state
     WHERE campaign_id = $1::uuid AND status = 'waiting_reply'`,
    [campaignId]
  );
  return Number(r.rows[0]?.count) || 0;
}

/** Retorna todos os contatos em waiting_reply para uma campanha. */
export async function listWaitingReplyContacts(
  campaignId: string
): Promise<CampaignContactStateRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<CampaignContactStateRow>(
    `SELECT id::text, campaign_id::text, contact_id, tenant_id::text,
            current_step_index, status, step_entered_at, last_message_at,
            attempts, error_message, reply_received_at, reply_text, created_at, updated_at
     FROM zapmass.campaign_contact_state
     WHERE campaign_id = $1::uuid AND status = 'waiting_reply'
     ORDER BY step_entered_at ASC`,
    [campaignId]
  );
  return r.rows;
}

/** Dashboard: agrega contagens por (step_index, status) para uma campanha. */
export async function getContactStateSummary(
  campaignId: string
): Promise<ContactStateStepSummary[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<ContactStateStepSummary>(
    `SELECT current_step_index AS step_index, status, COUNT(*)::int AS count
     FROM zapmass.campaign_contact_state
     WHERE campaign_id = $1::uuid
     GROUP BY current_step_index, status
     ORDER BY current_step_index, status`,
    [campaignId]
  );
  return r.rows;
}

/** Verifica se existe registro waiting_reply para o contactId em QUALQUER campanha ativa do tenant. */
export async function findWaitingReplyStateForContact(
  tenantId: string,
  contactId: string
): Promise<CampaignContactStateRow | null> {
  const pool = getZapmassPool();
  if (!pool) return null;
  const r = await pool.query<CampaignContactStateRow>(
    `SELECT s.id::text, s.campaign_id::text, s.contact_id, s.tenant_id::text,
            s.current_step_index, s.status, s.step_entered_at, s.last_message_at,
            s.attempts, s.error_message, s.reply_received_at, s.reply_text,
            s.created_at, s.updated_at
     FROM zapmass.campaign_contact_state s
     JOIN zapmass.campaigns c ON c.id = s.campaign_id
     WHERE s.tenant_id = $1::uuid
       AND s.contact_id = $2
       AND s.status = 'waiting_reply'
       AND c.status IN ('RUNNING', 'WAITING_REPLY')
     ORDER BY s.step_entered_at DESC
     LIMIT 1`,
    [tenantId, contactId]
  );
  return r.rows[0] ?? null;
}

/** Retorna falhos que podem ser reenviados para uma etapa específica. */
export async function listFailedContactsAtStep(
  campaignId: string,
  stepIndex: number
): Promise<CampaignContactStateRow[]> {
  const pool = getZapmassPool();
  if (!pool) return [];
  const r = await pool.query<CampaignContactStateRow>(
    `SELECT id::text, campaign_id::text, contact_id, tenant_id::text,
            current_step_index, status, step_entered_at, last_message_at,
            attempts, error_message, reply_received_at, reply_text, created_at, updated_at
     FROM zapmass.campaign_contact_state
     WHERE campaign_id = $1::uuid
       AND status = 'failed'
       AND current_step_index = $2
     ORDER BY updated_at DESC`,
    [campaignId, stepIndex]
  );
  return r.rows;
}

/** Reseta falhos para pending, permitindo reenvio. */
export async function resetFailedContactsAtStep(
  campaignId: string,
  stepIndex: number
): Promise<number> {
  const pool = getZapmassPool();
  if (!pool) return 0;
  const r = await pool.query(
    `UPDATE zapmass.campaign_contact_state
     SET status     = 'pending',
         attempts   = 0,
         updated_at = NOW()
     WHERE campaign_id = $1::uuid
       AND status = 'failed'
       AND current_step_index = $2`,
    [campaignId, stepIndex]
  );
  return r.rowCount ?? 0;
}
