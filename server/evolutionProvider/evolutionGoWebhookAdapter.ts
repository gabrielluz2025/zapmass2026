/**
 * Normaliza webhooks Evolution Go (PascalCase / instanceId) → formato Evolution API v2.
 */

export type GoWebhookLookup = (hint: {
    instanceId?: string;
    instanceToken?: string;
}) => string | undefined;

const GO_EVENT_MAP: Record<string, string> = {
    Message: 'MESSAGES_UPSERT',
    SendMessage: 'MESSAGES_UPSERT',
    HistorySync: 'MESSAGES_UPSERT',
    QRCode: 'QRCODE_UPDATED',
    QRSuccess: 'QRCODE_UPDATED',
    Connected: 'CONNECTION_UPDATE',
    PairSuccess: 'CONNECTION_UPDATE',
    LoggedOut: 'CONNECTION_UPDATE',
    OfflineSyncCompleted: 'CONNECTION_UPDATE',
    Receipt: 'MESSAGES_UPDATE',
};

function isLikelyGoWebhook(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const row = raw as Record<string, unknown>;
    if (row.instanceId || row.instanceToken) return true;
    const ev = String(row.event || '').trim();
    if (!ev) return false;
    return Boolean(GO_EVENT_MAP[ev] || ev === 'OfflineSyncCompleted');
}

function parseGoTimestamp(ts: unknown): number | undefined {
    if (typeof ts === 'number' && Number.isFinite(ts)) {
        return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
    }
    if (typeof ts === 'string' && ts.trim()) {
        const ms = Date.parse(ts);
        if (Number.isFinite(ms)) return Math.floor(ms / 1000);
    }
    return undefined;
}

function goMessageDataToEvolutionV2(data: Record<string, unknown>): Record<string, unknown> {
    const info = (data.Info && typeof data.Info === 'object' ? data.Info : {}) as Record<string, unknown>;
    const message = (data.Message && typeof data.Message === 'object' ? data.Message : {}) as Record<
        string,
        unknown
    >;
    return {
        key: {
            remoteJid: info.Chat,
            fromMe: info.IsFromMe === true,
            id: info.ID,
            remoteJidAlt: info.SenderAlt,
            senderPn: info.Sender,
            participant: info.IsGroup ? info.Sender : undefined,
        },
        message,
        pushName: info.PushName,
        messageTimestamp: parseGoTimestamp(info.Timestamp),
    };
}

/** WebMessageInfo (history sync / Baileys) → formato Evolution API v2. */
function webMessageInfoToEvolutionV2(
    raw: Record<string, unknown>,
    chatJidFallback?: string
): Record<string, unknown> | null {
    const key = (raw.key && typeof raw.key === 'object' ? raw.key : {}) as Record<string, unknown>;
    const message = (raw.message && typeof raw.message === 'object' ? raw.message : {}) as Record<
        string,
        unknown
    >;
    const id = key.id ?? raw.id;
    const remoteJid = key.remoteJid ?? chatJidFallback;
    if (!id || !remoteJid) return null;
    return {
        key: {
            remoteJid,
            fromMe: key.fromMe === true,
            id,
            remoteJidAlt: key.remoteJidAlt ?? key.participant,
            senderPn: key.senderPn ?? key.participant,
            participant: key.participant,
        },
        message,
        pushName: raw.pushName,
        messageTimestamp:
            parseGoTimestamp(raw.messageTimestamp) ??
            parseGoTimestamp(raw.timestamp) ??
            parseGoTimestamp(raw.Timestamp),
    };
}

function goHistoryItemToEvolutionV2(item: unknown, chatJidFallback?: string): Record<string, unknown> | null {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (row.Info && row.Message) return goMessageDataToEvolutionV2(row);
    if (row.key) return webMessageInfoToEvolutionV2(row, chatJidFallback);
    const nested = row.message ?? row.Message;
    if (nested && typeof nested === 'object') {
        const n = nested as Record<string, unknown>;
        if (n.Info && n.Message) return goMessageDataToEvolutionV2(n);
        if (n.key) return webMessageInfoToEvolutionV2(n, chatJidFallback);
    }
    return null;
}

