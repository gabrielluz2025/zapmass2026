/** Cruzamento telefone ↔ agenda ZapMass (BR: 55, 9º dígito, sufixos). */
export function normalizePhoneDigits(raw) {
    return String(raw || '').replace(/\D/g, '');
}
export function buildPhoneDigitLookupKeys(digits) {
    const set = new Set();
    const pushBrMobileVariants = (x) => {
        if (x.length < 8)
            return;
        set.add(x);
        if (x.startsWith('55') && x.length >= 12) {
            const nat = x.slice(2);
            if (nat.length === 10) {
                const ddd = nat.slice(0, 2);
                const sub = nat.slice(2);
                if (sub.length === 8)
                    set.add(`55${ddd}9${sub}`);
            }
            else if (nat.length === 11) {
                const ddd = nat.slice(0, 2);
                const sub = nat.slice(2);
                if (sub.startsWith('9') && sub.length === 9)
                    set.add(`55${ddd}${sub.slice(1)}`);
            }
        }
        if (!x.startsWith('55')) {
            if (x.length === 10) {
                const ddd = x.slice(0, 2);
                const sub = x.slice(2);
                if (sub.length === 8) {
                    set.add(`${ddd}9${sub}`);
                    set.add(`55${ddd}9${sub}`);
                    set.add(`55${ddd}${sub}`);
                }
            }
            else if (x.length === 11) {
                const ddd = x.slice(0, 2);
                const sub = x.slice(2);
                if (sub.startsWith('9') && sub.length === 9) {
                    set.add(`${ddd}${sub.slice(1)}`);
                    set.add(`55${ddd}${sub.slice(1)}`);
                    set.add(`55${ddd}${sub}`);
                }
            }
        }
    };
    const addCore = (raw) => {
        const d = normalizePhoneDigits(raw);
        if (!d || d.length < 8)
            return;
        pushBrMobileVariants(d);
        if (d.length >= 10)
            pushBrMobileVariants(d.slice(-10));
        if (d.length >= 11)
            pushBrMobileVariants(d.slice(-11));
        if (d.startsWith('55') && d.length >= 12) {
            const noCc = d.slice(2);
            pushBrMobileVariants(noCc);
            if (noCc.length >= 10)
                pushBrMobileVariants(noCc.slice(-10));
            if (noCc.length >= 11)
                pushBrMobileVariants(noCc.slice(-11));
        }
        if (d.length > 11) {
            for (let len = 9; len <= 13 && len < d.length; len++) {
                pushBrMobileVariants(d.slice(-len));
            }
        }
    };
    const d = normalizePhoneDigits(digits);
    if (!d)
        return [];
    addCore(d);
    return Array.from(set);
}
export function buildCrmNameIndex(contacts) {
    const map = new Map();
    for (const ct of contacts) {
        const name = String(ct.name || '').trim();
        const phone = String(ct.phone || '').trim();
        const digits = normalizePhoneDigits(phone);
        if (!name || digits.length < 8)
            continue;
        for (const key of buildPhoneDigitLookupKeys(digits)) {
            if (!map.has(key))
                map.set(key, name);
        }
    }
    return map;
}
export function resolveCrmNameFromIndex(index, ...phoneCandidates) {
    for (const raw of phoneCandidates) {
        const digits = normalizePhoneDigits(raw);
        if (!digits || digits.length < 8)
            continue;
        for (const key of buildPhoneDigitLookupKeys(digits)) {
            const hit = index.get(key);
            if (hit)
                return hit;
        }
    }
    return undefined;
}
export function isGenericWaContactLabel(name) {
    const lower = String(name || '').trim().toLowerCase();
    return !lower || lower === 'contato' || lower === 'contact' || lower === 'unknown' || lower === 'desconhecido';
}
export function looksLikeLongLidDigits(name) {
    const d = normalizePhoneDigits(name);
    return d.length >= 14 && /^\d+$/.test(d);
}
export function looksLikeDigitsOnlyPhoneLabel(raw) {
    const t = String(raw || '').trim().replace(/\u00a0/g, ' ');
    if (!t)
        return true;
    return /^[+()\d\s.\-]+$/.test(t) && /\d{7,}/.test(t.replace(/\D/g, ''));
}
/** Telefones candidatos para cruzar conversa WhatsApp ↔ CRM. */
export function phoneCandidatesFromConversation(conv) {
    const out = [];
    const push = (s) => {
        const t = s.trim();
        if (t && !out.includes(t))
            out.push(t);
    };
    push(conv.contactPhone || '');
    const altRaw = String(conv.waJidAlt || '').trim();
    if (altRaw) {
        const altUser = altRaw.split('@')[0] || '';
        if (altUser && !altRaw.toLowerCase().endsWith('@lid'))
            push(altUser);
    }
    const idPart = conv.id?.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : conv.id || '';
    const fromJid = idPart.split('@')[0] || '';
    if (fromJid && !idPart.toLowerCase().endsWith('@lid'))
        push(fromJid);
    const stored = String(conv.waContactName || conv.contactName || '').trim();
    const storedDigits = normalizePhoneDigits(stored);
    if (storedDigits.length >= 10 &&
        storedDigits.length <= 13 &&
        !looksLikeLongLidDigits(stored)) {
        push(`+${storedDigits}`);
    }
    return out;
}
/** Prioridade: CRM > nome WA legível > anterior > fallback. */
export function pickContactDisplayName(opts) {
    const crm = String(opts.crmName || '').trim();
    if (crm)
        return crm;
    const wa = String(opts.waName || '').trim();
    const waOk = wa && !isGenericWaContactLabel(wa) && !looksLikeLongLidDigits(wa) ? wa : '';
    const prev = String(opts.previous || '').trim();
    const prevOk = prev && !isGenericWaContactLabel(prev) && !looksLikeLongLidDigits(prev) ? prev : '';
    if (waOk && prevOk) {
        if (/^\d{10,}$/.test(normalizePhoneDigits(waOk)) && !/^\d{10,}$/.test(normalizePhoneDigits(prevOk))) {
            return prevOk;
        }
        if (!/^\d{10,}$/.test(normalizePhoneDigits(waOk)) && /^\d{10,}$/.test(normalizePhoneDigits(prevOk))) {
            return waOk;
        }
        return prevOk;
    }
    return waOk || prevOk || String(opts.fallback || '').trim() || 'Contato';
}
