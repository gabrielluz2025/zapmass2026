import type { InternalAxiosRequestConfig } from 'axios';
import { evolutionEngineConfig } from '../evolutionEngineConfig.js';

export type InstanceTokenStore = {
    getToken: (instanceId: string) => string | undefined;
    ensureToken: (instanceId: string) => string;
};

/** Extrai instanceId do path estilo Evolution API v2 (/recurso/{instanceId}). */
export function extractInstanceIdFromApiPath(url: string): string | undefined {
    const path = String(url || '').split('?')[0];
    const m = path.match(
        /\/(?:connect|connectionState|restart|logout|delete|sendText|sendMedia|findChats|findMessages|findContacts|fetchProfile|fetchProfilePictureUrl|whatsappNumbers|sendPresence|markMessageAsRead|getBase64FromMediaMessage|saveContact|save-contact|webhook\/set|settings\/set|proxy\/set)\/([^/]+)$/i
    );
    return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

export type GoAdaptResult = {
    url: string;
    data?: unknown;
    headers: Record<string, string>;
    methodOverride?: string;
    syntheticResponse?: { status: number; data: unknown };
};

function adminHeaders(globalKey: string): Record<string, string> {
    return { apikey: globalKey, 'Content-Type': 'application/json' };
}

function instanceHeaders(instanceToken: string): Record<string, string> {
    return { apikey: instanceToken, 'Content-Type': 'application/json' };
}

/** Traduz request Evolution API v2 → Evolution Go. */
export function adaptEvolutionApiRequestToGo(
    config: InternalAxiosRequestConfig,
    tokenStore: InstanceTokenStore
): GoAdaptResult {
    const globalKey = evolutionEngineConfig.go.globalKey;
    const method = String(config.method || 'get').toUpperCase();
    const url = String(config.url || '');
    const data = config.data;
    const instanceId = extractInstanceIdFromApiPath(url);

    if (method === 'GET' && url === '/instance/fetchInstances') {
        return { url: '/instance/all', headers: adminHeaders(globalKey) };
    }

    if (method === 'POST' && url === '/instance/create') {
        const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const name = String(body.instanceName || body.name || '').trim();
        const token = tokenStore.ensureToken(name);
        return {
            url: '/instance/create',
            data: {
                name,
                token,
                webhook: evolutionEngineConfig.webhookUrl,
            },
            headers: adminHeaders(globalKey),
        };
    }

    if (method === 'DELETE' && instanceId && url.includes('/instance/delete/')) {
        return {
            url: `/instance/delete/${encodeURIComponent(instanceId)}`,
            headers: adminHeaders(globalKey),
        };
    }

    if (method === 'POST' && instanceId && (url.includes('/instance/proxy/') || url.includes('/proxy/set/'))) {
        const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        if (body.enabled === false) {
            return {
                url: `/instance/proxy/${encodeURIComponent(instanceId)}`,
                methodOverride: 'DELETE',
                headers: adminHeaders(globalKey),
            };
        }
        return {
            url: `/instance/proxy/${encodeURIComponent(instanceId)}`,
            data: {
                host: body.host,
                port: body.port,
                username: body.username || '',
                password: body.password || '',
                protocol: body.protocol || 'http',
            },
            headers: adminHeaders(globalKey),
        };
    }

    if (!instanceId) {
        return { url, headers: adminHeaders(globalKey), data };
    }

    const token = tokenStore.getToken(instanceId) || tokenStore.ensureToken(instanceId);
    const instH = instanceHeaders(token);

    if (url.includes('/instance/connectionState/')) {
        return { url: '/instance/status', headers: instH };
    }

    if (url.includes('/instance/connect/')) {
        return { url: '/instance/qr', headers: instH };
    }

    if (url.includes('/instance/restart/')) {
        return { url: '/instance/reconnect', methodOverride: 'POST', headers: instH, data: {} };
    }

    if (url.includes('/instance/logout/')) {
        return { url: '/instance/logout', headers: instH };
    }

    if (url.includes('/message/sendText/')) {
        const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const text =
            (body.textMessage as { text?: string } | undefined)?.text ||
            String(body.text || body.message || '');
        return {
            url: '/send/text',
            data: { number: body.number, text, delay: body.delay ?? 1200 },
            headers: instH,
        };
    }

    if (url.includes('/message/sendMedia/')) {
        return { url: '/send/media', data, headers: instH };
    }

    if (url.includes('/chat/sendPresence/')) {
        return { url: '/message/presence', data, headers: instH };
    }

    if (url.includes('/chat/whatsappNumbers/')) {
        const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const numbers = Array.isArray(body.numbers) ? body.numbers : [];
        return { url: '/user/check', data: { numbers }, headers: instH };
    }

    if (url.includes('/chat/markMessageAsRead/')) {
        return { url: '/message/markread', data, headers: instH };
    }

    if (url.includes('/chat/getBase64FromMediaMessage/')) {
        return { url: '/message/downloadmedia', data, headers: instH };
    }

    if (url.includes('/chat/findContacts/')) {
        return { url: '/user/contacts', headers: instH };
    }

    if (url.includes('/chat/fetchProfilePictureUrl/')) {
        return { url: '/user/avatar', data, headers: instH };
    }

    if (url.includes('/chat/fetchProfile/')) {
        return { url: '/user/info', data, headers: instH };
    }

    if (url.includes('/chat/findChats/') || url.includes('/chat/findMessages/')) {
        return {
            url,
            headers: instH,
            syntheticResponse: { status: 200, data: [] },
        };
    }

    if (url.includes('/webhook/set/')) {
        return {
            url,
            headers: instH,
            syntheticResponse: { status: 200, data: { ok: true, skipped: 'go_webhook_on_create' } },
        };
    }

    if (url.includes('/settings/set/')) {
        const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        return {
            url: `/instance/${encodeURIComponent(instanceId)}/advanced-settings`,
            methodOverride: 'PUT',
            data: body,
            headers: adminHeaders(globalKey),
        };
    }

    if (url.includes('/contact/') || url.includes('saveContact') || url.includes('save-contact')) {
        return {
            url,
            headers: instH,
            syntheticResponse: { status: 200, data: { ok: true, skipped: 'go_save_contact_unsupported' } },
        };
    }

    return { url, data, headers: instH };
}

/** Normaliza respostas Go → formato Evolution API v2. */
export function normalizeGoResponseToApiV2(url: string, data: unknown): unknown {
    if (data == null) return data;
    const path = String(url || '');

    if (path.includes('/instance/all')) {
        const wrapped = data as { data?: unknown[] };
        const list = Array.isArray(wrapped?.data) ? wrapped.data : Array.isArray(data) ? data : [];
        return list.map((row: Record<string, unknown>) => ({
            instance: {
                instanceName: row.name || row.id,
                owner: row.owner || row.jid,
                status: row.connected ? 'open' : 'close',
            },
        }));
    }

    if (path.includes('/instance/status')) {
        const wrapped = data as { data?: Record<string, unknown> };
        const st = wrapped?.data || (data as Record<string, unknown>);
        const connected = st?.connected === true || st?.state === 'open' || st?.status === 'open';
        return { instance: { state: connected ? 'open' : 'close', statusReason: st?.statusReason } };
    }

    if (path.includes('/instance/qr')) {
        const wrapped = data as { data?: Record<string, unknown> };
        const qr = wrapped?.data || data;
        const code =
            (qr as Record<string, unknown>)?.code ||
            (qr as Record<string, unknown>)?.qrcode ||
            (qr as Record<string, unknown>)?.base64;
        return { qrcode: { base64: code }, base64: code };
    }

    if (path.includes('/user/check')) {
        const wrapped = data as { data?: unknown[] };
        const rows = Array.isArray(wrapped?.data) ? wrapped.data : [];
        return rows.map((r: Record<string, unknown>) => ({
            jid: r.jid,
            exists: r.exists !== false,
            number: r.number || r.jid,
        }));
    }

    if (path.includes('/send/text') || path.includes('/send/media')) {
        const wrapped = data as { data?: Record<string, unknown> };
        const inner = wrapped?.data || (data as Record<string, unknown>);
        return {
            key: { id: inner?.id || inner?.messageId },
            messageId: inner?.id || inner?.messageId,
            status: inner?.status || 'PENDING',
        };
    }

    return data;
}
