import type { AxiosInstance } from 'axios';
import { looksLikeLongLidDigits, normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import type { ChatMessage } from './types.js';
import { chatRemoteJidFromFindChatsRow, normalizeChatRemoteJid } from './evolutionChatJid.js';

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
  const waJidAlt = pickSendableWaJidAlt(
    key.remoteJidAlt,
    key.senderPn,
    key.participant,
    key.sender
  );
  if (!waJidAlt) return null;
  const contactPhone = formatPhoneFromDigits(waJidAlt.split('@')[0]);
  return contactPhone ? { contactPhone, waJidAlt } : null;
}

/** Varre JSON da Evolution em busca de JID com telefone real (histórico sem key.remoteJidAlt). */
export function deepScanPnJidFromRecord(raw: unknown, depth = 0): string | undefined {
  if (depth > 10 || raw == null) return undefined;
  if (typeof raw === 'string') {
    const m = raw.match(/(\d{10,13})@(s\.whatsapp\.net|c\.us)/i);
    if (m && plausiblePhoneDigits(m[1])) {
      const host = m[0].toLowerCase().includes('c.us') ? 'c.us' : 's.whatsapp.net';
      return `${normalizeOutboundDigits(m[1])}@${host}`;
    }
    return undefined;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const hit = deepScanPnJidFromRecord(item, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof raw === 'object') {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      const hit = deepScanPnJidFromRecord(v, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function peerFromRawMessageRecord(raw: Record<string, unknown> | null | undefined): LidPeerFields | null {
  if (!raw) return null;
  const keyHit = peerFromMessageKey(
    (raw.key && typeof raw.key === 'object' ? raw.key : undefined) as Record<string, unknown> | undefined
  );
  if (keyHit) return keyHit;
  const topAlt = pickSendableWaJidAlt(
    raw.remoteJidAlt,
    raw.senderPn,
    raw.participant,
    raw.sender
  );
  if (topAlt) {
    const contactPhone = formatPhoneFromDigits(topAlt.split('@')[0]);
    if (contactPhone) return { contactPhone, waJidAlt: topAlt };
  }
  const scanned = deepScanPnJidFromRecord(raw);
  if (scanned) {
    const contactPhone = formatPhoneFromDigits(scanned.split('@')[0]);
    if (contactPhone) return { contactPhone, waJidAlt: scanned };
  }
  return null;
}

/** Usa metadados guardados nas mensagens já sincronizadas no painel. */
export function peerFromStoredMessages(messages: ChatMessage[] | undefined): LidPeerFields | null {
  const list = messages || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m) continue;
    const alt = pickSendableWaJidAlt(m.waRemoteJidAlt, m.waSenderPn);
    if (!alt) continue;
    const contactPhone = formatPhoneFromDigits(alt.split('@')[0]);
    if (contactPhone) return { contactPhone, waJidAlt: alt };
  }
  return null;
}

function extractFindChatsList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as Record<string, unknown>;
  for (const key of ['chats', 'records', 'data', 'response'] as const) {
    const v = row[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

export async function resolveLidPeerFromFindChats(
  api: AxiosInstance,
  evoInst: (connectionId: string) => string,
  connectionId: string,
  lidJid: string
): Promise<LidPeerFields | null> {
  const inst = evoInst(connectionId);
  const lid = String(lidJid || '').trim();
  if (!isLidJid(lid)) return null;

  for (let page = 1; page <= 30; page++) {
    try {
      const res = await api.post(`/chat/findChats/${inst}`, { page, limit: 500 });
      const list = extractFindChatsList(res.data);
      if (list.length === 0) break;
      for (const chat of list) {
        const jid = chatRemoteJidFromFindChatsRow(chat);
        if (jid !== lid) continue;
        const peer = peerFieldsFromEvolutionChatRow(chat);
        if (hasResolvablePhone(peer)) return peer;
        const scanned = deepScanPnJidFromRecord(chat);
        if (scanned) {
          const contactPhone = formatPhoneFromDigits(scanned.split('@')[0]);
          if (contactPhone) return { contactPhone, waJidAlt: scanned };
        }
      }
      if (list.length < 500) break;
    } catch {
      break;
    }
  }
  return null;
}

async function resolveLidPeerFromBroadFindMessages(
  api: AxiosInstance,
  evoInst: (connectionId: string) => string,
  connectionId: string,
  lidJid: string
): Promise<LidPeerFields | null> {
  const inst = evoInst(connectionId);
  const lid = String(lidJid || '').trim();

  for (let page = 1; page <= 12; page++) {
    try {
      const res = await api.post(`/chat/findMessages/${inst}`, {
        page,
        offset: 80,
        limit: 80,
      });
      const { records } = extractFindMessagesRecords(res.data);
      if (records.length === 0) break;
      for (const m of records) {
        const rjid = String((m as Record<string, unknown>)?.key &&
          typeof (m as Record<string, unknown>).key === 'object'
          ? ((m as Record<string, unknown>).key as Record<string, unknown>).remoteJid
          : '');
        if (rjid !== lid) continue;
        const hit = peerFromRawMessageRecord(m as Record<string, unknown>);
        if (hit && hasResolvablePhone(hit)) return hit;
      }
      if (records.length < 80) break;
    } catch {
      break;
    }
  }
  return null;
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

/** Perfil Evolution/Baileys — às vezes expõe wid/wuid com @s.whatsapp.net para @lid. */
export async function resolveLidPeerFromFetchProfile(
  api: AxiosInstance,
  evoInst: (connectionId: string) => string,
  connectionId: string,
  lidJid: string
): Promise<LidPeerFields | null> {
  const inst = evoInst(connectionId);
  const lid = String(lidJid || '').trim();
  if (!isLidJid(lid)) return null;
  try {
    const res = await api.post(`/chat/fetchProfile/${inst}`, { number: lid });
    const scanned = deepScanPnJidFromRecord(res.data);
    if (scanned) {
      const contactPhone = formatPhoneFromDigits(scanned.split('@')[0]);
      if (contactPhone) return { contactPhone, waJidAlt: scanned };
    }
    if (res.data && typeof res.data === 'object') {
      const row = res.data as Record<string, unknown>;
      for (const field of ['wid', 'wuid', 'id', 'remoteJid', 'number', 'phoneNumber', 'pn']) {
        const alt = pickSendableWaJidAlt(row[field]);
        if (alt) {
          const contactPhone = formatPhoneFromDigits(alt.split('@')[0]);
          if (contactPhone) return { contactPhone, waJidAlt: alt };
        }
        const digits = normalizePhoneDigits(String(row[field] ?? '').split('@')[0]);
        if (plausiblePhoneDigits(digits) && !looksLikeLongLidDigits(digits)) {
          const contactPhone = formatPhoneFromDigits(digits);
          if (contactPhone) {
            return {
              contactPhone,
              waJidAlt: `${normalizeOutboundDigits(digits)}@s.whatsapp.net`
            };
          }
        }
      }
    }
  } catch {
    /* Evolution 2.2 pode não expor telefone — segue outros fallbacks */
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

  const fromProfile = await resolveLidPeerFromFetchProfile(api, evoInst, connectionId, lid);
  if (fromProfile && hasResolvablePhone(fromProfile)) return fromProfile;

  const fromChats = await resolveLidPeerFromFindChats(api, evoInst, connectionId, lid);
  if (fromChats && hasResolvablePhone(fromChats)) return fromChats;

  try {
    const msgRes = await api.post(`/chat/findMessages/${inst}`, {
      where: { key: { remoteJid: lid } },
      page: 1,
      offset: 80,
      limit: 80,
    });
    const { records } = extractFindMessagesRecords(msgRes.data);
    for (const m of records) {
      const hit = peerFromRawMessageRecord(m as Record<string, unknown>);
      if (hit && hasResolvablePhone(hit)) return hit;
    }
  } catch {
    /* tenta varredura ampla */
  }

  const fromBroad = await resolveLidPeerFromBroadFindMessages(api, evoInst, connectionId, lid);
  if (fromBroad && hasResolvablePhone(fromBroad)) return fromBroad;

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
