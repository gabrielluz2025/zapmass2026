import type { AxiosInstance } from 'axios';
import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import {
  buildOutboundPhoneVariants,
  normalizeOutboundNumber,
  parseWhatsAppNumberCheckRows,
  pickWhatsAppCheckResult,
} from './evolutionOutboundPhone.js';
import {
  hasResolvablePhone,
  isLidJid,
  LID_SEND_BLOCKED_MSG,
  mergeLidPeerFields,
  normalizeOutboundDigits,
  pickSendableWaJidAlt,
  plausiblePhoneDigits
} from './evolutionLidResolve.js';
import { evolutionNetworkUserMessage, isTransientEvolutionNetworkError } from './evolutionAxiosRetry.js';

const GO_INVALID_UUID_RE = /invalid UUID/i;

export const EVOLUTION_GO_INVALID_UUID_HINT =
  'O Evolution não reconheceu o identificador deste canal. Atualize a página; se o chip estiver Online, o disparo continua valendo.';

export function humanizeEvolutionEngineError(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return t;
  if (GO_INVALID_UUID_RE.test(t) || t === 'missing-go-uuid') return EVOLUTION_GO_INVALID_UUID_HINT;
  if (/URL is required/i.test(t)) {
    return 'Evolution Go não recebeu o arquivo (imagem/vídeo). Salve a campanha com o anexo e dispare de novo.';
  }
  if (/Mídia sem URL ou base64|Sem mídia/i.test(t)) {
    return 'Anexo não chegou ao WhatsApp — regrave a imagem na campanha e tente outra vez.';
  }
  if (/file too large|payload too large|entity too large|413/i.test(t)) {
    return 'Arquivo grande demais para o WhatsApp. Comprima a imagem ou vídeo e salve a campanha de novo.';
  }
  if (/unsupported mime|invalid mime|mimetype/i.test(t)) {
    return 'Formato de arquivo não aceito. Use JPG/PNG para imagem ou MP4 para vídeo.';
  }
  return t;
}

function formatPhoneForError(raw: string): string {
  const key = normPhoneKey(raw) || raw.replace(/\D/g, '');
  if (!key) return raw;
  if (key.length >= 12 && key.startsWith('55')) {
    const local = key.slice(2);
    if (local.length === 11) {
      return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    }
    if (local.length === 10) {
      return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
    }
  }
  return key.startsWith('55') ? `+${key}` : key;
}

export { normalizeOutboundDigits, plausiblePhoneDigits };

type EvolutionSendTextResponse = {
  key?: { id?: string; _serialized?: string };
  message?: string;
  messageId?: string;
  id?: string;
  status?: string;
  error?: string;
};

export function isRetryableExistsFalseError(message: string): boolean {
  return /não encontrado no WhatsApp|exists:\s*false|HTTP 400|status code 400|recusou o envio \(400\)/i.test(
    message
  );
}

/** Envia texto via Evolution API (v1 + v2) com validação da resposta. */
export async function postEvolutionSendText(
  api: AxiosInstance,
  instanceName: string,
  number: string,
  text: string
): Promise<{ messageId?: string; isPending?: boolean }> {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Mensagem vazia.');
  if (!number) throw new Error('Número inválido para envio.');

  let response: { data?: EvolutionSendTextResponse };
  try {
    response = await api.post(`/message/sendText/${instanceName}`, {
      number,
      options: { delay: 1200, presence: 'composing' },
      textMessage: { text: trimmed },
      // Campos legados v1 — mantidos para compatibilidade retroativa
      text: trimmed,
      delay: 1200,
    });
  } catch (err) {
    throw new Error(formatEvolutionHttpError(err, number));
  }

  const responseData = response.data;
  const messageId =
    responseData?.key?.id ||
    responseData?.key?._serialized ||
    responseData?.messageId ||
    responseData?.id;

  if (
    responseData?.key ||
    responseData?.message === 'Message Sent' ||
    responseData?.messageId ||
    responseData?.id
  ) {
    return { messageId: messageId ? String(messageId) : undefined };
  }

  const statusOk =
    typeof responseData?.status === 'string' &&
    ['PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED', 'sent', 'delivered'].includes(
      responseData.status
    );
  if (statusOk) return { isPending: responseData.status === 'PENDING' };

  const isExplicitError =
    responseData?.error ||
    (typeof responseData?.message === 'string' &&
      /error|failed|invalid|unauthorized/i.test(responseData.message));
  if (isExplicitError) {
    throw new Error(String(responseData?.error || responseData?.message || 'Evolution recusou o envio.'));
  }

  if (responseData && typeof responseData === 'object') {
    return {};
  }

  throw new Error('Evolution retornou resposta sem confirmação de envio.');
}

