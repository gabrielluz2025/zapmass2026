/**
 * Persiste a lista de conversas (inbox) no PostgreSQL.
 * Garante que conversas sobrevivam a restarts do servidor,
 * independentemente do conversations_cache.json local.
 */
import { getZapmassPool } from '../db/postgres.js';
import type { Conversation } from '../types.js';

function tagsToArray(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t) => typeof t === 'string' && t.length > 0);
}

/**
 * Upsert em lote de conversas para um tenant.
 * Chamado em debounce a cada mudança na inbox.
 */
export async function persistInboxConversationsBatch(
  tenantId: string,
  conversations: Conversation[]
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool || !tenantId || conversations.length === 0) return;
  try {
    const client = await pool.connect();
    try {
      // Batch de 100 em cada transação
      const BATCH = 100;
      for (let i = 0; i < conversations.length; i += BATCH) {
        const slice = conversations.slice(i, i + BATCH);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let p = 1;
        for (const c of slice) {
          placeholders.push(
            `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, false, now())`
          );
          values.push(
            tenantId,
            String(c.id || ''),
            String(c.connectionId || ''),
            String(c.contactName || '').slice(0, 500),
            String(c.contactPhone || '').slice(0, 60),
            String(c.lastMessage || '').slice(0, 1000),
            Number(c.lastMessageTimestamp) || 0,
            Number(c.unreadCount) || 0,
            tagsToArray(c.tags),
            (c.profilePicUrl || null) as string | null
          );
        }
        await client.query(
          `INSERT INTO zapmass.wa_inbox_conversations
             (tenant_id, conversation_id, connection_id, contact_name, contact_phone,
              last_message, last_msg_ts, unread_count, tags, profile_pic_url, deleted, updated_at)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
             connection_id   = EXCLUDED.connection_id,
             contact_name    = EXCLUDED.contact_name,
             contact_phone   = EXCLUDED.contact_phone,
             last_message    = EXCLUDED.last_message,
             last_msg_ts     = EXCLUDED.last_msg_ts,
             unread_count    = EXCLUDED.unread_count,
             tags            = EXCLUDED.tags,
             profile_pic_url = COALESCE(EXCLUDED.profile_pic_url, zapmass.wa_inbox_conversations.profile_pic_url),
             deleted         = false,
             updated_at      = now()`,
          values
        );
      }
    } finally {
      client.release();
    }
  } catch (e) {
    // Não bloqueia o servidor — apenas loga
    console.warn('[InboxPersist] Falha ao persistir conversas no PG:', (e as Error)?.message);
  }
}

/**
 * Marca conversas como deletadas no PG (soft delete).
 * Sincroniza com a deleção manual do usuário.
 */
export async function markInboxConversationsDeleted(
  tenantId: string,
  conversationIds: string[]
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool || !tenantId || conversationIds.length === 0) return;
  try {
    await pool.query(
      `UPDATE zapmass.wa_inbox_conversations
       SET deleted = true, updated_at = now()
       WHERE tenant_id = $1 AND conversation_id = ANY($2::text[])`,
      [tenantId, conversationIds]
    );
  } catch (e) {
    console.warn('[InboxPersist] Falha ao marcar conversas como deletadas:', (e as Error)?.message);
  }
}

/**
 * Carrega conversas persistidas para um tenant.
 * Usado no boot para restaurar a inbox sem precisar sincronizar do Evolution.
 */
export async function loadPersistedInboxConversations(
  tenantId: string,
  limit = 2000
): Promise<Array<{ conversationId: string; connectionId: string; contactName: string; contactPhone: string; lastMessage: string; lastMsgTs: number; unreadCount: number; tags: string[]; profilePicUrl: string | null }>> {
  const pool = getZapmassPool();
  if (!pool || !tenantId) return [];
  try {
    const r = await pool.query(
      `SELECT conversation_id, connection_id, contact_name, contact_phone,
              last_message, last_msg_ts, unread_count, tags, profile_pic_url
       FROM zapmass.wa_inbox_conversations
       WHERE tenant_id = $1 AND deleted = false
       ORDER BY last_msg_ts DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return (r.rows || []).map((row) => ({
      conversationId: String(row.conversation_id),
      connectionId: String(row.connection_id),
      contactName: String(row.contact_name),
      contactPhone: String(row.contact_phone),
      lastMessage: String(row.last_message),
      lastMsgTs: Number(row.last_msg_ts) || 0,
      unreadCount: Number(row.unread_count) || 0,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      profilePicUrl: row.profile_pic_url ? String(row.profile_pic_url) : null,
    }));
  } catch (e) {
    console.warn('[InboxPersist] Falha ao carregar conversas do PG:', (e as Error)?.message);
    return [];
  }
}
