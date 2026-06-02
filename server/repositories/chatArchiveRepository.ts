import { getZapmassPool } from '../db/postgres.js';
import type { ChatMessage } from '../types.js';

const MAX_TEXT_LEN = 12000;
const MAX_MEDIA_PREVIEW = 512;
const ARCHIVE_BATCH_MESSAGES = 200;

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function sanitizeMsgDocId(id: string): string {
  let s = String(id || 'm')
    .replace(/[/#.$\[\]]/g, '_')
    .slice(0, 400);
  if (!s) s = `m_${Date.now()}`;
  return s;
}

function shrinkMessage(m: ChatMessage): {
  messageId: string;
  text: string;
  sender: string;
  status: string;
  type: string;
  timestampMs: number;
  mediaUrl: string | null;
  fromCampaign: boolean;
  campaignId: string | null;
} {
  let text = (m.text || '').slice(0, MAX_TEXT_LEN);
  let mediaUrl = m.mediaUrl;
  if (mediaUrl && mediaUrl.startsWith('data:') && mediaUrl.length > MAX_MEDIA_PREVIEW) {
    text = text || `[${String(m.type || 'media').toUpperCase()} — não arquivado em base64]`;
    mediaUrl = undefined;
  } else if (mediaUrl && mediaUrl.length > MAX_MEDIA_PREVIEW) {
    mediaUrl = mediaUrl.slice(0, MAX_MEDIA_PREVIEW);
  }
  return {
    messageId: sanitizeMsgDocId(m.id),
    text,
    sender: m.sender === 'me' ? 'me' : 'them',
    status: ['sent', 'delivered', 'read'].includes(m.status) ? m.status : 'sent',
    type: ['text', 'image', 'audio', 'sticker', 'video', 'document'].includes(m.type)
      ? m.type
      : 'text',
    timestampMs: Number(m.timestampMs) || Date.now(),
    mediaUrl: mediaUrl || null,
    fromCampaign: !!m.fromCampaign,
    campaignId: m.campaignId ? String(m.campaignId).slice(0, 128) : null
  };
}

function rowToChatMessage(messageId: string, row: {
  text: string;
  sender: string;
  status: string;
  type: string;
  timestamp_ms: string | number;
  media_url: string | null;
  from_campaign: boolean;
  campaign_id: string | null;
}): ChatMessage {
  const timestampMs = Number(row.timestamp_ms) || 0;
  const tsLabel =
    timestampMs > 0
      ? new Date(timestampMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '';
  return {
    id: messageId,
    text: row.text || '',
    timestamp: tsLabel,
    sender: (row.sender === 'me' ? 'me' : 'them') as ChatMessage['sender'],
    status: (['sent', 'delivered', 'read'].includes(row.status) ? row.status : 'sent') as ChatMessage['status'],
    type: (
      ['text', 'image', 'audio', 'sticker', 'video', 'document'].includes(row.type)
        ? row.type
        : 'text'
    ) as ChatMessage['type'],
    mediaUrl: row.media_url || undefined,
    fromCampaign: !!row.from_campaign,
    campaignId: row.campaign_id || undefined,
    timestampMs
  };
}

export async function appendChatArchiveMessagesPg(
  tenantId: string,
  threadId: string,
  meta: { contactName: string; contactPhone: string; connectionId: string },
  messages: ChatMessage[]
): Promise<void> {
  if (!isUuid(tenantId) || !threadId || messages.length === 0) return;
  const pool = getZapmassPool();
  if (!pool) return;

  for (let i = 0; i < messages.length; i += ARCHIVE_BATCH_MESSAGES) {
    const chunk = messages.slice(i, i + ARCHIVE_BATCH_MESSAGES);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO zapmass.wa_chat_threads
           (tenant_id, thread_id, contact_name, contact_phone, last_connection_id, updated_at, schema_version)
         VALUES ($1::uuid, $2, $3, $4, $5, now(), 1)
         ON CONFLICT (tenant_id, thread_id) DO UPDATE SET
           contact_name = EXCLUDED.contact_name,
           contact_phone = EXCLUDED.contact_phone,
           last_connection_id = EXCLUDED.last_connection_id,
           updated_at = now()`,
        [
          tenantId,
          threadId,
          meta.contactName.slice(0, 500),
          meta.contactPhone.slice(0, 40),
          meta.connectionId.slice(0, 220)
        ]
      );
      for (const m of chunk) {
        const s = shrinkMessage(m);
        await client.query(
          `INSERT INTO zapmass.wa_chat_messages
             (tenant_id, thread_id, message_id, text, sender, status, type, timestamp_ms,
              media_url, from_campaign, campaign_id, archived_at)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
           ON CONFLICT (tenant_id, thread_id, message_id) DO UPDATE SET
             text = EXCLUDED.text,
             sender = EXCLUDED.sender,
             status = EXCLUDED.status,
             type = EXCLUDED.type,
             timestamp_ms = EXCLUDED.timestamp_ms,
             media_url = EXCLUDED.media_url,
             from_campaign = EXCLUDED.from_campaign,
             campaign_id = EXCLUDED.campaign_id,
             archived_at = now()`,
          [
            tenantId,
            threadId,
            s.messageId,
            s.text,
            s.sender,
            s.status,
            s.type,
            s.timestampMs,
            s.mediaUrl,
            s.fromCampaign,
            s.campaignId
          ]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.warn('[ChatArchive/PG] batch falhou:', (e as Error)?.message || e);
    } finally {
      client.release();
    }
  }
}

type MessageRow = {
  message_id: string;
  text: string;
  sender: string;
  status: string;
  type: string;
  timestamp_ms: string;
  media_url: string | null;
  from_campaign: boolean;
  campaign_id: string | null;
};

export async function loadChatArchiveMessagesPg(
  tenantId: string,
  threadId: string,
  limit: number = 500
): Promise<ChatMessage[]> {
  if (!isUuid(tenantId) || !threadId) return [];
  const pool = getZapmassPool();
  if (!pool) return [];
  const cap = Math.max(1, Math.min(limit, 2000));
  try {
    const r = await pool.query<MessageRow>(
      `SELECT message_id, text, sender, status, type, timestamp_ms::text, media_url,
              from_campaign, campaign_id
       FROM zapmass.wa_chat_messages
       WHERE tenant_id = $1::uuid AND thread_id = $2
       ORDER BY timestamp_ms DESC
       LIMIT $3`,
      [tenantId, threadId, cap]
    );
    const out = r.rows.map((row) => rowToChatMessage(row.message_id, row));
    out.reverse();
    return out;
  } catch (e) {
    console.warn('[ChatArchive/PG] load falhou:', (e as Error)?.message || e);
    return [];
  }
}