type EvolutionSendMediaResponse = {
  key?: { id?: string; _serialized?: string };
  message?: string;
  messageId?: string;
  id?: string;
  status?: string;
  error?: string;
  success?: boolean;
};

/** Interpreta 2xx do sendMedia (Evolution v2 ou resposta já normalizada do Go). */
export function parseEvolutionSendMediaAcceptance(
  responseData: EvolutionSendMediaResponse | null | undefined
): { ok: true; messageId?: string } | { ok: false; errorDetail: string } {
  if (!responseData || typeof responseData !== 'object') {
    return { ok: false, errorDetail: 'Evolution retornou resposta sem confirmação de mídia' };
  }

  const messageId =
    responseData.key?.id ||
    responseData.key?._serialized ||
    responseData.messageId ||
    responseData.id;

  if (responseData.key) {
    const isGoQueued = messageId === 'go-queued';
    return {
      ok: true,
      messageId: messageId && !isGoQueued ? String(messageId) : undefined,
    };
  }

  if (responseData.message === 'Message Sent' || responseData.messageId || responseData.id) {
    return { ok: true, messageId: messageId ? String(messageId) : undefined };
  }

  const statusStr = String(responseData.status || '').toUpperCase();
  const statusOk = ['PENDING', 'QUEUED', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED', 'SENT', 'DELIVERED'].includes(
    statusStr
  );
  if (statusOk || responseData.success === true) {
    return { ok: true, messageId: messageId ? String(messageId) : undefined };
  }

  const isExplicitError =
    responseData.success === false ||
    responseData.error ||
    (typeof responseData.message === 'string' && /error|failed|invalid|unauthorized|required/i.test(responseData.message));
  if (isExplicitError) {
    const raw = String(responseData.error || responseData.message || 'Evolution recusou o envio de mídia.');
    return { ok: false, errorDetail: humanizeEvolutionEngineError(raw) };
  }

  if (Object.keys(responseData).length > 0) {
    return { ok: true, messageId: messageId ? String(messageId) : undefined };
  }

  return { ok: false, errorDetail: 'Evolution retornou resposta sem confirmação de mídia' };
}

/**
 * Envio de texto com retry BR (com/sem 9º dígito) — mesmo critério das campanhas.
 * Aniversário / chat 1:1 usam este caminho; sem ele o exists:false aborta na 1ª variante.
 */
export async function postEvolutionSendTextWithBrVariants(
  api: AxiosInstance,
  instanceName: string,
  to: string,
  text: string
): Promise<{ messageId?: string; numberUsed: string; isPending?: boolean }> {
  const normalized = normalizeOutboundNumber(to) || normalizeOutboundDigits(to);
  if (!normalized) throw new Error(`Número inválido: ${to}`);
  const list = await numbersToTryOnEvolution(api, instanceName, normalized);
  let lastErr: Error | null = null;

  for (let i = 0; i < list.length; i++) {
    try {
      const result = await postEvolutionSendText(api, instanceName, list[i], text);
      return { ...result, numberUsed: list[i] };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const canRetry = i < list.length - 1 && isRetryableExistsFalseError(lastErr.message);
      if (!canRetry) throw lastErr;
    }
  }

  throw lastErr || new Error('Falha ao enviar mensagem');
}

