import type { AxiosInstance } from 'axios';
import { looksLikeLongLidDigits, normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { normalizeChatRemoteJid } from './evolutionChatJid.js';

export const LID_SEND_BLOCKED_MSG =
  'Não foi possível obter o número deste contato. Peça para ele enviar uma mensagem, abra o chat no WhatsApp do celular e clique em Atualizar na lista.';

export function isLidJid(jid: string): boolean {
  return String(jid || '').trim().toLowerCase().endsWith('@lid');
}

export function plausiblePhoneDigits(digits: string): boolean {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d || looksLikeLongLidDigits(d)) return false;
  return d.length >= 10 && d.length <= 15;
}

export function normalizeOutboundDigits(raw: string): string {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/** JID @s.whatsapp.net / @c.us com telefone plausível — nunca @lid. */
export function pickSendableWaJidAlt(...sources: unknown[]): string | undefined {
  for (const raw of sources) {
    const jid = normalizeChatRemoteJid(raw);
    if (!jid || isLidJid(jid)) continue;
    const digits = jid.split('@')[0].replace(/\D/g, '');
    if (plausiblePhoneDigits(digits)) return jid;
  }
  return undefined;
}

export function formatPhoneFromDigits(digits: string): string {
  const d = normalizeOutboundDigits(digits);
  return d ? `+${d}` : '';
}

export type LidPeerFields = { contactPhone: string; waJidAlt?: string };

export function mergeLidPeerFields(
  remoteJid: string,
  incoming: { contactPhone?: string; waJidAlt?: string },
  existing?: { contactPhone?: string; waJidAlt?: string }
): LidPeerFields {
  const waJidAlt = pickSendableWaJidAlt(
    incoming.waJidAlt,
    existing?.waJidAlt,
    incoming.contactPhone?.includes('@') ? incoming.contactPhone : undefined
  );

  let contactPhone = '';
  if (waJidAlt) {
    const fromAlt = formatPhoneFromDigits(waJidAlt.split('@')[0]);
    if (fromAlt) contactPhone = fromAlt;
  }

  for (const raw of [incoming.contactPhone, existing?.contactPhone]) {
    if (!raw || raw.includes('@')) continue;
    const digits = normalizePhoneDigits(raw);
    if (plausiblePhoneDigits(digits) && !looksLikeLongLidDigits(digits)) {
      contactPhone = formatPhoneFromDigits(digits);
      break;
    }
  }

  if (isLidJid(remoteJid) && contactPhone) {
    const digits = normalizePhoneDigits(contactPhone);
    if (looksLikeLongLidDigits(digits)) contactPhone = '';
  }

  return { contactPhone, waJidAlt };
}

export function hasResolvablePhone(peer: LidPeerFields): boolean {
  const digits = normalizePhoneDigits(peer.contactPhone || '');
  return plausiblePhoneDigits(digits) && !looksLikeLongLidDigits(digits);
}

function extractFindMessagesRecords(raw: unknown): { records: any[] } {
  if (Array.isArray(raw)) return { records: raw };
  if (!raw || typeof raw !== 'object') return { records: [] };
  const row = raw as Record<string, unknown>;
  const bag =
    row.messages && typeof row.messages === 'object'
      ? (row.messages as Record<string, unknown>)
      : row;
  for (const key of ['records', 'messages', 'data'] as const) {
    const v = bag[key];
    if (Array.isArray(v)) return { records: v };
  }
  return { records: [] };
}

function extractFindContactsList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as Record<string, unknown>;
  for (const key of ['contacts', 'records', 'data', 'response'] as const) {
    const v = row[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

export function peerFromMessageKey(key: Record<string, unknown> | undefined): LidPeerFields | null {
  if (!key) return null;
  const waJidAlt = pickSendableWaJidAlt(key.remoteJidAlt, key.senderPn, key.participant);
  if (!waJidAlt) return null;
  const contactPhone = formatPhoneFromDigits(waJidAlt.split('@')[0]);
  return contactPhone ? { contactPhone, waJidAlt } : null;
}

function peerFromContactRow(row: Record<string, unknown>): LidPeerFields | null {
  const waJidAlt = pickSendableWaJidAlt(
    row.remoteJidAlt,
    row.jidAlt,
    row.altJid,
    row.pnJid,
    row.pn,
    row.contact && typeof row.contact === 'object'
      ? (row.contact as Record<string, unknown>).jid
      : undefined
  );
  if (waJidAlt) {
    const contactPhone = formatPhoneFromDigits(waJidAlt.split('@')[0]);
    if (contactPhone) return { contactPhone, waJidAlt };
  }
  for (const field of ['phoneNumber', 'number', 'pn']) {
    const digits = normalizePhoneDigits(String(row[field] ?? '').split('@')[0]);
    if (plausiblePhoneDigits(digits) && !looksLikeLongLidDigits(digits)) {
      return { contactPhone: formatPhoneFromDigits(digits), waJidAlt: waJidAlt || undefined };
    }
  }
  return null;
}

export async function resolveLidPeerFromEvolutionApi(
  api: AxiosInstance,
  evoInst: (connectionId: string) => string,
  connectionId: string,
  lidJid: string
): Promise<LidPeerFields | null> {
  const inst = evoInst(connectionId);
  const lid = String(lidJid || '').trim();
  if (!isLidJid(lid)) return null;

  try {
    const msgRes = await api.post(`/chat/findMessages/${inst}`, {
      where: { key: { remoteJid: lid } },
      page: 1,
      offset: 20,
      limit: 20,
    });
    const { records } = extractFindMessagesRecords(msgRes.data);
    for (const m of records) {
      const hit = peerFromMessageKey((m?.key || m) as Record<string, unknown>);
      if (hit) return hit;
    }
  } catch {
    /* tenta agenda */
  }

  try {
    const ctRes = await api.post(`/chat/findContacts/${inst}`, {
      where: { remoteJid: lid },
      page: 1,
      limit: 10,
    });
    for (const row of extractFindContactsList(ctRes.data)) {
      const rowJid = normalizeChatRemoteJid(row.remoteJid || row.jid || row.id);
      if (rowJid && rowJid !== lid && !isLidJid(rowJid)) {
        const alt = pickSendableWaJidAlt(rowJid, row.remoteJidAlt, row.jidAlt);
        if (alt) {
          const contactPhone = formatPhoneFromDigits(alt.split('@')[0]);
          if (contactPhone) return { contactPhone, waJidAlt: alt };
        }
      }
      const hit = peerFromContactRow(row);
      if (hit) return hit;
    }
  } catch {
    /* ignore */
  }

  return null;
}

/** Extrai PN de linha findChats / webhook (campos Evolution). */
export function peerFieldsFromEvolutionChatRow(
  chat: Record<string, unknown>,
  existing?: { contactPhone?: string; waJidAlt?: string }
): LidPeerFields {
  const lastKey =
    chat.lastMessage && typeof chat.lastMessage === 'object'
      ? ((chat.lastMessage as Record<string, unknown>).key as Record<string, unknown> | undefined)
      : undefined;
  const waJidAlt = pickSendableWaJidAlt(
    chat.remoteJidAlt,
    chat.jidAlt,
    chat.altJid,
    chat.pnJid,
    chat.pn,
    lastKey?.remoteJidAlt,
    lastKey?.senderPn,
    existing?.waJidAlt
  );
  const phoneCandidates: unknown[] = [
    chat.phoneNumber,
    chat.number,
    chat.pn,
    lastKey?.senderPn,
    lastKey?.remoteJidAlt,
    chat.contact && typeof chat.contact === 'object'
      ? (chat.contact as Record<string, unknown>).phoneNumber
      : undefined,
    existing?.contactPhone,
  ];
  let contactPhone = '';
  if (waJidAlt) contactPhone = formatPhoneFromDigits(waJidAlt.split('@')[0]);
  if (!contactPhone) {
    for (const raw of phoneCandidates) {
      const digits = normalizePhoneDigits(String(raw ?? '').split('@')[0]);
      if (plausiblePhoneDigits(digits) && !looksLikeLongLidDigits(digits)) {
        contactPhone = formatPhoneFromDigits(digits);
        break;
      }
    }
  }
  return mergeLidPeerFields(
    String(chat.remoteJid || chat.jid || ''),
    { contactPhone, waJidAlt },
    existing
  );
}
