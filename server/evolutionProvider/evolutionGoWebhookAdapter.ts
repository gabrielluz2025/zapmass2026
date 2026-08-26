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

function normalizeGoEventData(eventName: string, data: unknown): unknown {
    if (!data || typeof data !== 'object') return data;
    const row = data as Record<string, unknown>;

    switch (eventName) {
        case 'Message':
        case 'SendMessage':
            return goMessageDataToEvolutionV2(row);
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
            return {
                state: row.status === 'open' || eventName === 'PairSuccess' ? 'open' : 'close',
                status: row.status ?? (eventName === 'PairSuccess' ? 'open' : 'close'),
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
