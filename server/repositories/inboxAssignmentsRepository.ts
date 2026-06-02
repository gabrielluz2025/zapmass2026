import { getZapmassPool } from '../db/postgres.js';

export type InboxFinishSatisfactionPg = {
  skipped: boolean;
  rating?: number | null;
  comment?: string | null;
};

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function listInboxAssignmentsPg(tenantId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isUuid(tenantId)) return out;
  const pool = getZapmassPool();
  if (!pool) return out;
  const r = await pool.query<{ conversation_id: string; claimed_by_subject_id: string }>(
    `SELECT conversation_id, claimed_by_subject_id
     FROM zapmass.inbox_assignments WHERE tenant_id = $1::uuid`,
    [tenantId]
  );
  for (const row of r.rows) {
    const v = String(row.claimed_by_subject_id || '').trim();
    if (v) out.set(row.conversation_id, v);
  }
  return out;
}

export async function inboxClaimConversationPg(
  tenantId: string,
  staffAuthUid: string,
  conversationId: string,
  connectionId: string
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!isUuid(tenantId)) return { ok: false, code: 'NO_ADMIN' };
  const pool = getZapmassPool();
  if (!pool) return { ok: false, code: 'NO_ADMIN' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ claimed_by_subject_id: string }>(
      `SELECT claimed_by_subject_id FROM zapmass.inbox_assignments
       WHERE tenant_id = $1::uuid AND conversation_id = $2 FOR UPDATE`,
      [tenantId, conversationId]
    );
    const existing = cur.rows[0]?.claimed_by_subject_id?.trim() || '';
    const tenantOwnerTakingOver = staffAuthUid === tenantId;
    if (existing && existing !== staffAuthUid && !tenantOwnerTakingOver) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'ALREADY_CLAIMED' };
    }
    if (existing === staffAuthUid) {
      await client.query('COMMIT');
      return { ok: true };
    }
    await client.query(
      `INSERT INTO zapmass.inbox_assignments
         (tenant_id, conversation_id, claimed_by_subject_id, connection_id, claimed_at,
          transferred_from_subject_id, transferred_at)
       VALUES ($1::uuid, $2, $3, $4, now(), $5, $6)
       ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
         claimed_by_subject_id = EXCLUDED.claimed_by_subject_id,
         connection_id = EXCLUDED.connection_id,
         claimed_at = now(),
         transferred_from_subject_id = EXCLUDED.transferred_from_subject_id,
         transferred_at = EXCLUDED.transferred_at`,
      [
        tenantId,
        conversationId,
        staffAuthUid,
        connectionId.slice(0, 220),
        tenantOwnerTakingOver && existing && existing !== staffAuthUid ? existing : null,
        tenantOwnerTakingOver && existing && existing !== staffAuthUid ? new Date() : null
      ]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function inboxTransferConversationPg(
  tenantId: string,
  actingAuthUid: string,
  isOwnerActor: boolean,
  conversationId: string,
  targetAuthUid: string,
  connectionId: string
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!isUuid(tenantId)) return { ok: false, code: 'NO_ADMIN' };
  const pool = getZapmassPool();
  if (!pool) return { ok: false, code: 'NO_ADMIN' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ claimed_by_subject_id: string }>(
      `SELECT claimed_by_subject_id FROM zapmass.inbox_assignments
       WHERE tenant_id = $1::uuid AND conversation_id = $2 FOR UPDATE`,
      [tenantId, conversationId]
    );
    const existing = cur.rows[0]?.claimed_by_subject_id?.trim() || '';
    if (!existing) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_CLAIMED' };
    }
    if (!isOwnerActor && existing !== actingAuthUid) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_YOUR_CLAIM' };
    }
    if (existing === targetAuthUid) {
      await client.query('COMMIT');
      return { ok: true };
    }
    await client.query(
      `UPDATE zapmass.inbox_assignments SET
         claimed_by_subject_id = $3,
         connection_id = $4,
         claimed_at = now(),
         transferred_from_subject_id = $5,
         transferred_at = now()
       WHERE tenant_id = $1::uuid AND conversation_id = $2`,
      [tenantId, conversationId, targetAuthUid, connectionId.slice(0, 220), actingAuthUid]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function inboxReleaseConversationPg(
  tenantId: string,
  authUid: string,
  conversationId: string,
  isOwner: boolean
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!isUuid(tenantId)) return { ok: false, code: 'NO_ADMIN' };
  const pool = getZapmassPool();
  if (!pool) return { ok: false, code: 'NO_ADMIN' };

  const cur = await pool.query<{ claimed_by_subject_id: string }>(
    `SELECT claimed_by_subject_id FROM zapmass.inbox_assignments
     WHERE tenant_id = $1::uuid AND conversation_id = $2`,
    [tenantId, conversationId]
  );
  if (cur.rowCount === 0) return { ok: true };
  const claimer = cur.rows[0]?.claimed_by_subject_id?.trim() || '';
  if (!isOwner && claimer !== authUid) {
    return { ok: false, code: 'NOT_YOUR_CLAIM' };
  }
  await pool.query(
    `DELETE FROM zapmass.inbox_assignments WHERE tenant_id = $1::uuid AND conversation_id = $2`,
    [tenantId, conversationId]
  );
  return { ok: true };
}

