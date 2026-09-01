/** Envelope HTTP do Evolution Go — não é estado da sessão WhatsApp. */
const ENVELOPE_STATUSES = new Set(['success', 'ok', 'error', 'fail', 'failed', 'true', 'false']);

/** Evolution v2 / Go: sessão ativa. */
export function isEvolutionOpenState(raw: unknown): boolean {
    const state = String(raw || '').toLowerCase().trim();
    return (
        state === 'open' ||
        state === 'connected' ||
        state === 'online' ||
        state === 'available' ||
        state === 'loggedin' ||
        state === 'logged_in'
    );
}

function truthyFlag(v: unknown): boolean {
    return v === true || String(v).toLowerCase() === 'true';
}

/**
 * Detecta sessão conectada em payloads Go (camelCase e PascalCase do whatsmeow).
 */
export function goPayloadLooksConnected(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const row = raw as Record<string, unknown>;
    if (
        truthyFlag(row.connected) ||
        truthyFlag(row.Connected) ||
        truthyFlag(row.loggedIn) ||
        truthyFlag(row.LoggedIn) ||
        truthyFlag(row.logged_in) ||
        truthyFlag(row.online) ||
        truthyFlag(row.Online)
    ) {
        return true;
    }
    const state = String(
        row.state ??
            row.State ??
            row.connectionStatus ??
            row.ConnectionStatus ??
            row.status ??
            row.Status ??
            ''
    );
    if (ENVELOPE_STATUSES.has(state.toLowerCase().trim())) return false;
    return isEvolutionOpenState(state);
}

function pickSessionStateString(obj: Record<string, unknown>): string | null {
    for (const key of [
        'state',
        'State',
        'connectionStatus',
        'ConnectionStatus',
        'status',
        'Status',
    ] as const) {
        const v = obj[key];
        if (typeof v === 'string' && v.trim()) {
            const s = v.trim().toLowerCase();
            if (ENVELOPE_STATUSES.has(s)) continue;
            return v;
        }
    }
    return null;
}

/**
 * Extrai o estado da sessão de um payload Evolution API v2 ou Evolution Go.
 * Ignora envelopes (`status: "success"`) que não são o estado do chip.
 */
export function parseConnectionStatePayload(data: unknown): string {
    if (!data || typeof data !== 'object') return 'close';
    const row = data as Record<string, unknown>;
    if (goPayloadLooksConnected(row)) return 'open';

    const top = pickSessionStateString(row);
    if (top) return top;

    for (const nestKey of ['instance', 'data', 'Data'] as const) {
        const nested = row[nestKey];
        if (!nested || typeof nested !== 'object') continue;
        const n = nested as Record<string, unknown>;
        if (goPayloadLooksConnected(n)) return 'open';
        const picked = pickSessionStateString(n);
        if (picked) return picked;
    }
    return 'close';
}