/** Extrai lote de mensagens do webhook HistorySync (vários formatos whatsmeow/Go). */
function extractGoHistorySyncMessages(data: unknown): Record<string, unknown>[] {
    if (!data || typeof data !== 'object') return [];
    const row = data as Record<string, unknown>;

    if (row.Info && row.Message) {
        const one = goMessageDataToEvolutionV2(row);
        const key = one.key as { id?: unknown } | undefined;
        return key?.id ? [one] : [];
    }

    for (const key of ['Messages', 'messages'] as const) {
        const arr = row[key];
        if (Array.isArray(arr) && arr.length > 0) {
            const out = arr
                .map((item) => goHistoryItemToEvolutionV2(item))
                .filter((m): m is Record<string, unknown> => Boolean(m));
            if (out.length > 0) return out;
        }
    }

    for (const key of ['Conversations', 'conversations'] as const) {
        const convs = row[key];
        if (!Array.isArray(convs)) continue;
        const out: Record<string, unknown>[] = [];
        for (const conv of convs) {
            if (!conv || typeof conv !== 'object') continue;
            const c = conv as Record<string, unknown>;
            const chatJid = String(c.ID ?? c.id ?? c.JID ?? c.jid ?? '').trim() || undefined;
            const msgs = c.Messages ?? c.messages;
            if (!Array.isArray(msgs)) continue;
            for (const item of msgs) {
                const parsed = goHistoryItemToEvolutionV2(item, chatJid);
                if (parsed) out.push(parsed);
            }
        }
        if (out.length > 0) return out;
    }

    if (row.Data && typeof row.Data === 'object') {
        return extractGoHistorySyncMessages(row.Data);
    }

    return [];
}

function normalizeGoEventData(eventName: string, data: unknown): unknown {
    if (!data || typeof data !== 'object') return data;
    const row = data as Record<string, unknown>;

    switch (eventName) {
        case 'Message':
        case 'SendMessage':
            return goMessageDataToEvolutionV2(row);
        case 'HistorySync': {
            const messages = extractGoHistorySyncMessages(row);
            if (messages.length === 0) return row;
            return { messages };
        }
        case 'QRCode':
        case 'QRSuccess':
            return {
                qrcode: {
                    base64: row.qrcode ?? row.base64,
                    code: row.code,
                },
            };
        case 'Connected':
        case 'PairSuccess':
            // Ambos os eventos significam que o chip ESTÁ conectado — sempre 'open'.
            // Antes: row.status !== 'open' mapeava Connected → 'close', causando reconnect loop.
            return {
                state: 'open',
                status: 'open',
                instance: { state: 'open' },
                jid: row.jid ?? row.ID,
                owner: row.jid ?? row.ID,
                pushName: row.pushName,
            };
        case 'OfflineSyncCompleted':
            return {
                state: 'open',
                status: 'open',
                instance: { state: 'open' },
                jid: row.jid ?? row.ID,
                owner: row.jid ?? row.ID,
                pushName: row.pushName,
            };
        case 'LoggedOut':
            return {
                state: 'close',
                status: 'close',
                statusReason: row.Reason ?? row.reason ?? 'loggedOut',
                instance: { state: 'close', statusReason: row.Reason ?? row.reason ?? 'loggedOut' },
            };
        case 'Receipt':
            return row;
        default:
            return data;
    }
}

/** Converte payload Go → evento Evolution API v2 (pass-through se já for v2). */
export function normalizeEvolutionGoWebhookIfNeeded(
    raw: unknown,
    resolveConnectionId: GoWebhookLookup
): unknown {
    if (!isLikelyGoWebhook(raw)) return raw;
    const row = raw as Record<string, unknown>;
    const goEvent = String(row.event || '').trim();
    const mapped = GO_EVENT_MAP[goEvent];
    if (!mapped) return raw;

    const connectionId =
        resolveConnectionId({
            instanceId: typeof row.instanceId === 'string' ? row.instanceId : undefined,
            instanceToken: typeof row.instanceToken === 'string' ? row.instanceToken : undefined,
        }) ||
        (typeof row.instance === 'string' ? row.instance.trim() : '') ||
        '';

    const data = normalizeGoEventData(goEvent, row.data ?? row);

    return {
        event: mapped,
        instance: connectionId,
        instanceName: connectionId,
        data,
        date_time: row.date_time,
        sender: row.sender,
    };
}
