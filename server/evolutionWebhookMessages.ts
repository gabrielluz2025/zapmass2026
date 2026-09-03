import type { EvolutionChatStore } from './evolutionChat.js';

export type EvolutionChatMessageType = 'text' | 'image' | 'audio' | 'sticker' | 'video' | 'document';

export type ParsedEvolutionChatContent = {
  type: EvolutionChatMessageType;
  text: string;
  mediaUrl?: string;
};

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
  for (let depth = 0; depth < 6; depth++) {
    const inner =
      (m.ephemeralMessage as { message?: Record<string, unknown> } | undefined)?.message ||
      (m.viewOnceMessage as { message?: Record<string, unknown> } | undefined)?.message ||
      (m.viewOnceMessageV2 as { message?: Record<string, unknown> } | undefined)?.message ||
      (m.documentWithCaptionMessage as { message?: Record<string, unknown> } | undefined)?.message ||
      (m.associatedChildMessage as { message?: Record<string, unknown> } | undefined)?.message;
    if (!inner || inner === m) break;
    m = inner;
  }
  return m;
}

const MEDIA_PART_KEYS = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'pttMessage',
  'documentMessage',
  'stickerMessage',
] as const;

const SPECIAL_MESSAGE_LABELS: Record<string, string> = {
  stickerMessage: '🎭 Figurinha',
  imageMessage: '📷 Imagem',
  videoMessage: '🎥 Vídeo',
  audioMessage: '🎵 Áudio',
  pttMessage: '🎙️ Áudio',
  documentMessage: '📎 Documento',
  interactiveMessage: '🎁 Mensagem interativa',
  buttonsMessage: '🔘 Mensagem com botões',
  listMessage: '📋 Lista de opções',
  templateMessage: '📨 Template',
  contactMessage: '👤 Contato',
  locationMessage: '📍 Localização',
  liveLocationMessage: '📍 Localização ao vivo',
  reactionMessage: '💬 Reação',
  productMessage: '🛍️ Produto',
  orderMessage: '🧾 Pedido',
  pollCreationMessage: '📊 Enquete',
  pollUpdateMessage: '📊 Voto na enquete',
  eventMessage: '📅 Evento',
  requestPaymentMessage: '💳 Solicitação de pagamento',
  sendPaymentMessage: '💳 Pagamento',
  highlyStructuredMessage: '🎁 Cartão / presente',
  encReactionMessage: '💬 Reação',
};

