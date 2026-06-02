import { createHash } from 'node:crypto';
import { FieldValue, getFirestore, type DocumentData } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import type { ChatMessage } from './types.js';

const MAX_TEXT_LEN = 12000;
const MAX_MEDIA_PREVIEW = 512;
/** Máximo de escritas por batch (Firestore: 500; margem para set do thread). */
const ARCHIVE_BATCH_MESSAGES = 200;

/** 1 (default quando Admin existe): grava/le arquivamento. 0 desliga totalmente. */
export const isWaChatArchiveEnabled = (): boolean => {
  const raw = String(process.env.WA_CHAT_ARCHIVE ?? '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
};

/** ID estável por contacto/grupo dentro do tenant (independente de connectionId / JID LID vs c.us). */
export function threadIdFromConversationId(conversationId: string, contactPhone?: string): string | null {
  const colon = conversationId.indexOf(':');
  const jid = colon >= 0 ? conversationId.slice(colon + 1) : '';
  if (!jid) return null;
  if (jid.includes('@g.us')) {
    const h = createHash('sha256').update(jid).digest('hex');
    return `grp_${h}`;
  }
  const fromPhone = (contactPhone || '').replace(/\D/g, '');
  if (fromPhone.length >= 10 && fromPhone.length <= 15) return `p_${fromPhone}`;
  const digits = jid.split('@')[0]?.replace(/\D/g, '') || '';
  if (digits.length >= 10 && digits.length <= 15) return `p_${digits}`;
  return null;
}

function sanitizeMsgDocId(id: string): string {
  let s = String(id || 'm')
    .replace(/[/#.$\[\]]/g, '_')
    .slice(0, 400);
  if (!s) s = `m_${Date.now()}`;
  return s;
}

function shrinkForArchive(m: ChatMessage): Record<string, unknown> {
  let text = (m.text || '').slice(0, MAX_TEXT_LEN);
  let mediaUrl = m.mediaUrl;
  if (mediaUrl && mediaUrl.startsWith('data:') && mediaUrl.length > MAX_MEDIA_PREVIEW) {
    text = text || `[${String(m.type || 'media').toUpperCase()} — não arquivado em base64]`;
    mediaUrl = undefined;
  } else if (mediaUrl && mediaUrl.length > MAX_MEDIA_PREVIEW) {
    mediaUrl = mediaUrl.slice(0, MAX_MEDIA_PREVIEW);
  }
  return {
    text,
    sender: m.sender,
    status: m.status,
    type: m.type,
    timestampMs: Number(m.timestampMs) || Date.now(),
    mediaUrl: mediaUrl || null,
    fromCampaign: !!m.fromCampaign,
    campaignId: m.campaignId ? String(m.campaignId).slice(0, 128) : null,
    archivedAt: FieldValue.serverTimestamp()
  };
}

function docToChatMessage(id: string, d: DocumentData): ChatMessage {
  const timestampMs = Number(d.timestampMs) || 0;
  const tsLabel =
    timestampMs > 0
      ? new Date(timestampMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '';
  return {
    id,
    text: typeof d.text === 'string' ? d.text : '',
    timestamp: tsLabel,
    sender: (d.sender === 'me' || d.sender === 'them' ? d.sender : 'them') as ChatMessage['sender'],
    status: (['sent', 'delivered', 'read'].includes(d.status) ? d.status : 'sent') as ChatMessage['status'],
    type: (
      ['text', 'image', 'audio', 'sticker', 'video', 'document'].includes(d.type)
        ? d.type
        : 'text'
    ) as ChatMessage['type'],
    mediaUrl: typeof d.mediaUrl === 'string' ? d.mediaUrl : undefined,
    fromCampaign: !!d.fromCampaign,
    campaignId: typeof d.campaignId === 'string' ? d.campaignId : undefined,
    timestampMs
  };
}

/**
 * Anexa mensagens novas à thread `users/{ownerUid}/waChatThreads/{threadId}/messages/*`.
 */
export async function appendChatArchiveMessagesFirestore(
  ownerUid: string,
  threadId: string,
  meta: { contactName: string; contactPhone: string; connectionId: string },
  messages: ChatMessage[]
): Promise<void> {
  if (!isWaChatArchiveEnabled() || !ownerUid || !threadId || messages.length === 0) return;
  const admin = getFirebaseAdmin();
  if (!admin) return;

  const db = getFirestore(admin);
  const threadRef = db.collection('users').doc(ownerUid).collection('waChatThreads').doc(threadId);

  for (let i = 0; i < messages.length; i += ARCHIVE_BATCH_MESSAGES) {
    const chunk = messages.slice(i, i + ARCHIVE_BATCH_MESSAGES);
    const batch = db.batch();
    batch.set(
      threadRef,
      {
        contactName: meta.contactName.slice(0, 500),
        contactPhone: meta.contactPhone.slice(0, 40),
        lastConnectionId: meta.connectionId.slice(0, 220),
        updatedAt: FieldValue.serverTimestamp(),
        schemaVersion: 1
      },
      { merge: true }
    );
    for (const m of chunk) {
      const ref = threadRef.collection('messages').doc(sanitizeMsgDocId(m.id));
      batch.set(ref, shrinkForArchive(m), { merge: true });
    }
    await batch.commit().catch((e: Error) => {
      console.warn('[ChatArchive] batch falhou:', e.message);
    });
  }
}

/**
 * Carrega até `limit` mensagens mais recentes do arquivo (cronológicas).
 */
export async function loadChatArchiveMessagesFirestore(
  ownerUid: string,
  threadId: string,
  limit: number = 500
): Promise<ChatMessage[]> {
  if (!isWaChatArchiveEnabled() || !ownerUid || !threadId) return [];
  const admin = getFirebaseAdmin();
  if (!admin) return [];
  const cap = Math.max(1, Math.min(limit, 2000));
  const db = getFirestore(admin);
  const snap = await db
    .collection('users')
    .doc(ownerUid)
    .collection('waChatThreads')
    .doc(threadId)
    .collection('messages')
    .orderBy('timestampMs', 'desc')
    .limit(cap)
    .get()
    .catch((e: Error) => {
      console.warn('[ChatArchive] load falhou:', e.message);
      return null;
    });
  if (!snap) return [];
  const out: ChatMessage[] = [];
  snap.forEach((doc) => {
    out.push(docToChatMessage(doc.id, doc.data()));
  });
  out.reverse();
  return out;
}
