import type { ChatMessage, Conversation } from '../types';
import { normalizePhoneDigits } from './contactPhoneLookup';
import { ensureLatestPreviewInMessages } from './chatMessageMerge';

function remoteTail(conv: Conversation): string {
  const id = conv.id || '';
  return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
}

function isLidConvId(convId: string): boolean {
  return remoteTail({ id: convId } as Conversation).toLowerCase().endsWith('@lid');
}

/** Dígitos usados para cruzar @lid com stub de telefone da campanha. */
export function mergeDigitsForConversation(conv: Conversation): string {
  const cp = normalizePhoneDigits(conv.contactPhone || '');
  if (cp.length >= 10 && cp.length <= 13) return cp;
  const jid = remoteTail(conv);
  const local = normalizePhoneDigits(jid.split('@')[0] || '');
  if (local.length >= 10 && local.length <= 13) return local;
  if (local.length > 13) return local.slice(-11);
  const name = String(conv.contactName || '');
  const m = name.match(/(\d{4,})\s*$/);
  if (m?.[1]) {
    const tail = normalizePhoneDigits(m[1]);
    if (tail.length >= 8) return tail;
  }
  return cp || local;
}

export function suffixMergeKeys(digits: string): string[] {
  const d = normalizePhoneDigits(digits);
  if (d.length < 8) return [];
  const keys: string[] = [];
  for (const len of [11, 10, 9, 8]) {
    if (d.length >= len) keys.push(`sfx:${d.slice(-len)}`);
  }
  return keys;
}

/** Mensagens para renderizar na thread (preview + arquivo + campanha). */
export function materializeThreadMessages(conv: Conversation | null | undefined): ChatMessage[] {
  if (!conv) return [];
  const hydrated = ensureLatestPreviewInMessages(conv);
  const fromArray = hydrated.messages || [];
  if (fromArray.length > 0) return fromArray;

  const preview = (hydrated.lastMessage || '').trim();
  if (!preview || preview === '[Mídia]') return [];

  const campaignish = (hydrated.tags ?? []).some((t) => /campanha|disparo/i.test(String(t)));
  const ts = hydrated.lastMessageTimestamp || Date.now();
  return [
    {
      id: `preview:${hydrated.id}:${preview.slice(0, 36)}`,
      text: preview,
      timestamp: hydrated.lastMessageTime || '',
      sender: campaignish ? 'me' : 'them',
      status: campaignish ? 'sent' : 'delivered',
      type: 'text',
      timestampMs: ts,
      fromCampaign: campaignish,
    },
  ];
}

/** Une mensagens de threads irmãs (mesmo chip, mesmo telefone/sufixo). */
export function mergeSiblingThreadMessages(
  base: Conversation,
  all: Conversation[]
): Conversation {
  const keys = new Set<string>();
  const baseDigits = mergeDigitsForConversation(base);
  if (isLidConvId(base.id)) {
    for (const k of suffixMergeKeys(baseDigits)) keys.add(k);
  }

  const siblings = all.filter((c) => {
    if (c.id === base.id || c.connectionId !== base.connectionId) return false;
    const d = mergeDigitsForConversation(c);
    if (d.length >= 8 && baseDigits.length >= 8) {
      if (d === baseDigits) return true;
    }
    const baseLid = isLidConvId(base.id);
    const otherLid = isLidConvId(c.id);
    if (baseLid || otherLid) {
      if (d.length >= 8 && baseDigits.length >= 8 && d.slice(-8) === baseDigits.slice(-8)) {
        return true;
      }
      const otherKeys = suffixMergeKeys(d);
      return otherKeys.some((k) => keys.has(k));
    }
    return false;
  });

  if (siblings.length === 0) return base;

  const byId = new Map<string, ChatMessage>();
  for (const m of base.messages || []) {
    if (m?.id) byId.set(m.id, m);
  }
  for (const s of siblings) {
    for (const m of s.messages || []) {
      if (m?.id && !byId.has(m.id)) byId.set(m.id, m);
    }
  }
  const mergedMsgs = Array.from(byId.values()).sort(
    (a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)
  );
  const bestPreview =
    [base, ...siblings]
      .map((c) => ({ t: (c.lastMessage || '').trim(), ts: c.lastMessageTimestamp || 0 }))
      .filter((x) => x.t)
      .sort((a, b) => b.ts - a.ts)[0] || null;

  return ensureLatestPreviewInMessages({
    ...base,
    messages: mergedMsgs.length > 0 ? mergedMsgs : base.messages,
    lastMessage: bestPreview?.t || base.lastMessage,
    lastMessageTimestamp: Math.max(
      base.lastMessageTimestamp || 0,
      ...siblings.map((s) => s.lastMessageTimestamp || 0)
    ),
    tags: Array.from(new Set([...(base.tags || []), ...siblings.flatMap((s) => s.tags || [])])),
  });
}