function parseButtonParamsJson(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function summarizeInteractiveMessage(msg: Record<string, unknown>): string {
  const im = msg.interactiveMessage as Record<string, unknown> | undefined;
  if (!im) return '';
  const parts: string[] = [];
  const header = im.header as { title?: string; text?: string } | undefined;
  const body = im.body as { text?: string } | undefined;
  const footer = im.footer as { text?: string } | undefined;
  if (header?.title) parts.push(String(header.title));
  if (header?.text) parts.push(String(header.text));
  if (body?.text) parts.push(String(body.text));
  if (footer?.text) parts.push(String(footer.text));

  const native = im.nativeFlowMessage as
    | { buttons?: Array<{ name?: string; buttonParamsJson?: string }>; messageParamsJson?: string }
    | undefined;
  const buttonLabels: string[] = [];
  for (const btn of native?.buttons || []) {
    const params = parseButtonParamsJson(btn?.buttonParamsJson);
    const label =
      String(params.display_text || params.title || params.text || params.name || btn?.name || '').trim();
    if (label) buttonLabels.push(label);
  }
  if (buttonLabels.length) parts.push(`Opções: ${buttonLabels.join(' · ')}`);

  const params = parseButtonParamsJson(native?.messageParamsJson);
  const catalog = String(params.title || params.display_text || '').trim();
  if (catalog) parts.push(catalog);

  return parts.join('\n').trim();
}

function summarizeButtonsMessage(msg: Record<string, unknown>): string {
  const bm = msg.buttonsMessage as
    | {
        contentText?: string;
        text?: string;
        footerText?: string;
        headerText?: string;
        buttons?: Array<{ buttonText?: { displayText?: string }; name?: string }>;
      }
    | undefined;
  if (!bm) return '';
  const parts = [bm.headerText, bm.contentText || bm.text, bm.footerText].filter(Boolean).map(String);
  const labels = (bm.buttons || [])
    .map((b) => String(b.buttonText?.displayText || b.name || '').trim())
    .filter(Boolean);
  if (labels.length) parts.push(`Botões: ${labels.join(' · ')}`);
  return parts.join('\n').trim();
}

function summarizeListMessage(msg: Record<string, unknown>): string {
  const lm = msg.listMessage as
    | {
        title?: string;
        description?: string;
        buttonText?: string;
        footerText?: string;
        sections?: Array<{ title?: string; rows?: Array<{ title?: string; description?: string }> }>;
      }
    | undefined;
  if (!lm) return '';
  const parts = [lm.title, lm.description, lm.footerText].filter(Boolean).map(String);
  if (lm.buttonText) parts.push(`Menu: ${lm.buttonText}`);
  const rows = (lm.sections || [])
    .flatMap((s) => s.rows || [])
    .map((r) => String(r.title || r.description || '').trim())
    .filter(Boolean)
    .slice(0, 6);
  if (rows.length) parts.push(`Itens: ${rows.join(' · ')}`);
  return parts.join('\n').trim();
}

function summarizeContactMessage(msg: Record<string, unknown>): string {
  const cm = msg.contactMessage as { displayName?: string; vcard?: string } | undefined;
  if (!cm) return '';
  const name = String(cm.displayName || '').trim();
  if (name) return `👤 Contato: ${name}`;
  return '👤 Contato compartilhado';
}

function summarizeLocationMessage(msg: Record<string, unknown>): string {
  const loc = (msg.locationMessage || msg.liveLocationMessage) as
    | { name?: string; address?: string; degreesLatitude?: number; degreesLongitude?: number }
    | undefined;
  if (!loc) return '';
  const place = String(loc.name || loc.address || 'Localização').trim();
  const lat = loc.degreesLatitude;
  const lng = loc.degreesLongitude;
  if (typeof lat === 'number' && typeof lng === 'number') {
    return `📍 ${place} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  }
  return `📍 ${place}`;
}

function summarizeReactionMessage(msg: Record<string, unknown>): string {
  const reaction = msg.reactionMessage as { text?: string } | undefined;
  const emoji = String(reaction?.text || '❤️').trim() || '❤️';
  return `Reação ${emoji}`;
}

function inferEvolutionMessageType(message: Record<string, unknown>): EvolutionChatMessageType {
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage || message.pttMessage) return 'audio';
  if (message.stickerMessage) return 'sticker';
  if (message.documentMessage) return 'document';
  return 'text';
}

function extractEvolutionMediaUrl(message: Record<string, unknown>): string | undefined {
  for (const key of MEDIA_PART_KEYS) {
    const part = message[key] as { url?: string; directPath?: string } | undefined;
    if (part?.url && String(part.url).startsWith('http')) return String(part.url);
  }
  return undefined;
}

function fallbackLabelForMessage(message: Record<string, unknown>): string {
  for (const [key, label] of Object.entries(SPECIAL_MESSAGE_LABELS)) {
    if (message[key]) return label;
  }
  const unknownKey = Object.keys(message).find((k) => k.endsWith('Message') && k !== 'messageContextInfo');
  if (unknownKey) {
    const human = unknownKey.replace(/Message$/, '').replace(/([A-Z])/g, ' $1').trim();
    return `💬 ${human.charAt(0).toUpperCase()}${human.slice(1)}`;
  }
  return '💬 Mensagem';
}

function describeEvolutionMessageText(message: Record<string, unknown>, type: EvolutionChatMessageType): string {
  const { bodyText } = extractEvolutionMessageBody(message);
  if (bodyText) return bodyText;

  const structured =
    summarizeInteractiveMessage(message) ||
    summarizeButtonsMessage(message) ||
    summarizeListMessage(message) ||
    summarizeContactMessage(message) ||
    summarizeLocationMessage(message) ||
    (message.reactionMessage ? summarizeReactionMessage(message) : '');

  if (structured) return structured;

  const doc = message.documentMessage as { fileName?: string; caption?: string } | undefined;
  if (doc?.fileName) return doc.caption || doc.fileName;

  if (type !== 'text') {
    for (const key of MEDIA_PART_KEYS) {
      if (message[key] && SPECIAL_MESSAGE_LABELS[key]) return SPECIAL_MESSAGE_LABELS[key];
    }
  }

  return fallbackLabelForMessage(message);
}

/** Normaliza payload Evolution/Baileys para exibição no chat (texto + tipo + mídia). */
export function parseEvolutionChatContent(
  message: Record<string, unknown> | undefined,
  opts?: { includeMediaUrl?: boolean }
): ParsedEvolutionChatContent {
  if (!message || typeof message !== 'object') {
    return { type: 'text', text: '💬 Mensagem' };
  }
  const unwrapped = unwrapEvolutionMessagePayload(message);
  const type = inferEvolutionMessageType(unwrapped);
  const text = describeEvolutionMessageText(unwrapped, type);
  const mediaUrl = opts?.includeMediaUrl ? extractEvolutionMediaUrl(unwrapped) : undefined;
  return { type, text, ...(mediaUrl ? { mediaUrl } : {}) };
}

/** Payload mínimo waE2E.Message para download de mídia (Evolution Go). */
export function pickWaMediaMessageForDownload(
  message: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const unwrapped = unwrapEvolutionMessagePayload(message);
  const out: Record<string, unknown> = {};
  for (const key of MEDIA_PART_KEYS) {
    if (unwrapped[key]) out[key] = unwrapped[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Exportado para loadMessageMedia e testes. */
export { unwrapEvolutionMessagePayload, extractEvolutionMediaUrl };

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
  const digits = base.replace(/\D/g, '');
  if (digits.length >= 14) return '';
  if (digits.length < 10 || digits.length > 13) return '';
  return digits;
}

/** Resolve telefone do remetente — prioriza remoteJidAlt/senderPn (Evolution v2 + LID). */
export function resolvePhoneDigitsFromEvolutionMessage(
  msg: EvolutionWebhookMessage,
  chatStore?: Pick<EvolutionChatStore, 'getConversations'> | null,
  connectionId?: string
): string {
  const key = msg.key || {};
  // 1) Campos explícitos com número (Evolution Go senderPn, Evolution v2 remoteJidAlt, participante)
  const candidates = [key.remoteJidAlt, key.senderPn, key.participant, key.remoteJid];
  for (const c of candidates) {
    const d = digitsFromJidLike(c);
    if (d.length >= 8) return d;
  }

  const remoteJid = String(key.remoteJid || '');
  if (chatStore && connectionId && remoteJid) {
    const convs = chatStore.getConversations();

    // 2) Busca exata por convId (caminho normal)
    const convId = `${connectionId}:${remoteJid}`;
    const conv = convs.find((c) => c.id === convId);
    if (conv?.contactPhone) {
      const fromContact = conv.contactPhone.replace(/\D/g, '');
      if (fromContact.length >= 8) return fromContact;
    }

    // 3) LID fallback: busca por waJidAlt (conversa gravada como @s.whatsapp.net mas com @lid alternativo)
    if (remoteJid.endsWith('@lid')) {
      const byAlt = convs.find(
        (c) => c.connectionId === connectionId && c.waJidAlt === remoteJid
      );
      if (byAlt?.contactPhone) {
        const fromAlt = byAlt.contactPhone.replace(/\D/g, '');
        if (fromAlt.length >= 8) return fromAlt;
      }
      // 4) LID fallback: busca por id que já começa com connectionId e termina em @lid
      //    (conversa cujo contactPhone pode já ter sido resolvido via backfill)
      const byLidId = convs.find(
        (c) => c.id === convId && c.contactPhone
      );
      if (byLidId?.contactPhone) {
        const fromLid = byLidId.contactPhone.replace(/\D/g, '');
        if (fromLid.length >= 8) return fromLid;
      }
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