export async function inboxFinishConversationPg(
  tenantId: string,
  authUid: string,
  conversationId: string,
  isOwner: boolean,
  satisfaction: InboxFinishSatisfactionPg
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!isUuid(tenantId)) return { ok: false, code: 'NO_ADMIN' };
  const pool = getZapmassPool();
  if (!pool) return { ok: false, code: 'NO_ADMIN' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ claimed_by_subject_id: string }>(
      `SELECT claimed_by_subject_id FROM zapmass.inbox_assignments
       WHERE tenant_id = $1::uuid AND conversation_id = $2 FOR UPDATE`,
      [tenantId, conversationId]
    );
    const claimer = cur.rows[0]?.claimed_by_subject_id?.trim() || '';
    if (!claimer) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_CLAIMED' };
    }
    if (!isOwner && claimer !== authUid) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_YOUR_CLAIM' };
    }

    const skipped = Boolean(satisfaction.skipped);
    let rating: number | null = null;
    if (!skipped && typeof satisfaction.rating === 'number' && satisfaction.rating >= 1 && satisfaction.rating <= 5) {
      rating = satisfaction.rating;
    }
    const commentRaw = typeof satisfaction.comment === 'string' ? satisfaction.comment.trim() : '';

    if (!skipped) {
      const hasContent = rating != null || commentRaw.length > 0;
      await client.query(
        `INSERT INTO zapmass.inbox_attendance_feedback
           (tenant_id, conversation_id, actor_subject_id, assigned_to_subject_id,
            rating, comment, skipped_survey)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId,
          conversationId,
          authUid,
          claimer,
          rating,
          commentRaw.length > 0 ? commentRaw : null,
          !hasContent
        ]
      );
    }

    await client.query(
      `DELETE FROM zapmass.inbox_assignments WHERE tenant_id = $1::uuid AND conversation_id = $2`,
      [tenantId, conversationId]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function isUidMemberOfTenantPg(
  tenantUid: string,
  candidateAuthUid: string
): Promise<boolean> {
  if (candidateAuthUid === tenantUid) return true;
  if (!isUuid(tenantUid)) return false;
  const pool = getZapmassPool();
  if (!pool) return false;
  const r = await pool.query<{ id: string }>(
    `SELECT id::text FROM zapmass.workspace_members
     WHERE owner_user_id = $1::uuid AND id = $2::uuid AND revoked_at IS NULL
     LIMIT 1`,
    [tenantUid, candidateAuthUid]
  );
  return r.rowCount !== null && r.rowCount > 0;
}
