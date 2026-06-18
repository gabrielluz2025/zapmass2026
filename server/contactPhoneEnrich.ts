import { vpsDataEnabled } from './auth/dataMode.js';
import type { Conversation } from './types.js';
import { getCrmContactIndexes } from './crmContactIndexCache.js';
import {
  buildPhoneDigitLookupKeys,
  looksLikeLongLidDigits,
  normalizePhoneDigits
} from '../src/utils/contactPhoneLookup.js';
import {
  formatPhoneFromDigits,
  hasResolvablePhone,
  mergeLidPeerFields,
  normalizeOutboundDigits,
  plausiblePhoneDigits,
  peerFromStoredMessages,
  type LidPeerFields
} from './evolutionLidResolve.js';

function peerFromE164Digits(digits: string): LidPeerFields | null {
  const e164 = normalizeOutboundDigits(digits);
  if (!plausiblePhoneDigits(e164) || looksLikeLongLidDigits(e164)) return null;
  const contactPhone = formatPhoneFromDigits(e164);
  if (!contactPhone) return null;
  return {
    contactPhone,
    waJidAlt: `${e164}@s.whatsapp.net`
  };
}

/** Telefone do CRM por candidatos de dígitos já conhecidos na conversa. */
function resolveCrmPhoneByDigitIndex(
  byDigits: Map<string, string>,
  ...candidates: string[]
): LidPeerFields | null {
  for (const raw of candidates) {
    const digits = normalizePhoneDigits(raw);
    if (!digits || digits.length < 8) continue;
    for (const key of buildPhoneDigitLookupKeys(digits)) {
      const hit = byDigits.get(key);
      if (hit) return peerFromE164Digits(hit);
    }
  }
  return null;
}

/** Telefone do CRM pelo nome exibido no chat (ex.: "Gabriel"). */
function resolveCrmPhoneByNameIndex(
  byName: Map<string, string>,
  displayName: string
): LidPeerFields | null {
  const key = normalizeNameKey(displayName);
  if (!key || key === 'contato' || key === 'contact') return null;
  const direct = byName.get(key);
  if (direct) return peerFromE164Digits(direct);
  for (const [crmKey, e164] of byName) {
    if (crmKey.startsWith(key) || key.startsWith(crmKey)) {
      const peer = peerFromE164Digits(e164);
      if (peer) return peer;
    }
  }
  return null;
}

function normalizeNameKey(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Cruza conversa @lid (ou telefone inválido) com a base de contatos ZapMass.
 */
export async function resolveCrmPhonePeerForConversation(
  tenantUid: string,
  conv: Pick<Conversation, 'contactName' | 'contactPhone' | 'waJidAlt' | 'id'>
): Promise<LidPeerFields | null> {
  if (!tenantUid || tenantUid === 'anonymous' || !vpsDataEnabled()) return null;
  const { byName, byDigits } = await getCrmContactIndexes(tenantUid);
  if (byName.size === 0 && byDigits.size === 0) return null;

  const idPart = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : '';
  const fromJidDigits = idPart.endsWith('@lid') ? '' : idPart.split('@')[0].replace(/\D/g, '');

  const byDigitsHit = resolveCrmPhoneByDigitIndex(
    byDigits,
    conv.contactPhone || '',
    conv.waJidAlt || '',
    fromJidDigits
  );
  if (byDigitsHit) return byDigitsHit;

  return resolveCrmPhoneByNameIndex(byName, conv.contactName || '');
}

export async function enrichConversationsWithCrmPhones(
  tenantUid: string,
  list: Conversation[]
): Promise<Conversation[]> {
  if (!tenantUid || tenantUid === 'anonymous' || !vpsDataEnabled()) return list;
  const { byName, byDigits } = await getCrmContactIndexes(tenantUid);
  if (byName.size === 0 && byDigits.size === 0) return list;

  return list.map((conv) => {
    const idPart = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : '';
    const remoteJid = idPart.includes('@') ? idPart : '';
    if (!remoteJid) return conv;

    let peer = mergeLidPeerFields(remoteJid, conv);
    if (!hasResolvablePhone(peer)) {
      const fromMsgs = peerFromStoredMessages(conv.messages);
      if (fromMsgs && hasResolvablePhone(fromMsgs)) {
        peer = mergeLidPeerFields(remoteJid, fromMsgs, peer);
      }
    }
    if (!hasResolvablePhone(peer)) {
      const idDigits = remoteJid.endsWith('@lid') ? '' : remoteJid.split('@')[0].replace(/\D/g, '');
      const byDigit =
        resolveCrmPhoneByDigitIndex(byDigits, conv.contactPhone || '', conv.waJidAlt || '', idDigits) ||
        resolveCrmPhoneByNameIndex(byName, conv.contactName || '');
      if (byDigit) peer = mergeLidPeerFields(remoteJid, byDigit, peer);
    }
    if (!hasResolvablePhone(peer)) return scrubInvalidConversationPhone(conv, remoteJid);
    return scrubInvalidConversationPhone(
      { ...conv, contactPhone: peer.contactPhone, waJidAlt: peer.waJidAlt },
      remoteJid
    );
  });
}

export function scrubInvalidConversationPhone(conv: Conversation, remoteJid: string): Conversation {
  const peer = mergeLidPeerFields(remoteJid, conv);
  if (hasResolvablePhone(peer)) {
    if (peer.contactPhone === conv.contactPhone && peer.waJidAlt === conv.waJidAlt) return conv;
    return { ...conv, contactPhone: peer.contactPhone, waJidAlt: peer.waJidAlt };
  }
  const digits = normalizePhoneDigits(conv.contactPhone || '');
  if (looksLikeLongLidDigits(digits) || (remoteJid.endsWith('@lid') && digits.length >= 14)) {
    return { ...conv, contactPhone: '', waJidAlt: conv.waJidAlt };
  }
  return conv;
}
