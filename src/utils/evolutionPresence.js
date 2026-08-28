const KNOWN = new Set([
    'available',
    'unavailable',
    'composing',
    'recording',
    'paused',
]);
/** Presença “ao vivo” expira se o webhook parar de atualizar (ex.: chip dormindo). */
export const WA_PRESENCE_LIVE_STALE_MS = 120_000;
export function coerceWaLastSeenMs(raw) {
    if (raw == null)
        return undefined;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0)
        return undefined;
    return n < 1e12 ? Math.floor(n * 1000) : Math.floor(n);
}
function parsePresenceValue(raw) {
    const s = String(raw || '').toLowerCase().trim();
    return KNOWN.has(s) ? s : null;
}
function readPresenceEntry(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const o = raw;
    const presence = parsePresenceValue(o.lastKnownPresence ?? o.presence);
    if (!presence)
        return null;
    const lastSeenMs = coerceWaLastSeenMs(o.lastSeen ?? o.lastSeenMs ?? o.last_seen);
    return lastSeenMs != null ? { presence, lastSeenMs } : { presence };
}
/**
 * Normaliza payload Evolution/Baileys:
 * `{ id, presences: { [jid]: { lastKnownPresence, lastSeen? } } }`
 */
export function parseEvolutionPresenceWebhook(data, eventDateIso) {
    if (!data || typeof data !== 'object')
        return null;
    const root = data;
    const presences = root.presences;
    const updatedAt = eventDateIso ? Date.parse(eventDateIso) : Date.now();
    const fallbackAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    const entries = [];
    if (presences && typeof presences === 'object' && !Array.isArray(presences)) {
        for (const [jid, val] of Object.entries(presences)) {
            const remoteJid = String(jid || '').trim();
            if (!remoteJid || remoteJid.endsWith('@g.us'))
                continue;
            const parsed = readPresenceEntry(val);
            if (!parsed)
                continue;
            entries.push({ remoteJid, presence: parsed.presence, lastSeenMs: parsed.lastSeenMs });
        }
    }
    const topId = String(root.id || '').trim();
    if (entries.length === 0 && topId && !topId.endsWith('@g.us')) {
        const parsed = readPresenceEntry(root);
        if (parsed)
            entries.push({ remoteJid: topId, presence: parsed.presence, lastSeenMs: parsed.lastSeenMs });
    }
    if (entries.length === 0)
        return null;
    return { entries, updatedAt: fallbackAt };
}
export function isWaPresenceLive(presence, updatedAtMs, nowMs = Date.now()) {
    if (!presence || presence === 'unavailable' || presence === 'paused')
        return false;
    if (!updatedAtMs || !Number.isFinite(updatedAtMs))
        return false;
    return nowMs - updatedAtMs < WA_PRESENCE_LIVE_STALE_MS;
}
function formatLastSeenPt(ms, nowMs = Date.now()) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime()))
        return '';
    const diff = Math.max(0, nowMs - ms);
    const min = Math.floor(diff / 60_000);
    if (min < 2)
        return 'visto por último agora há pouco';
    if (min < 60)
        return `visto por último há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24)
        return `visto por último há ${h} h`;
    const today = new Date(nowMs);
    const sameDay = d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.getFullYear() === yesterday.getFullYear() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getDate() === yesterday.getDate();
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (sameDay)
        return `visto por último hoje às ${time}`;
    if (isYesterday)
        return `visto por último ontem às ${time}`;
    const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `visto por último em ${date} às ${time}`;
}
/** Linha secundária do cabeçalho do chat (presença ou última vez online). */
export function formatContactPresenceSubtitle(conv, nowMs = Date.now()) {
    if (!conv)
        return '';
    const presence = conv.waPresence;
    const updatedAt = conv.waPresenceUpdatedAt;
    if (presence && isWaPresenceLive(presence, updatedAt, nowMs)) {
        if (presence === 'composing')
            return 'digitando…';
        if (presence === 'recording')
            return 'gravando áudio…';
        if (presence === 'available')
            return 'online';
    }
    if (presence === 'unavailable' || presence === 'paused' || !isWaPresenceLive(presence, updatedAt, nowMs)) {
        const seen = conv.waLastSeenMs;
        if (seen && Number.isFinite(seen))
            return formatLastSeenPt(seen, nowMs);
    }
    return '';
}
export function isContactPresenceOnline(conv, nowMs = Date.now()) {
    return conv?.waPresence === 'available' && isWaPresenceLive('available', conv.waPresenceUpdatedAt, nowMs);
}
