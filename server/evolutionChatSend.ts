import {
  hasResolvablePhone,
  isLidJid,
  LID_SEND_BLOCKED_MSG,
  mergeLidPeerFields,
  normalizeOutboundDigits,
  pickSendableWaJidAlt,
  plausiblePhoneDigits
} from './evolutionLidResolve.js';

export { normalizeOutboundDigits, plausiblePhoneDigits };

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

export function formatEvolutionHttpError(err: unknown): string {
  const ax = err as { response?: { data?: unknown }; message?: string };
  const data = ax?.response?.data;
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
            return `Contato não encontrado no WhatsApp (${badJid || 'número inválido'})`;
          }
        }
        try {
          return JSON.stringify(x);
        } catch {
          return 'Erro de envio';
        }
      });
      const joined = parts.filter(Boolean).join(' — ');
      if (joined) return joined;
    }
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  const m = String(ax?.message || '').trim();
  if (/status code 400/i.test(m)) {
    return 'WhatsApp recusou o envio (400). Sincronize a conversa ou abra o chat no celular primeiro.';
  }
  return m || 'Falha ao enviar mensagem';
}
