import { resolvePostgresTenantId } from './auth/firebaseUidMap.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { threadIdFromConversationId } from './chatArchiveFirestore.js';
import { usePostgresChatArchive } from './chatArchiveStore.js';
import { phoneDigitsFromConversationId } from './inboxAssignments.js';
import { findPersistedInboxConversationPg } from './repositories/inboxConversationsRepository.js';
import type { Conversation } from './types.js';
import { buildPhoneDigitLookupKeys, normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';

function conversationIdParts(conversationId: string): { connectionId: string; jid: string } {
  const id = String(conversationId || '').trim();
  const colon = id.indexOf(':');
  if (colon <= 0) return { connectionId: '', jid: '' };
  return { connectionId: id.slice(0, colon), jid: id.slice(colon + 1) };
}

function phoneKeysFromConversationId(conversationId: string): string[] {
  const { jid } = conversationIdParts(conversationId);
  const fromJid = normalizePhoneDigits((jid.split('@')[0] || jid).replace(/\D/g, '') || jid);
  const fromHelper = phoneDigitsFromConversationId(conversationId);
  const keys = new Set<string>();
  for (const d of [fromJid, fromHelper]) {
    if (!d || d.length < 8) continue;
    for (const k of buildPhoneDigitLookupKeys(d)) keys.add(k);
  }
  return Array.from(keys);
}

function phonesMatchForInbox(a: string, b: string): boolean {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const keysA = new Set(buildPhoneDigitLookupKeys(da));
  for (const k of buildPhoneDigitLookupKeys(db)) {
    if (keysA.has(k)) return true;
  }
  if (da.length >= 8 && db.length >= 8 && da.slice(-8) === db.slice(-8)) return true;
  return false;
}

async function listRamInboxConversations(): Promise<Conversation[]> {
  const out: Conversation[] = [];
  const seen = new Set<string>();
  const add = (list: Conversation[]) => {
    for (const c of list) {
      if (!c?.id || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  };
  try {
    const { getConversations } = await import('./whatsappService.js');
    add(getConversations());
  } catch {
    /* ignore */
  }
  try {
    const { getConversations } = await import('./evolutionService.js');
    add(getConversations());
  } catch {
    /* ignore */
  }
  return out;
}

function findInRamById(list: Conversation[], conversationId: string): Conversation | undefined {
  const exact = list.find((c) => c.id === conversationId);
  if (exact) return exact;

  const { connectionId, jid } = conversationIdParts(conversationId);
  if (!connectionId || !jid) return undefined;

  const jidLocal = (jid.split('@')[0] || '').toLowerCase();
  const jidSuffix = jid.includes('@') ? jid.slice(jid.indexOf('@')) : '';

  for (const c of list) {
    if (c.connectionId !== connectionId) continue;
    if (c.id === conversationId) return c;
    const cJid = c.id.includes(':') ? c.id.slice(c.id.indexOf(':') + 1) : '';
    if (cJid === jid) return c;
    const cLocal = (cJid.split('@')[0] || '').toLowerCase();
    if (jidSuffix && cJid.endsWith(jidSuffix) && phonesMatchForInbox(jidLocal, cLocal)) return c;
    if (phonesMatchForInbox(jidLocal, c.contactPhone || cLocal)) return c;
  }
  return undefined;
}

async function resolveFromArchivePg(tenantUid: string, conversationId: string): Promise<Conversation | null> {
  if (!usePostgresChatArchive() || !vpsDataEnabled()) return null;
  const pool = getZapmassPool();
  if (!pool) return null;
  const pgTenant = resolvePostgresTenantId(tenantUid);
  const phoneGuess = phoneDigitsFromConversationId(conversationId);
  const threadId = threadIdFromConversationId(
    conversationId,
    phoneGuess ? `+${phoneGuess}` : undefined
  );
  if (!threadId) return null;
  const { connectionId } = conversationIdParts(conversationId);
  try {
    const r = await pool.query<{
      thread_id: string;
      contact_name: string;
      contact_phone: string;
      last_connection_id: string;
      updated_ms: string;
      last_msg_text: string | null;
    }>(
      `SELECT t.thread_id, t.contact_name, t.contact_phone, t.last_connection_id,
              (EXTRACT(EPOCH FROM t.updated_at) * 1000)::bigint::text AS updated_ms,
              lm.text AS last_msg_text
       FROM zapmass.wa_chat_threads t
       LEFT JOIN LATERAL (
         SELECT text FROM zapmass.wa_chat_messages
         WHERE tenant_id = $1::uuid AND thread_id = t.thread_id
         ORDER BY timestamp_ms DESC
         LIMIT 1
       ) lm ON true
       WHERE t.tenant_id = $1::uuid AND t.thread_id = $2
       LIMIT 1`,
      [pgTenant, threadId]
    );
    const row = r.rows?.[0];
    if (!row) return null;
    const conn = (connectionId || row.last_connection_id || '').trim();
    if (!conn) return null;
    if (connectionId && row.last_connection_id && row.last_connection_id !== connectionId) {
      /* mesmo thread_id em outro chip: prioriza o id pedido pelo cliente */
    }
    const ts = Number(row.updated_ms) || Date.now();

    if (row.thread_id.startsWith('lid_')) {
      const cp = (row.contact_phone || '').trim();
      let remoteJid = '';
      if (cp.includes('@')) remoteJid = cp;
      else {
        const digits = cp.replace(/\D/g, '');
        if (digits.length >= 8) remoteJid = `${digits}@lid`;
      }
      if (!remoteJid) return null;
      const id = `${conn}:${remoteJid}`;
      return {
        id,
        contactName: row.contact_name || 'Contato',
        contactPhone: cp.replace(/@.+$/, '').replace(/\D/g, '') || '',
        connectionId: conn,
        connectionOwnerUid: tenantUid,
        unreadCount: 0,
        lastMessage: row.last_msg_text || '',
        lastMessageTime: ts > 0 ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
        lastMessageTimestamp: ts,
        messages: [],
        tags: ['Arquivo'],
      };
    }

    const phone = (row.contact_phone || '').replace(/\D/g, '');
    if (phone.length < 8 && !conversationId.includes('@')) return null;
    const id =
      conversationId.includes(':') && conversationId.startsWith(`${conn}:`)
        ? conversationId
        : `${conn}:${phone}@s.whatsapp.net`;
    return {
      id,
      contactName: row.contact_name || (phone ? `+${phone}` : 'Contato'),
      contactPhone: row.contact_phone || (phone ? `+${phone}` : ''),
      connectionId: conn,
      connectionOwnerUid: tenantUid,
      unreadCount: 0,
      lastMessage: row.last_msg_text || '',
      lastMessageTime: ts > 0 ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
      lastMessageTimestamp: ts,
      messages: [],
      tags: ['Arquivo'],
    };
  } catch (e) {
    console.warn('[workspaceInbox] arquivo PG:', (e as Error)?.message);
    return null;
  }
}

/**
 * Resolve conversa para rotas de inbox da equipa (claim/transfer/finish).
 * RAM (Baileys + Evolution), `wa_inbox_conversations` e arquivo Postgres — chip pode estar offline.
 */
export async function resolveWorkspaceInboxConversation(
  tenantUid: string,
  conversationId: string
): Promise<Conversation | null> {
  const id = String(conversationId || '').trim();
  if (!id) return null;

  const ram = await listRamInboxConversations();
  const fromRam = findInRamById(ram, id);
  if (fromRam) return fromRam;

  const phoneKeys = phoneKeysFromConversationId(id);
  const pgTenant = resolvePostgresTenantId(tenantUid);
  const fromPersisted = await findPersistedInboxConversationPg(pgTenant, id, phoneKeys);
  if (fromPersisted) return fromPersisted;

  const fromArchive = await resolveFromArchivePg(tenantUid, id);
  if (fromArchive) return fromArchive;

  return null;
}
