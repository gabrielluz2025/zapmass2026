import { inboxMergeEquivalenceKeys, localDigitsFromWaAddress, looksLikeLongLidDigits, normalizePhoneDigits, pickContactDisplayName, stripWhatsAppJidSuffix } from './contactPhoneLookup';
function remoteJidFromConversationId(id) {
    const colon = id.indexOf(':');
    return colon >= 0 ? id.slice(colon + 1) : id;
}
function isLidJid(jid) {
    return jid.endsWith('@lid');
}
function conversationIdRank(id) {
    const jid = remoteJidFromConversationId(id);
    if (isLidJid(jid))
        return 0;
    if (jid.endsWith('@s.whatsapp.net'))
        return 3;
    if (jid.endsWith('@c.us'))
        return 2;
    return 1;
}
function newestActivityMs(conv) {
    const msgs = conv.messages || [];
    const last = msgs[msgs.length - 1];
    const fromMsg = last != null ? last.timestampMs ?? (last.timestamp ? Date.parse(last.timestamp) : NaN) : NaN;
    const fromMsgN = typeof fromMsg === 'number' && Number.isFinite(fromMsg) ? fromMsg : 0;
    return Math.max(conv.lastMessageTimestamp ?? 0, fromMsgN);
}
export function compareConversationsForCanonicalId(a, b) {
    const rankDiff = conversationIdRank(b.id) - conversationIdRank(a.id);
    if (rankDiff !== 0)
        return rankDiff;
    return a.id.localeCompare(b.id);
}
export function selectionAnchorFromConversationId(conversationId) {
    if (!conversationId)
        return null;
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
export function phonesEquivalentForInboxMerge(a, b) {
    const da = localDigitsFromWaAddress(a) || normalizePhoneDigits(a);
    const db = localDigitsFromWaAddress(b) || normalizePhoneDigits(b);
    if (!da || !db || da.length < 8 || db.length < 8)
        return false;
    if (da === db)
        return true;
    const keysA = new Set(inboxMergeEquivalenceKeys(da));
    for (const k of inboxMergeEquivalenceKeys(db)) {
        if (keysA.has(k))
            return true;
    }
    return false;
}
function conversationMatchesPhoneDigits(conv, phoneDigits) {
    const cp = localDigitsFromWaAddress(conv.contactPhone || '');
    const cid = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : conv.id;
    const jidPart = localDigitsFromWaAddress(stripWhatsAppJidSuffix(cid));
    if (phonesEquivalentForInboxMerge(cp, phoneDigits))
        return true;
    if (phonesEquivalentForInboxMerge(jidPart, phoneDigits))
        return true;
    const alt = localDigitsFromWaAddress(conv.waJidAlt || '');
    if (alt && phonesEquivalentForInboxMerge(alt, phoneDigits))
        return true;
    return false;
}
export function pickConversationIdForAnchor(list, anchor) {
    const matches = list.filter((c) => {
        if (anchor.connectionId && (c.connectionId || '') !== anchor.connectionId)
            return false;
        return conversationMatchesPhoneDigits(c, anchor.phoneDigits);
    });
    if (matches.length === 0)
        return null;
    return [...matches].sort(compareConversationsForCanonicalId)[0]?.id ?? null;
}
export function reconcileConversationSelection(list, selectedId, anchor) {
    if (!selectedId)
        return null;
    if (list.some((c) => c.id === selectedId))
        return null;
    const selectedRank = conversationIdRank(selectedId);
    if (anchor) {
        const picked = pickConversationIdForAnchor(list, anchor);
        if (picked && picked !== selectedId) {
            if (selectedRank > conversationIdRank(picked))
                return null;
            return picked;
        }
    }
    const stable = resolveStableConversationId(list, selectedId);
    if (stable && stable !== selectedId)
        return stable;
    return null;
}
export function stableWhatsappPicKey(url) {
    const raw = String(url || '').trim();
    if (!raw.startsWith('http://') && !raw.startsWith('https://'))
        return '';
    try {
        const parsed = new URL(raw);
        const host = parsed.hostname.toLowerCase();
        if (host.includes('ui-avatars.com') ||
            host.includes('dicebear') ||
            host.includes('gravatar.com')) {
            return '';
        }
        const path = parsed.pathname || '';
        if (path.length < 12)
            return '';
        const waHost = host.includes('whatsapp.net') ||
            host.includes('whatsapp.com') ||
            host.includes('fbcdn.net');
        if (!waHost && path.length < 24)
            return '';
        return `${host}${path}`;
    }
    catch {
        return '';
    }
}
export function inboxPhoneKeysForConversation(conv, resolvedOnly = false) {
    return phoneKeysForConversation(conv, resolvedOnly);
}
function phoneKeysForConversation(conv, resolvedOnly = false) {
    const keys = new Set();
    const addDigits = (raw) => {
        const d = localDigitsFromWaAddress(raw) || normalizePhoneDigits(raw);
        if (d.length < 10 || looksLikeLongLidDigits(d))
            return;
        for (const k of inboxMergeEquivalenceKeys(d))
            keys.add(k);
    };
    addDigits(conv.contactPhone || '');
    const altRaw = stripWhatsAppJidSuffix(conv.waJidAlt || '');
    if (altRaw)
        addDigits(altRaw);
    const jidRaw = remoteJidFromConversationId(conv.id);
    if (jidRaw && !isLidJid(jidRaw))
        addDigits(jidRaw);
    if (jidRaw && isLidJid(jidRaw) && !resolvedOnly) {
        const local = localDigitsFromWaAddress(jidRaw);
        if (local.length >= 10 && local.length <= 13)
            addDigits(local);
        else if (local.length > 13)
            addDigits(local.slice(-11));
    }
    if (isLidJid(jidRaw)) {
        const msgs = conv.messages || [];
        for (let i = msgs.length - 1, seen = 0; i >= 0 && seen < 40; i--, seen++) {
            const m = msgs[i];
            if (m?.waRemoteJidAlt && !isLidJid(m.waRemoteJidAlt)) {
                addDigits(stripWhatsAppJidSuffix(m.waRemoteJidAlt));
            }
            if (m?.sender === 'them' && m.waSenderPn && !isLidJid(m.waSenderPn)) {
                addDigits(stripWhatsAppJidSuffix(m.waSenderPn));
            }
        }
    }
    if (isLidJid(jidRaw) && !resolvedOnly) {
        const mergeD = localDigitsFromWaAddress(conv.contactPhone || '') ||
            localDigitsFromWaAddress(jidRaw);
        const tail = mergeD.length > 13 ? mergeD.slice(-11) : mergeD;
        if (tail.length >= 8) {
            for (const len of [11, 10, 9, 8]) {
                if (tail.length >= len)
                    keys.add(`sfx:${tail.slice(-len)}`);
            }
        }
    }
    return Array.from(keys);
}
export function isEmptyUnresolvedLidStub(conv) {
    if (!isLidJid(remoteJidFromConversationId(conv.id)))
        return false;
    if ((conv.messages?.length || 0) > 0 || (conv.lastMessage || '').trim())
        return false;
    if ((conv.unreadCount || 0) > 0)
        return false;
    return phoneKeysForConversation(conv, true).length === 0;
}
export function isJunkInboxJid(jid) {
    const j = String(jid || '').trim().toLowerCase();
    if (!j)
        return true;
    if (j.includes('@broadcast') || j.endsWith('@newsletter'))
        return true;
    if (j.endsWith('@g.us') || j.endsWith('@lid'))
        return false;
    const digits = (j.split('@')[0] || '').replace(/\D/g, '');
    if (!digits || digits === '0')
        return true;
    return digits.length < 8;
}
export function isJunkInboxLabel(name) {
    const t = String(name ?? '').trim();
    if (!t)
        return true;
    if (t === '0')
        return true;
    if (t.includes('@'))
        return true;
    return false;
}
export function isJunkInboxConversation(conv) {
    const id = String(conv?.id || '').trim();
    if (!id || id.indexOf(':') < 0)
        return true;
    const jid = remoteJidFromConversationId(id);
    if (isJunkInboxJid(jid))
        return true;
    const msgs = conv.messages?.length || 0;
    const name = String(conv.contactName || '').trim();
    const phone = String(conv.contactPhone || '').trim();
    if (msgs === 0 && (name === '0' || phone === '0' || phone === '+0')) {
        return phoneKeysForConversation(conv, true).length === 0;
    }
    return false;
}
export function sanitizeInboxConversationDisplay(conv) {
    if (!isJunkInboxLabel(conv.contactName))
        return conv;
    const candidates = [
        conv.contactPhone || '',
        stripWhatsAppJidSuffix(conv.contactName || ''),
        remoteJidFromConversationId(conv.id || '')
    ];
    for (const raw of candidates) {
        if (isLidJid(String(raw)))
            continue;
        const d = localDigitsFromWaAddress(String(raw)) || normalizePhoneDigits(String(raw));
        if (d.length >= 8 && d.length <= 13 && d !== '0') {
            return { ...conv, contactName: `+${d}` };
        }
    }
    return { ...conv, contactName: 'Contato' };
}
export function mergeConversationsPair(a, b) {
    return mergeConversationCluster([a, b]);
}
function mergeConversationCluster(cluster) {
    const sorted = [...cluster].sort(compareConversationsForCanonicalId);
    const primary = sorted[0];
    const msgById = new Map();
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
        if (!profilePic && c.profilePicUrl)
            profilePic = c.profilePicUrl;
        if (!waJidAlt && c.waJidAlt)
            waJidAlt = c.waJidAlt;
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
            if (m?.id && !msgById.has(m.id))
                msgById.set(m.id, m);
        }
    }
    const messages = Array.from(msgById.values()).sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
    const lastFromMsgs = messages[messages.length - 1];
    if (lastFromMsgs && (lastFromMsgs.timestampMs || 0) >= bestTs) {
        bestTs = lastFromMsgs.timestampMs || bestTs;
        if ((lastFromMsgs.text || '').trim())
            lastMsg = lastFromMsgs.text;
        lastTime = lastFromMsgs.timestamp || lastTime;
    }
    const contactName = pickContactDisplayName({
        waName: sorted.map((c) => c.contactName).find((n) => n && !looksLikeLongLidDigits(n)),
        previous: primary.contactName,
        fallback: primary.contactPhone || 'Contato'
    });
    const waContactName = sorted.map((c) => c.waContactName).find((n) => n && !looksLikeLongLidDigits(n)) ||
        sorted
            .map((c) => c.contactName)
            .find((n) => n && !looksLikeLongLidDigits(n) && n !== contactName) ||
        primary.waContactName;
    const contactPhone = sorted.map((c) => c.contactPhone).find((p) => normalizePhoneDigits(p || '').length >= 8) ||
        primary.contactPhone;
    const tags = Array.from(new Set(sorted.flatMap((c) => c.tags || []).filter(Boolean)));
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
const TWIN_MAX_TS_DIFF_MS = 12 * 60 * 60 * 1000;
function normalizeTwinName(name) {
    return String(name ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}
function twinKeyForConversation(conv) {
    const name = normalizeTwinName(conv.contactName);
    if (name.length < 2 || name === 'contato' || name.startsWith('+') || name.includes('@'))
        return '';
    if (/^[\d\s().-]+$/.test(name) || looksLikeLongLidDigits(name))
        return '';
    const preview = String(conv.lastMessage || '').trim().toLowerCase();
    if (!preview)
        return '';
    return `${name}\u0001${preview}`;
}
function areTwinConversations(a, b) {
    const tsA = newestActivityMs(a);
    const tsB = newestActivityMs(b);
    const sameTime = (a.lastMessageTime && a.lastMessageTime === b.lastMessageTime) ||
        (tsA > 0 && tsB > 0 && Math.abs(tsA - tsB) <= TWIN_MAX_TS_DIFF_MS);
    if (!sameTime)
        return false;
    const unresolvedA = phoneKeysForConversation(a, true).length === 0;
    const unresolvedB = phoneKeysForConversation(b, true).length === 0;
    return unresolvedA !== unresolvedB;
}
function mergeSameIdConversations(group) {
    const byId = new Map();
    for (const c of group) {
        const arr = byId.get(c.id);
        if (arr)
            arr.push(c);
        else
            byId.set(c.id, [c]);
    }
    if (byId.size === group.length)
        return group;
    return Array.from(byId.values()).map((arr) => (arr.length === 1 ? arr[0] : mergeConversationCluster(arr)));
}
function collapseGroup(rawGroup, aliases) {
    const group = mergeSameIdConversations(rawGroup);
    if (group.length < 2)
        return group;
    const parent = new Map();
    const keyToIdx = new Map();
    const find = (i) => {
        let root = i;
        while (true) {
            const p = parent.get(root);
            if (p == null || p === root)
                return root;
            root = p;
        }
    };
    const unite = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb)
            parent.set(rb, ra);
    };
    for (let i = 0; i < group.length; i++)
        parent.set(i, i);
    for (let i = 0; i < group.length; i++) {
        const keys = phoneKeysForConversation(group[i]);
        if (keys.length === 0)
            continue;
        for (const k of keys) {
            const prev = keyToIdx.get(k);
            if (prev != null)
                unite(i, prev);
            else
                keyToIdx.set(k, i);
        }
    }
    const twinBuckets = new Map();
    for (let i = 0; i < group.length; i++) {
        const tk = twinKeyForConversation(group[i]);
        if (!tk)
            continue;
        const arr = twinBuckets.get(tk);
        if (arr)
            arr.push(i);
        else
            twinBuckets.set(tk, [i]);
    }
    for (const idxs of twinBuckets.values()) {
        if (idxs.length < 2)
            continue;
        for (let x = 0; x < idxs.length; x++) {
            for (let y = x + 1; y < idxs.length; y++) {
                if (areTwinConversations(group[idxs[x]], group[idxs[y]]))
                    unite(idxs[x], idxs[y]);
            }
        }
    }
    const clusters = new Map();
    for (let i = 0; i < group.length; i++) {
        const root = find(i);
        if (!clusters.has(root))
            clusters.set(root, []);
        clusters.get(root).push(group[i]);
    }
    const out = [];
    for (const cluster of clusters.values()) {
        if (cluster.length === 1) {
            out.push(cluster[0]);
            continue;
        }
        const merged = mergeConversationCluster(cluster);
        if (aliases) {
            for (const c of cluster) {
                if (c.id !== merged.id)
                    aliases.set(c.id, merged.id);
            }
        }
        out.push(merged);
    }
    return out;
}
export function collapseConversationsByPhoneDetailed(list) {
    const aliases = new Map();
    if (list.length < 2)
        return { list, aliases };
    const byConn = new Map();
    for (const c of list) {
        const conn = c.connectionId || '_';
        if (!byConn.has(conn))
            byConn.set(conn, []);
        byConn.get(conn).push(c);
    }
    const result = [];
    for (const group of byConn.values()) {
        result.push(...collapseGroup(group, aliases));
    }
    return {
        list: result.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)),
        aliases
    };
}
export function collapseConversationsByPhone(list) {
    return collapseConversationsByPhoneDetailed(list).list;
}
export function canonicalizeInboxList(list) {
    const junkIds = [];
    const kept = [];
    for (const c of list) {
        if (isJunkInboxConversation(c) || isEmptyUnresolvedLidStub(c)) {
            junkIds.push(c.id);
            continue;
        }
        kept.push(sanitizeInboxConversationDisplay(c));
    }
    const collapsed = collapseConversationsByPhoneDetailed(kept);
    return {
        list: collapsed.list.map(sanitizeInboxConversationDisplay),
        aliases: collapsed.aliases,
        junkIds
    };
}
export function filterPgStubsShadowedByRam(ram, stubs) {
    const ramIds = new Set(ram.map((c) => c.id));
    const ramKeys = new Set();
    const ramUnresolvedTwins = new Set();
    for (const c of ram) {
        const keys = phoneKeysForConversation(c, true);
        for (const k of keys)
            ramKeys.add(k);
        if (keys.length === 0) {
            const tk = twinKeyForConversation(c);
            if (tk)
                ramUnresolvedTwins.add(`${c.connectionId || '_'}\u0002${tk}`);
        }
    }
    return stubs.filter((s) => {
        if (ramIds.has(s.id))
            return false;
        if (isJunkInboxConversation(s))
            return false;
        const keys = phoneKeysForConversation(s, true);
        if (keys.length === 0)
            return true;
        if (keys.some((k) => ramKeys.has(k)))
            return false;
        const tk = twinKeyForConversation(s);
        if (tk && ramUnresolvedTwins.has(`${s.connectionId || '_'}\u0002${tk}`))
            return false;
        return true;
    });
}
function digitsTail8(digits) {
    return digits.length >= 8 ? digits.slice(-8) : '';
}
export function findCanonicalConversationIdForPhone(list, connectionId, phoneDigits) {
    const target = normalizePhoneDigits(phoneDigits);
    if (target.length < 8)
        return null;
    const targetKeys = new Set(inboxMergeEquivalenceKeys(target));
    if (targetKeys.size === 0)
        targetKeys.add(target);
    const tail = digitsTail8(target);
    const matches = [];
    for (const c of list) {
        if ((c.connectionId || '') !== connectionId)
            continue;
        const jid = remoteJidFromConversationId(c.id);
        const lid = isLidJid(jid);
        if (tail && !lid) {
            const hay = `${c.id}${c.contactPhone || ''}${c.waJidAlt || ''}`.replace(/\D/g, '');
            if (!hay.includes(tail))
                continue;
        }
        const keys = phoneKeysForConversation(c, true);
        if (keys.some((k) => targetKeys.has(k)))
            matches.push(c);
    }
    if (matches.length === 0)
        return null;
    return [...matches].sort(compareConversationsForCanonicalId)[0]?.id ?? null;
}
export function resolveStableConversationId(list, selectedId) {
    if (!selectedId)
        return null;
    if (list.some((c) => c.id === selectedId))
        return selectedId;
    const selectedRank = conversationIdRank(selectedId);
    const tail = selectedId.includes(':') ? selectedId.slice(selectedId.indexOf(':') + 1) : selectedId;
    const digits = tail.split('@')[0]?.replace(/\D/g, '') || '';
    if (digits.length < 8)
        return null;
    const matches = list.filter((c) => conversationMatchesPhoneDigits(c, digits));
    if (matches.length === 0)
        return null;
    const sorted = [...matches].sort(compareConversationsForCanonicalId);
    const best = sorted[0]?.id ?? null;
    if (!best)
        return null;
    if (selectedRank > conversationIdRank(best))
        return null;
    return best;
}
export function upgradeStableConversationId(list, selectedId) {
    if (!selectedId || !list.some((c) => c.id === selectedId))
        return null;
    const rank = conversationIdRank(selectedId);
    if (rank >= 3)
        return null;
    const tail = selectedId.includes(':') ? selectedId.slice(selectedId.indexOf(':') + 1) : selectedId;
    const digits = tail.split('@')[0]?.replace(/\D/g, '') || '';
    const cp = list.find((c) => c.id === selectedId)?.contactPhone?.replace(/\D/g, '') || '';
    const lookupDigits = cp.length >= 8 ? cp : digits;
    if (lookupDigits.length < 8)
        return null;
    const matches = list.filter((c) => conversationMatchesPhoneDigits(c, lookupDigits));
    if (matches.length < 2)
        return null;
    const sorted = [...matches].sort(compareConversationsForCanonicalId);
    const best = sorted[0]?.id ?? null;
    if (!best || best === selectedId || conversationIdRank(best) <= rank)
        return null;
    return best;
}
