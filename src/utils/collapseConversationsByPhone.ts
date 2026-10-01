import type { ChatMessage, Conversation } from '../types';
import {
  buildStrongPhoneMergeKeys,
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

/**
 * Escolha de id canônico da thread — só rank + id (nunca timestamp).
 * Timestamps oscilam a cada `conversations-update` e alternavam o id primário → loop React #185.
 */
export function compareConversationsForCanonicalId(a: Conversation, b: Conversation): number {
  const rankDiff = conversationIdRank(b.id) - conversationIdRank(a.id);
  if (rankDiff !== 0) return rankDiff;
  return a.id.localeCompare(b.id);
}

export type ConversationSelectionAnchor = {
  connectionId: string;
  phoneDigits: string;
};

/** Ancora seleção do Bate-papo ao chip + telefone, não ao JID bruto. */
export function selectionAnchorFromConversationId(
  conversationId: string
): ConversationSelectionAnchor | null {
  if (!conversationId) return null;
  if (conversationId.startsWith('draft:')) {
    const digits = conversationId.slice('draft:'.length).replace(/\D/g, '');
    return digits.length >= 8 ? { connectionId: '', phoneDigits: digits } : null;
  }
  const colon = conversationId.indexOf(':');
  const connectionId = colon >= 0 ? conversationId.slice(0, colon) : '';
  const tail = colon >= 0 ? conversationId.slice(colon + 1) : conversationId;
  const phoneDigits = tail.split('@')[0]?.replace(/\D/g, '') || '';
  return phoneDigits.length >= 8 ? { connectionId, phoneDigits } : null;
}

function conversationMatchesPhoneDigits(conv: Conversation, phoneDigits: string): boolean {
  const cp = (conv.contactPhone || '').replace(/\D/g, '');
  const cid = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : conv.id;
  const jidD = cid.split('@')[0]?.replace(/\D/g, '') || '';
  return cp === phoneDigits || jidD === phoneDigits;
}

/** Melhor id da lista para a âncora (determinístico). */
export function pickConversationIdForAnchor(
  list: Conversation[],
  anchor: ConversationSelectionAnchor
): string | null {
  const matches = list.filter((c) => {
    if (anchor.connectionId && (c.connectionId || '') !== anchor.connectionId) return false;
    return conversationMatchesPhoneDigits(c, anchor.phoneDigits);
  });
  if (matches.length === 0) return null;
  return [...matches].sort(compareConversationsForCanonicalId)[0]?.id ?? null;
}

/**
 * Remapeia seleção quando o id sumiu da lista — retorna null se não precisa mudar.
 */
export function reconcileConversationSelection(
  list: Conversation[],
  selectedId: string | null,
  anchor: ConversationSelectionAnchor | null
): string | null {
  if (!selectedId) return null;
  if (list.some((c) => c.id === selectedId)) return null;
  const selectedRank = conversationIdRank(selectedId);
  if (anchor) {
    const picked = pickConversationIdForAnchor(list, anchor);
    if (picked && picked !== selectedId) {
      if (selectedRank > conversationIdRank(picked)) return null;
      return picked;
    }
  }
  const stable = resolveStableConversationId(list, selectedId);
  if (stable && stable !== selectedId) return stable;
  return null;
}

/** Foto real do WhatsApp (não avatar gerado). Path estável — query string muda. */
export function stableWhatsappPicKey(url: string | undefined | null): string {
  const raw = String(url || '').trim();
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (
      host.includes('ui-avatars.com') ||
      host.includes('dicebear') ||
      host.includes('gravatar.com')
    ) {
      return '';
    }
    const path = parsed.pathname || '';
    if (path.length < 12) return '';
    const waHost =
      host.includes('whatsapp.net') ||
      host.includes('whatsapp.com') ||
      host.includes('fbcdn.net');
    if (!waHost && path.length < 24) return '';
    return `${host}${path}`;
  } catch {
    return '';
  }
}

function phoneKeysForConversation(conv: Conversation): string[] {
  const keys = new Set<string>();
  const addDigits = (raw: string) => {
    const d = normalizePhoneDigits(raw);
    if (d.length < 10 || looksLikeLongLidDigits(d)) return;
    for (const k of buildStrongPhoneMergeKeys(d)) keys.add(k);
  };

  addDigits(conv.contactPhone || '');
  const altRaw = conv.waJidAlt || '';
  if (altRaw) addDigits(altRaw.split('@')[0]);

  const jid = remoteJidFromConversationId(conv.id);
  if (jid && !isLidJid(jid)) addDigits(jid.split('@')[0]);
  if (jid && isLidJid(jid)) {
    const local = normalizePhoneDigits(jid.split('@')[0] || '');
    if (local.length >= 10 && local.length <= 13) addDigits(local);
    else if (local.length > 13) addDigits(local.slice(-11));
  }
  if (altRaw.includes('@')) addDigits(altRaw.split('@')[0]);

  // Sufixo só em @lid (evita colapsar dois telefones BR distintos pelo mesmo 8 dígitos).
  if (isLidJid(jid)) {
    const mergeD =
      normalizePhoneDigits(conv.contactPhone || '') ||
      normalizePhoneDigits(jid.split('@')[0] || '');
    const tail = mergeD.length > 13 ? mergeD.slice(-11) : mergeD;
    if (tail.length >= 8) {
      for (const len of [11, 10, 9, 8]) {
        if (tail.length >= len) keys.add(`sfx:${tail.slice(-len)}`);
      }
    }
  }

  return Array.from(keys);
}

