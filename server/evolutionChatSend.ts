import { looksLikeLongLidDigits } from '../src/utils/contactPhoneLookup.js';
import { normalizeChatRemoteJid } from './evolutionChatJid.js';

export function plausiblePhoneDigits(digits: string): boolean {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d || looksLikeLongLidDigits(d)) return false;
  return d.length >= 10 && d.length <= 15;
}

/** Mesma regra de campanhas: BR sem DDI ganha prefixo 55. */
export function normalizeOutboundDigits(raw: string): string {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export type OutboundSendTarget = { number: string };

/**
 * Resolve o campo `number` do sendText/sendMedia da Evolution.
 * Chats @lid: usa telefone real (waJidAlt/contactPhone) ou o JID @lid completo.
 */
export function resolveOutboundSendTarget(
  remoteJid: string,
  conv?: { contactPhone?: string; waJidAlt?: string } | null
): OutboundSendTarget {
  const jid = String(remoteJid || '').trim();
  if (!jid) throw new Error('JID da conversa inválido.');

  const tryPhone = (raw: string): string | null => {
    const digits = raw.replace(/\D/g, '');
    if (!plausiblePhoneDigits(digits)) return null;
    return normalizeOutboundDigits(digits);
  };

  if (jid.endsWith('@lid')) {
    const altJid = normalizeChatRemoteJid(conv?.waJidAlt);
    if (altJid && !altJid.endsWith('@lid')) {
      const hit = tryPhone(altJid.split('@')[0]);
      if (hit) return { number: hit };
    }
    const fromContact = tryPhone(conv?.contactPhone || '');
    if (fromContact) return { number: fromContact };
    return { number: jid };
  }

  const fromJid = tryPhone(jid.split('@')[0]);
  if (fromJid) return { number: fromJid };

  const fromContact = tryPhone(conv?.contactPhone || '');
  if (fromContact) return { number: fromContact };

  const altJid = normalizeChatRemoteJid(conv?.waJidAlt);
  if (altJid) {
    const hit = tryPhone(altJid.split('@')[0]);
    if (hit) return { number: hit };
  }

  if (jid.includes('@')) return { number: jid };

  throw new Error(
    'Não foi possível identificar o número deste contato. Atualize a lista de conversas.'
  );
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
            return `Contato não encontrado no WhatsApp (${row.jid || 'JID inválido'})`;
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
