import type { InternalAxiosRequestConfig } from 'axios';
import { evolutionEngineConfig } from '../evolutionEngineConfig.js';
import { goPayloadLooksConnected } from '../evolutionOpenState.js';
import { pickGoInstanceUuid } from './goUuid.js';

export type InstanceTokenStore = {
    getToken: (instanceId: string) => string | undefined;
    ensureToken: (instanceId: string) => string;
    /** UUID da instância no Evolution Go (header instanceId). */
    getGoInstanceUuid?: (connectionId: string) => string | undefined;
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

/** UUID Go para header/path. Nunca devolve `conn_*` — o Go rejeita com invalid UUID length: 20. */
function goUuidForConnection(tokenStore: InstanceTokenStore, connectionId: string): string | undefined {
    return pickGoInstanceUuid(tokenStore.getGoInstanceUuid?.(connectionId), connectionId);
}

const MISSING_GO_UUID_SYNTHETIC = {
    error: 'missing-go-uuid',
    message:
        'O Evolution não reconheceu o identificador deste canal. Atualize a página; se o chip estiver Online, o disparo continua valendo.',
};

function evolutionWebhookUrlForGo(): string {
    let url = evolutionEngineConfig.webhookUrl;
    const tok = evolutionEngineConfig.webhookToken?.trim();
    if (tok) {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}token=${encodeURIComponent(tok)}`;
    }
    return url;
}

function pickGoDownloadMediaBody(data: unknown): Record<string, unknown> | undefined {
    const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const msg = body.message;
    if (!msg || typeof msg !== 'object') return undefined;
    const record = msg as Record<string, unknown>;
    const inner = record.message;
    if (inner && typeof inner === 'object') {
        return { message: inner };
    }
    const mediaKeys = [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'pttMessage',
        'documentMessage',
        'stickerMessage',
    ];
    for (const key of mediaKeys) {
        if (record[key]) return { message: { [key]: record[key] } };
    }
    return undefined;
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
                webhook: evolutionWebhookUrlForGo(),
            },
            headers: adminHeaders(globalKey),
        };
    }

    if (method === 'DELETE' && instanceId && url.includes('/instance/delete/')) {
        const goUuid = goUuidForConnection(tokenStore, instanceId);
        if (!goUuid) {
            return {
                url: '/instance/delete/skipped',
                headers: adminHeaders(globalKey),
                syntheticResponse: { status: 404, data: { error: 'instance not found' } },
            };
        }
        return {
            url: `/instance/delete/${encodeURIComponent(goUuid)}`,
            headers: adminHeaders(globalKey),
        };
    }

    if (method === 'DELETE' && instanceId && url.includes('/instance/logout/')) {
        const token = tokenStore.getToken(instanceId) || tokenStore.ensureToken(instanceId);
        return { url: '/instance/logout', headers: instanceHeaders(token) };
    }

    if (method === 'POST' && instanceId && (url.includes('/instance/proxy/') || url.includes('/proxy/set/'))) {
        const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const goUuid = goUuidForConnection(tokenStore, instanceId);
        if (!goUuid) {
            return {
                url: '/instance/proxy/skipped',
                headers: adminHeaders(globalKey),
                syntheticResponse: { status: 400, data: MISSING_GO_UUID_SYNTHETIC },
            };
        }
        if (body.enabled === false) {
            return {
                url: `/instance/proxy/${encodeURIComponent(goUuid)}`,
                methodOverride: 'DELETE',
                headers: adminHeaders(globalKey),
            };
        }
        return {
            url: `/instance/proxy/${encodeURIComponent(goUuid)}`,
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

    if (url.includes('/instance/connect/')) {
        const goUuid = goUuidForConnection(tokenStore, instanceId!);
        if (method === 'POST') {
            if (!goUuid) {
                return {
                    url: '/instance/connect',
                    headers: instH,
                    syntheticResponse: { status: 400, data: MISSING_GO_UUID_SYNTHETIC },
                };
            }
            const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
            // immediate:true força reconexão WhatsApp imediata. Usar apenas em connect explícito
            // (novo canal / Forçar QR). Re-registro de webhook no boot NÃO deve forçar reconnect
            // pois gera tempestade sob muitos chips e pode crashar o Evolution Go.
            const shouldReconnect = body.forceReconnect === true;
            return {
                url: '/instance/connect',
                data: {
                    webhookUrl: evolutionWebhookUrlForGo(),
                    subscribe: ['ALL'],
                    immediate: shouldReconnect,
                },
                // Go exige apikey = token da instância (global key → not authorized).
                headers: { ...instH, instanceId: goUuid },
            };
        }
        return { url: '/instance/qr', headers: instH };
    }

    if (url.includes('/instance/connectionState/')) {
        return { url: '/instance/status', headers: instH };
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
        // Traduz campos Evolution API v2 → Evolution Go
        const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const mediaUrl = body.media || body.url || body.mediaUrl;
        const base64 = body.base64 || body.mediaBase64;
        const goMedia: Record<string, unknown> = {
            number: body.number,
            caption: body.caption ?? '',
            // Evolution Go aceita mediaType (camelCase) OU mediatype (lowercase)
            mediaType: body.mediatype || body.mediaType || 'image',
            mimeType: body.mimetype || body.mimeType || 'application/octet-stream',
            fileName: body.fileName || body.filename || '',
        };
        if (typeof mediaUrl === 'string' && mediaUrl.startsWith('http')) {
            goMedia.url = mediaUrl;
        } else if (typeof base64 === 'string' && base64.length > 0) {
            goMedia.base64 = base64;
        } else if (typeof mediaUrl === 'string' && mediaUrl.length > 0) {
            // Pode ser base64 direto no campo media
            goMedia.base64 = mediaUrl;
        }
        return { url: '/send/media', data: goMedia, headers: instH };
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
        const goBody = pickGoDownloadMediaBody(data);
        return {
            url: '/message/downloadmedia',
            data: goBody ?? data,
            headers: instH,
        };
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

/** Código de pareamento WhatsApp (ex.: `2@abc,...`) — não é PNG base64. */
export function looksLikeWhatsAppPairingCode(value: string): boolean {
    const t = value.trim();
    if (!t || t.startsWith('data:image/')) return false;
    if (/^\d+@/.test(t)) return true;
    return t.includes('@') && t.length < 512 && !/^[A-Za-z0-9+/=\s]{80,}$/.test(t);
}

export function looksLikeBase64Image(value: string): boolean {
    const t = value.trim();
    if (!t) return false;
    if (t.startsWith('data:image/')) return true;
    if (looksLikeWhatsAppPairingCode(t)) return false;
    const compact = t.replace(/\s/g, '');
    return compact.length >= 80 && /^[A-Za-z0-9+/=]+$/.test(compact);
}

/** Separa imagem QR (base64) de código de pareamento nas respostas Go. */
export function parseGoQrPayload(source: unknown): { imageBase64?: string; pairingCode?: string } {
    if (!source || typeof source !== 'object') return {};
    const qr = source as Record<string, unknown>;
    const codeRaw = typeof qr.code === 'string' ? qr.code.trim() : '';
    const imageCandidate = [qr.base64, qr.qrcode, qr.image].find(
        (v) => typeof v === 'string' && String(v).trim()
    ) as string | undefined;

    let imageBase64: string | undefined;
    if (imageCandidate && looksLikeBase64Image(imageCandidate)) {
        const t = imageCandidate.trim();
        imageBase64 = t.startsWith('data:image/') ? t : `data:image/png;base64,${t}`;
    }

    let pairingCode: string | undefined;
    if (codeRaw) {
        if (looksLikeWhatsAppPairingCode(codeRaw) || !imageBase64) {
            pairingCode = codeRaw;
        }
    } else if (imageCandidate && looksLikeWhatsAppPairingCode(imageCandidate)) {
        pairingCode = imageCandidate.trim();
    }

    return { imageBase64, pairingCode };
}

/** Normaliza respostas Go → formato Evolution API v2. */
export function normalizeGoResponseToApiV2(url: string, data: unknown): unknown {
    if (data == null) return data;
    const path = String(url || '');

    if (path.includes('/instance/all')) {
        const wrapped = data as { data?: unknown[] };
        const list = Array.isArray(wrapped?.data) ? wrapped.data : Array.isArray(data) ? data : [];
        return list.map((row: Record<string, unknown>) => {
            const rowConnected = goPayloadLooksConnected(row);
            const rowState = rowConnected ? 'open' : 'close';
            return {
                name: row.name || row.instanceName,
                instanceName: row.name || row.instanceName,
                id: row.id || row.ID || row.instanceId || row.hash,
                token: row.token,
                jid: row.jid,
                connected: rowConnected,
                connectionStatus: rowState,
                instance: {
                    instanceName: row.name || row.instanceName,
                    owner: row.owner || row.jid,
                    status: rowState,
                },
            };
        });
    }

    if (path.includes('/instance/create')) {
        const wrapped = data as { data?: Record<string, unknown> };
        const inner = wrapped?.data || (data as Record<string, unknown>);
        const name = inner?.name || inner?.instanceName;
        const id = inner?.id || inner?.instanceId;
        return {
            instance: { instanceName: name, instanceId: id },
            hash: id,
            id,
            name,
        };
    }

    if (path.includes('/instance/connect') || path.includes('/instance/qr')) {
        const wrapped = data as { data?: Record<string, unknown> };
        const inner = wrapped?.data ?? data;
        const { imageBase64, pairingCode } = parseGoQrPayload(inner);
        return {
            qrcode: { base64: imageBase64, code: pairingCode },
            base64: imageBase64,
            count: imageBase64 || pairingCode ? 1 : 0,
        };
    }

    if (path.includes('/instance/status')) {
        const wrapped = data as { data?: Record<string, unknown> };
        const st = wrapped?.data || (data as Record<string, unknown>);
        // Aceita camelCase e PascalCase (Connected / LoggedIn) do Evolution Go / whatsmeow
        const connected = goPayloadLooksConnected(st) || goPayloadLooksConnected(data as Record<string, unknown>);
        const state = connected ? 'open' : 'close';
        return {
            state,
            connectionStatus: state,
            status: state,
            instance: { state, statusReason: st?.statusReason },
        };
    }

    if (path.includes('/user/avatar')) {
        const wrapped = data as { data?: Record<string, unknown> };
        const inner = wrapped?.data ?? (data as Record<string, unknown>);
        const avatarRaw = inner?.avatar ?? inner?.base64 ?? inner?.profilePictureUrl ?? inner?.url;
        if (typeof avatarRaw === 'string' && avatarRaw.trim()) {
            const avatar = avatarRaw.trim();
            const profilePictureUrl =
                avatar.startsWith('data:') || avatar.startsWith('http')
                    ? avatar
                    : `data:image/jpeg;base64,${avatar}`;
            return { profilePictureUrl, url: profilePictureUrl, avatar, base64: avatar };
        }
        return data;
    }

    if (path.includes('/user/info') || path.includes('/user/profile')) {
        const wrapped = data as { data?: Record<string, unknown> };
        const inner = wrapped?.data ?? (data as Record<string, unknown>);
        const jid = inner?.jid ?? inner?.ID ?? inner?.id;
        return {
            ...inner,
            jid,
            pushName: inner?.pushName ?? inner?.PushName ?? inner?.VerifiedName,
            profileName: inner?.pushName ?? inner?.PushName ?? inner?.VerifiedName,
        };
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
        const msgId = inner?.id || inner?.messageId || inner?.ID || inner?.message_id;
        // Se Go respondeu sem id mas com status OK-like, ainda consideramos sucesso
        const statusStr = String(inner?.status || inner?.Status || '').toUpperCase();
        const statusOk = statusStr === 'PENDING' || statusStr === 'QUEUED' || statusStr === 'SENT' ||
            statusStr === 'SERVER_ACK' || statusStr === 'DELIVERY_ACK' || statusStr === 'READ';
        return {
            key: { id: msgId || (statusOk ? 'go-queued' : undefined) },
            messageId: msgId || undefined,
            status: statusStr || 'PENDING',
        };
    }

    if (path.includes('/message/downloadmedia')) {
        const wrapped = data as { data?: unknown };
        const inner = wrapped?.data ?? data;
        const parseDataUrl = (raw: string) => {
            const t = raw.trim();
            if (!t.startsWith('data:')) return null;
            const semi = t.indexOf(';');
            const comma = t.indexOf(',');
            if (semi < 0 || comma < 0) return null;
            return {
                mimetype: t.slice(5, semi),
                base64: t.slice(comma + 1),
            };
        };
        if (typeof inner === 'string') {
            const parsed = parseDataUrl(inner);
            if (parsed) return parsed;
        }
        if (inner && typeof inner === 'object') {
            const obj = inner as Record<string, unknown>;
            for (const key of ['data', 'base64', 'media', 'url']) {
                const val = obj[key];
                if (typeof val === 'string') {
                    const parsed = parseDataUrl(val);
                    if (parsed) return parsed;
                    if (val.length > 80 && !val.startsWith('http')) {
                        return { base64: val, mimetype: String(obj.mimetype || obj.mimeType || 'application/octet-stream') };
                    }
                }
            }
        }
        return data;
    }

    return data;
}
