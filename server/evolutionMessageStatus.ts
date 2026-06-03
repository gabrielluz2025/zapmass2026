/**
 * Normaliza status de ACK da Evolution/Baileys (numérico ou string) para escala numérica.
 * Baileys: 2=SERVER_ACK, 3=DELIVERY_ACK, 4=READ, 5=PLAYED
 */
export function parseEvolutionMessageStatus(raw: unknown): number | null {
    if (raw == null) return null;
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
    if (typeof raw === 'string') {
        const s = raw.toUpperCase().trim();
        const map: Record<string, number> = {
            ERROR: -1,
            FAILED: -1,
            PENDING: 0,
            SERVER_ACK: 2,
            SERVER: 2,
            SENT: 2,
            DELIVERY_ACK: 3,
            DELIVERED: 3,
            DEVICE: 3,
            READ: 4,
            PLAYED: 5,
        };
        if (map[s] != null) return map[s];
        const n = Number(s);
        if (!Number.isNaN(n)) return n;
    }
    return null;
}

export function extractEvolutionMessageUpdates(
    data: unknown
): Array<{ messageId: string; status: unknown }> {
    const updates = Array.isArray(data) ? data : data ? [data] : [];
    const out: Array<{ messageId: string; status: unknown }> = [];
    for (const upd of updates) {
        if (!upd || typeof upd !== 'object') continue;
        const u = upd as Record<string, unknown>;
        const key = (u.key as Record<string, unknown>) || {};
        const messageId = key.id ?? u.keyId ?? u.id;
        const updateObj = u.update as Record<string, unknown> | undefined;
        const status =
            updateObj?.status ??
            u.status ??
            updateObj?.ack ??
            u.ack;
        if (messageId != null && status != null) {
            out.push({ messageId: String(messageId), status });
        }
    }
    return out;
}