/** Une duas threads do mesmo contato (usado no servidor ao redirecionar @lid → JID com telefone). */
export function mergeConversationsPair(a: Conversation, b: Conversation): Conversation {
  return mergeConversationCluster([a, b]);
}

function mergeConversationCluster(cluster: Conversation[]): Conversation {
  const sorted = [...cluster].sort(compareConversationsForCanonicalId);
  const primary = sorted[0];
  const msgById = new Map<string, ChatMessage>();
  let unread = 0;
  let bestTs = 0;
  let lastMsg = '';
  let lastTime = '';
  let profilePic = primary.profilePicUrl;
  let waJidAlt = primary.waJidAlt;
  let waPresence = primary.waPresence;
  let waPresenceUpdatedAt = primary.waPresenceUpdatedAt ?? 0;
  let waLastSeenMs = primary.waLastSeenMs ?? 0;

  for (const c of sorted) {
    unread += c.unreadCount || 0;
    if (!profilePic && c.profilePicUrl) profilePic = c.profilePicUrl;
    if (!waJidAlt && c.waJidAlt) waJidAlt = c.waJidAlt;
    const pAt = c.waPresenceUpdatedAt ?? 0;
    if (pAt >= waPresenceUpdatedAt) {
      waPresenceUpdatedAt = pAt;
      waPresence = c.waPresence ?? waPresence;
    }
    waLastSeenMs = Math.max(waLastSeenMs, c.waLastSeenMs ?? 0);
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

  const waContactName =
    sorted.map((c) => c.waContactName).find((n) => n && !looksLikeLongLidDigits(n)) ||
    sorted
      .map((c) => c.contactName)
      .find((n) => n && !looksLikeLongLidDigits(n) && n !== contactName) ||
    primary.waContactName;

  const contactPhone =
    sorted.map((c) => c.contactPhone).find((p) => normalizePhoneDigits(p || '').length >= 8) ||
    primary.contactPhone;

  const tags = Array.from(
    new Set(sorted.flatMap((c) => c.tags || []).filter(Boolean))
  );

  return {
    ...primary,
    contactName,
    ...(waContactName && waContactName !== contactName ? { waContactName } : {}),
    contactPhone,
    waJidAlt,
    profilePicUrl: profilePic,
    unreadCount: unread,
    lastMessage: lastMsg || primary.lastMessage,
    lastMessageTime: lastTime || primary.lastMessageTime,
    lastMessageTimestamp: bestTs,
    messages,
    tags,
    waPresence,
    waPresenceUpdatedAt: waPresenceUpdatedAt || undefined,
    waLastSeenMs: waLastSeenMs || undefined
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

/** ID estável ao unir @lid + telefone — evita loop de setState no Bate-papo. */
export function resolveStableConversationId(
  list: Conversation[],
  selectedId: string | null
): string | null {
  if (!selectedId) return null;
  if (list.some((c) => c.id === selectedId)) return selectedId;

  const selectedRank = conversationIdRank(selectedId);
  const tail = selectedId.includes(':') ? selectedId.slice(selectedId.indexOf(':') + 1) : selectedId;
  const digits = tail.split('@')[0]?.replace(/\D/g, '') || '';
  if (digits.length < 8) return null;

  const matches = list.filter((c) => {
    const cp = (c.contactPhone || '').replace(/\D/g, '');
    const cid = c.id.includes(':') ? c.id.slice(c.id.indexOf(':') + 1) : c.id;
    const jidD = cid.split('@')[0]?.replace(/\D/g, '') || '';
    return cp === digits || jidD === digits;
  });
  if (matches.length === 0) return null;

  const sorted = [...matches].sort(compareConversationsForCanonicalId);
  const best = sorted[0]?.id ?? null;
  if (!best) return null;
  /** Inbox oscilando só @lid ↔ telefone: não rebaixar JID (causa loop React #185). */
  if (selectedRank > conversationIdRank(best)) return null;
  return best;
}

/** Sobe para @s.whatsapp.net quando o id selecionado ainda é @lid na lista. */
export function upgradeStableConversationId(
  list: Conversation[],
  selectedId: string | null
): string | null {
  if (!selectedId || !list.some((c) => c.id === selectedId)) return null;
  const rank = conversationIdRank(selectedId);
  if (rank >= 3) return null;
  const tail = selectedId.includes(':') ? selectedId.slice(selectedId.indexOf(':') + 1) : selectedId;
  const digits = tail.split('@')[0]?.replace(/\D/g, '') || '';
  const cp = list.find((c) => c.id === selectedId)?.contactPhone?.replace(/\D/g, '') || '';
  const lookupDigits = cp.length >= 8 ? cp : digits;
  if (lookupDigits.length < 8) return null;
  const matches = list.filter((c) => {
    const ccp = (c.contactPhone || '').replace(/\D/g, '');
    const cid = c.id.includes(':') ? c.id.slice(c.id.indexOf(':') + 1) : c.id;
    const jidD = cid.split('@')[0]?.replace(/\D/g, '') || '';
    return ccp === lookupDigits || jidD === lookupDigits;
  });
  if (matches.length < 2) return null;
  const sorted = [...matches].sort(compareConversationsForCanonicalId);
  const best = sorted[0]?.id ?? null;
  if (!best || best === selectedId || conversationIdRank(best) <= rank) return null;
  return best;
}
