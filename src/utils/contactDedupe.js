import { isSuspiciousContactName } from './contactNameNormalize';
function filled(v) {
    return String(v ?? '').trim().length > 0;
}
function pickFilled(keeper, others) {
    if (filled(keeper))
        return keeper;
    for (const o of others) {
        if (filled(o))
            return o;
    }
    return keeper;
}
/** Pontua o cadastro mais completo para permanecer como linha única na base. */
export function contactDedupeRichness(c) {
    let score = 0;
    const name = String(c.name || '').trim();
    if (name && !isSuspiciousContactName(name))
        score += 120;
    else
        score += Math.min(name.length, 15);
    if (c.status === 'VALID')
        score += 12;
    if (filled(c.city))
        score += 6;
    if (filled(c.street))
        score += 6;
    if (filled(c.neighborhood))
        score += 3;
    if (filled(c.zipCode))
        score += 3;
    if (filled(c.birthday))
        score += 8;
    if (filled(c.email))
        score += 4;
    if (filled(c.notes))
        score += 3;
    if (filled(c.followUpAt))
        score += 4;
    if (filled(c.profilePicUrl))
        score += 6;
    if (c.religiousMemberProfile)
        score += 8;
    score += Math.min((c.tags || []).length, 10);
    score += Math.min(Number(c.campaignMessagesReceived) || 0, 20);
    return score;
}
export function pickDuplicateKeeper(group) {
    if (group.length === 0)
        throw new Error('Grupo de duplicados vazio.');
    return [...group].sort((a, b) => {
        const d = contactDedupeRichness(b) - contactDedupeRichness(a);
        if (d !== 0)
            return d;
        return String(a.id).localeCompare(String(b.id));
    })[0];
}
function mergeNotes(keeper, others) {
    const parts = [];
    const seen = new Set();
    for (const n of [keeper, ...others]) {
        const t = String(n || '').trim();
        if (!t)
            continue;
        const key = t.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        parts.push(t);
    }
    if (parts.length === 0)
        return keeper;
    return parts.join('\n');
}
/**
 * Une várias linhas do mesmo número numa só.
 * O número continua podendo aparecer em várias listas — só some a linha extra da base.
 */
export function mergeDuplicateGroup(group, canonicalPhone) {
    const keeper = pickDuplicateKeeper(group);
    const extras = group.filter((c) => c.id !== keeper.id);
    const extraIds = extras.map((c) => c.id);
    const others = extras;
    const betterName = extras.find((c) => !isSuspiciousContactName(c.name || ''))?.name;
    const name = !isSuspiciousContactName(keeper.name || '') || !betterName ? keeper.name : betterName;
    const tags = [...new Set([...(keeper.tags || []), ...others.flatMap((c) => c.tags || [])])].filter(Boolean);
    const aliasContactIds = [
        ...new Set([
            ...(keeper.aliasContactIds || []),
            ...extraIds,
            ...others.flatMap((c) => c.aliasContactIds || [])
        ].filter((id) => id && id !== keeper.id))
    ];
    const campaignMessagesReceived = Math.max(0, ...group.map((c) => Number(c.campaignMessagesReceived) || 0));
    const followUps = group.map((c) => c.followUpAt).filter(filled);
    const followUpAt = followUps.sort()[0] || keeper.followUpAt;
    const updates = {
        name,
        phone: canonicalPhone,
        tags,
        aliasContactIds,
        status: group.some((c) => c.status === 'VALID') ? 'VALID' : 'INVALID'
    };
    const optional = [
        ['city', pickFilled(keeper.city, others.map((c) => c.city))],
        ['state', pickFilled(keeper.state, others.map((c) => c.state))],
        ['street', pickFilled(keeper.street, others.map((c) => c.street))],
        ['number', pickFilled(keeper.number, others.map((c) => c.number))],
        ['neighborhood', pickFilled(keeper.neighborhood, others.map((c) => c.neighborhood))],
        ['zipCode', pickFilled(keeper.zipCode, others.map((c) => c.zipCode))],
        ['birthday', pickFilled(keeper.birthday, others.map((c) => c.birthday))],
        ['email', pickFilled(keeper.email, others.map((c) => c.email))],
        ['notes', mergeNotes(keeper.notes, others.map((c) => c.notes))],
        ['church', pickFilled(keeper.church, others.map((c) => c.church))],
        ['role', pickFilled(keeper.role, others.map((c) => c.role))],
        ['profession', pickFilled(keeper.profession, others.map((c) => c.profession))],
        ['followUpAt', followUpAt],
        ['followUpNote', pickFilled(keeper.followUpNote, others.map((c) => c.followUpNote))],
        ['profilePicUrl', pickFilled(keeper.profilePicUrl, others.map((c) => c.profilePicUrl))]
    ];
    for (const [key, value] of optional) {
        if (value)
            updates[key] = value;
    }
    const religious = keeper.religiousMemberProfile || others.find((c) => c.religiousMemberProfile)?.religiousMemberProfile;
    if (religious)
        updates.religiousMemberProfile = religious;
    if (group.some((c) => c.marketingOptOut))
        updates.marketingOptOut = true;
    if (group.some((c) => c.marketingOptIn))
        updates.marketingOptIn = true;
    if (campaignMessagesReceived > 0)
        updates.campaignMessagesReceived = campaignMessagesReceived;
    return { keeper, extraIds, updates };
}
/** Troca IDs extras pelo keeper e remove repetição na mesma lista. */
export function remapListContactIds(ids, idMap) {
    const seen = new Set();
    const out = [];
    let changed = false;
    for (const raw of ids) {
        const mapped = idMap.get(String(raw)) || String(raw);
        if (mapped !== String(raw))
            changed = true;
        if (seen.has(mapped)) {
            changed = true;
            continue;
        }
        seen.add(mapped);
        out.push(mapped);
    }
    return { ids: out, changed };
}