/** Consulta whatsappNumbers e coloca os confirmados na frente (fixo vs 9º dígito). */
export async function numbersToTryOnEvolution(
  api: AxiosInstance,
  instanceName: string,
  to: string
): Promise<string[]> {
  const normalized = normalizeOutboundNumber(to) || normalizeOutboundDigits(to);
  const variants = buildOutboundPhoneVariants(normalized);
  const list = variants.length > 0 ? variants : normalized ? [normalized] : [];
  if (list.length === 0) return [];
  try {
    const response = await api.post(`/chat/whatsappNumbers/${instanceName}`, {
      numbers: list.slice(0, 4),
    });
    const rows = parseWhatsAppNumberCheckRows(response.data);
    const confirmed: string[] = [];
    for (const v of list) {
      const picked = pickWhatsAppCheckResult(rows, v);
      if (!picked.exists || !picked.canonicalNumber) continue;
      const n = normalizeOutboundNumber(picked.canonicalNumber);
      if (n && !confirmed.includes(n)) confirmed.push(n);
    }
    if (confirmed.length === 0) return list;
    const rest = list.filter((v) => !confirmed.includes(v));
    return [...confirmed, ...rest];
  } catch {
    return list;
  }
}

export type OutboundSendTarget = { number: string };

/**
 * Resolve o campo `number` do sendText/sendMedia da Evolution (somente telefone E.164).
 * Nunca envia JID @lid — a API responde exists:false.
 */
export function resolveOutboundSendTarget(
  remoteJid: string,
  conv?: { contactPhone?: string; waJidAlt?: string } | null
): OutboundSendTarget {
  const jid = String(remoteJid || '').trim();
  if (!jid) throw new Error('JID da conversa inválido.');

  const peer = mergeLidPeerFields(jid, {
    contactPhone: conv?.contactPhone,
    waJidAlt: conv?.waJidAlt
  });

  if (hasResolvablePhone(peer)) {
    const digits = normalizeOutboundDigits(peer.contactPhone.replace(/\D/g, ''));
    return { number: digits };
  }

  if (isLidJid(jid)) {
    throw new Error(LID_SEND_BLOCKED_MSG);
  }

  const fromJid = jid.split('@')[0].replace(/\D/g, '');
  if (plausiblePhoneDigits(fromJid)) {
    return { number: normalizeOutboundDigits(fromJid) };
  }

  const altJid = pickSendableWaJidAlt(conv?.waJidAlt);
  if (altJid) {
    return { number: normalizeOutboundDigits(altJid.split('@')[0]) };
  }

  throw new Error(LID_SEND_BLOCKED_MSG);
}

export function formatEvolutionHttpError(err: unknown, originalPhone?: string): string {
  if (isTransientEvolutionNetworkError(err)) {
    return evolutionNetworkUserMessage();
  }
  const ax = err as { response?: { data?: unknown }; message?: string };
  const data = ax?.response?.data;
  if (typeof data === 'string' && data.trim()) {
    return humanizeEvolutionEngineError(data);
  }
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const nested = o.response as { message?: unknown } | undefined;
    const raw = nested?.message ?? o.message ?? o.error;
    if (Array.isArray(raw)) {
      const parts = raw.map((x) => {
        if (typeof x === 'string') return x;
        if (x && typeof x === 'object') {
          const row = x as { exists?: boolean; jid?: string };
          if (row.exists === false) {
            const badJid = String(row.jid || '');
            if (badJid.endsWith('@lid')) return LID_SEND_BLOCKED_MSG;
            const digits = badJid.split('@')[0] || badJid;
            const display = originalPhone
              ? formatPhoneForError(originalPhone)
              : formatPhoneForError(digits);
            return `Contato não encontrado no WhatsApp (${display})`;
          }
        }
        try {
          return JSON.stringify(x);
        } catch {
          return 'Erro de envio';
        }
      });
      const joined = parts.filter(Boolean).join(' — ');
      if (joined) return humanizeEvolutionEngineError(joined);
    }
    if (typeof raw === 'string' && raw.trim()) return humanizeEvolutionEngineError(raw);
  }
  const m = String(ax?.message || '').trim();
  if (GO_INVALID_UUID_RE.test(m)) return EVOLUTION_GO_INVALID_UUID_HINT;
  if (/status code 400/i.test(m)) {
    return 'WhatsApp recusou o envio (400). Sincronize a conversa ou abra o chat no celular primeiro.';
  }
  return m || 'Falha ao enviar mensagem';
}
