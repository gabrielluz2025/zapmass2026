import type { ChatMessage, Conversation } from '../types';
import {
  buildPhoneDigitLookupKeys,
  looksLikeLongLidDigits,
  normalizePhoneDigits,
  pickContactDisplayName
} from './contactPhoneLookup';

function remoteJidFromConversationId(id: string): string {
  const colon = id.indexOf(':');
  return colon >= 0 ? id.slice(colon + 1) : id;
}

function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid');
}

/** Preferir JID com telefone real em vez de @lid para id canônico da thread. */
function conversationIdRank(id: string): number {
  const jid = remoteJidFromConversationId(id);
  if (isLidJid(jid)) return 0;
  if (jid.endsWith('@s.whatsapp.net')) return 3;
  if (jid.endsWith('@c.us')) return 2;
  return 1;
}

function newestActivityMs(conv: Conversation): number {
  const msgs = conv.messages || [];
  const last = msgs[msgs.length - 1] as ChatMessage | undefined;
  const fromMsg =
    last != null ? last.timestampMs ?? (last.timestamp ? Date.parse(last.timestamp) : NaN) : NaN;
  const fromMsgN = typeof fromMsg === 'number' && Number.isFinite(fromMsg) ? fromMsg : 0;
  return Math.max(conv.lastMessageTimestamp ?? 0, fromMsgN);
}

function phoneKeysForConversation(conv: Conversation): string[] {
  const keys = new Set<string>();
  const addDigits = (raw: string) => {
    const d = normalizePhoneDigits(raw);
    if (d.length < 8 || looksLikeLongLidDigits(d)) return;
    for (const k of buildPhoneDigitLookupKeys(d)) keys.add(k);
  };

  addDigits(conv.contactPhone || '');
  const altRaw = conv.waJidAlt || '';
  if (altRaw) addDigits(altRaw.split('@')[0]);

  const jid = remoteJidFromConversationId(conv.id);
  if (jid && !isLidJid(jid)) addDigits(jid.split('@')[0]);
  // @lid sem contactPhone: ainda tenta cruzar pelo alt embutido no id de outra thread (raro)
  if (jid && isLidJid(jid) && altRaw.includes('@')) addDigits(altRaw.split('@')[0]);

  return Array.from(keys);
}

/** Une duas threads do mesmo contato (usado no servidor ao redirecionar @lid → JID com telefone). */
export function mergeConversationsPair(a: Conversation, b: Conversation): Conversation {
  return mergeConversationCluster([a, b]);
}

function mergeConversationCluster(cluster: Conversation[]): Conversation {
  const sorted = [...cluster].sort((a, b) => {
    const rankDiff = conversationIdRank(b.id) - conversationIdRank(a.id);
    if (rankDiff !== 0) return rankDiff;
    return newestActivityMs(b) - newestActivityMs(a);
  });
  const primary = sorted[0];
  const msgById = new Map<string, ChatMessage>();
  let unread = 0;
  let bestTs = 0;
  let lastMsg = '';
  let lastTime = '';
  let profilePic = primary.profilePicUrl;
  let waJidAlt = primary.waJidAlt;

  for (const c of sorted) {
    unread += c.unreadCount || 0;
    if (!profilePic && c.profilePicUrl) profilePic = c.profilePicUrl;
    if (!waJidAlt && c.waJidAlt) waJidAlt = c.waJidAlt;
    const ts = newestActivityMs(c);
    if (ts >= bestTs) {
      bestTs = ts;
      if ((c.lastMessage || '').trim()) {
        lastMsg = c.lastMessage;
        lastTime = c.lastMessageTime || lastTime;
      }
    }
    for (const m of c.messages || []) {
      if (m?.id && !msgById.has(m.id)) msgById.set(m.id, m);
    }
  }

  const messages = Array.from(msgById.values()).sort(
    (a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)
  );
  const lastFromMsgs = messages[messages.length - 1];
  if (lastFromMsgs && (lastFromMsgs.timestampMs || 0) >= bestTs) {
    bestTs = lastFromMsgs.timestampMs || bestTs;
    if ((lastFromMsgs.text || '').trim()) lastMsg = lastFromMsgs.text;
    lastTime = lastFromMsgs.timestamp || lastTime;
  }

  const contactName = pickContactDisplayName({
    waName: sorted.map((c) => c.contactName).find((n) => n && !looksLikeLongLidDigits(n)),
    previous: primary.contactName,
    fallback: primary.contactPhone || 'Contato'
  });

  const contactPhone =
    sorted.map((c) => c.contactPhone).find((p) => normalizePhoneDigits(p || '').length >= 8) ||
    primary.contactPhone;

  const tags = Array.from(
    new Set(sorted.flatMap((c) => c.tags || []).filter(Boolean))
  );

  return {
    ...primary,
    contactName,
    contactPhone,
    waJidAlt,
    profilePicUrl: profilePic,
    unreadCount: unread,
    lastMessage: lastMsg || primary.lastMessage,
    lastMessageTime: lastTime || primary.lastMessageTime,
    lastMessageTimestamp: bestTs,
    messages,
    tags
  };
}

function collapseGroup(group: Conversation[]): Conversation[] {
  if (group.length < 2) return group;

  const parent = new Map<number, number>();
  const keyToIdx = new Map<string, number>();

  const find = (i: number): number => {
    let root = i;
    while (true) {
      const p = parent.get(root);
      if (p == null || p === root) return root;
      root = p;
    }
  };

  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (let i = 0; i < group.length; i++) parent.set(i, i);

  for (let i = 0; i < group.length; i++) {
    const keys = phoneKeysForConversation(group[i]);
    if (keys.length === 0) continue;
    for (const k of keys) {
      const prev = keyToIdx.get(k);
      if (prev != null) unite(i, prev);
      else keyToIdx.set(k, i);
    }
  }

  const clusters = new Map<number, Conversation[]>();
  for (let i = 0; i < group.length; i++) {
    const keys = phoneKeysForConversation(group[i]);
    if (keys.length === 0) {
      clusters.set(-1 - i, [group[i]]);
      continue;
    }
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(group[i]);
  }

  const out: Conversation[] = [];
  for (const cluster of clusters.values()) {
    out.push(cluster.length === 1 ? cluster[0] : mergeConversationCluster(cluster));
  }
  return out;
}

/**
 * Une threads duplicadas do mesmo contato no mesmo chip (ex.: @lid + @s.whatsapp.net).
 */
export function collapseConversationsByPhone(list: Conversation[]): Conversation[] {
  if (list.length < 2) return list;

  const byConn = new Map<string, Conversation[]>();
  for (const c of list) {
    const conn = c.connectionId || '_';
    if (!byConn.has(conn)) byConn.set(conn, []);
    byConn.get(conn)!.push(c);
  }

  const result: Conversation[] = [];
  for (const group of byConn.values()) {
    result.push(...collapseGroup(group));
  }

  return result.sort(
    (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
  );
}
