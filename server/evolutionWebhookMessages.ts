import type { EvolutionChatStore } from './evolutionChat.js';

export type EvolutionWebhookMessage = {
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
    remoteJidAlt?: string;
    senderPn?: string;
    participant?: string;
  };
  message?: Record<string, unknown>;
  messageContent?: Record<string, unknown>;
  pushName?: string;
  messageTimestamp?: number;
};

/** Evolution v2 entrega MESSAGES_UPSERT em formatos diferentes — normaliza como o chatStore. */
export function normalizeEvolutionWebhookMessages(data: unknown): EvolutionWebhookMessage[] {
  if (Array.isArray(data)) return data as EvolutionWebhookMessage[];
  if (!data || typeof data !== 'object') return [];
  const row = data as Record<string, unknown>;
  if (Array.isArray(row.messages)) return row.messages as EvolutionWebhookMessage[];
  if (row.key) return [row as EvolutionWebhookMessage];
  return [];
}

function unwrapEvolutionMessagePayload(message: Record<string, unknown>): Record<string, unknown> {
  let m = message;
  for (let depth = 0; depth < 5; depth++) {
    const inner =
      (m.ephemeralMessage as { message?: Record<string, unknown> } | undefined)?.message ||
      (m.viewOnceMessage as { message?: Record<string, unknown> } | undefined)?.message ||
      (m.documentWithCaptionMessage as { message?: Record<string, unknown> } | undefined)?.message;
    if (!inner || inner === m) break;
    m = inner;
  }
  return m;
}

/** Extrai texto (ou sinal de resposta não-texto) de payloads Evolution/Baileys. */
export function extractEvolutionMessageBody(message: Record<string, unknown> | undefined): {
  bodyText: string;
  nonTextReply: boolean;
} {
  if (!message) return { bodyText: '', nonTextReply: false };
  const msg = unwrapEvolutionMessagePayload(message);

  const btn = msg.buttonsResponseMessage as { selectedDisplayText?: string; selectedButtonId?: string } | undefined;
  if (btn?.selectedDisplayText || btn?.selectedButtonId) {
    return { bodyText: String(btn.selectedDisplayText || btn.selectedButtonId || '').trim(), nonTextReply: false };
  }

  const list = msg.listResponseMessage as
    | { title?: string; singleSelectReply?: { selectedRowId?: string; selectedRowTitle?: string } }
    | undefined;
  if (list?.title || list?.singleSelectReply?.selectedRowTitle || list?.singleSelectReply?.selectedRowId) {
    const t =
      list.singleSelectReply?.selectedRowTitle ||
      list.title ||
      list.singleSelectReply?.selectedRowId ||
      '';
    return { bodyText: String(t).trim(), nonTextReply: false };
  }

  const tpl = msg.templateButtonReplyMessage as { selectedDisplayText?: string; selectedId?: string } | undefined;
  if (tpl?.selectedDisplayText || tpl?.selectedId) {
    return { bodyText: String(tpl.selectedDisplayText || tpl.selectedId || '').trim(), nonTextReply: false };
  }

  const typed = msg as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string };
    audioMessage?: unknown;
    stickerMessage?: unknown;
    reactionMessage?: unknown;
  };

  const text =
    typed.conversation ||
    typed.extendedTextMessage?.text ||
    typed.imageMessage?.caption ||
    typed.videoMessage?.caption ||
    typed.documentMessage?.caption ||
    '';

  const bodyTrim = String(text || '').trim();
  if (bodyTrim.length > 0) return { bodyText: bodyTrim, nonTextReply: false };

  const hasMedia = Boolean(
    typed.imageMessage ||
      typed.videoMessage ||
      typed.documentMessage ||
      typed.audioMessage ||
      typed.stickerMessage ||
      typed.reactionMessage
  );
  return { bodyText: '', nonTextReply: hasMedia };
}

function digitsFromJidLike(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s || s.endsWith('@lid')) return '';
  const base = s.includes('@') ? s.split('@')[0] : s;
  return base.replace(/\D/g, '');
}

/** Resolve telefone do remetente — prioriza remoteJidAlt/senderPn (Evolution v2 + LID). */
export function resolvePhoneDigitsFromEvolutionMessage(
  msg: EvolutionWebhookMessage,
  chatStore?: Pick<EvolutionChatStore, 'getConversations'> | null,
  connectionId?: string
): string {
  const key = msg.key || {};
  const candidates = [key.remoteJidAlt, key.senderPn, key.participant, key.remoteJid];
  for (const c of candidates) {
    const d = digitsFromJidLike(c);
    if (d.length >= 8) return d;
  }

  const remoteJid = String(key.remoteJid || '');
  if (chatStore && connectionId && remoteJid) {
    const convId = `${connectionId}:${remoteJid}`;
    const conv = chatStore.getConversations().find((c) => c.id === convId);
    if (conv?.contactPhone) {
      const fromContact = conv.contactPhone.replace(/\D/g, '');
      if (fromContact.length >= 8) return fromContact;
    }
  }

  return digitsFromJidLike(key.remoteJid);
}

export function buildEvolutionIncomingConvId(connectionId: string, remoteJid: string, phoneDigits: string): string {
  const jid = String(remoteJid || '').trim();
  if (jid.includes('@')) return `${connectionId}:${jid}`;
  if (phoneDigits.length >= 8) return `${connectionId}:${phoneDigits}`;
  return `${connectionId}:${jid || phoneDigits}`;
}
