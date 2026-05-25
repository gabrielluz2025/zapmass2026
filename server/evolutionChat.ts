import type { AxiosInstance } from 'axios';
import type { Server as SocketIOServer } from 'socket.io';
import { Conversation, ChatMessage } from './types.js';
import { extractEvolutionReplyBody } from './replyFlowEngine.js';
import { saveMediaFromBase64 } from './mediaStorage.js';

const MAX_MESSAGES = 10000;

type ParsedConversation = { connectionId: string; chatPart: string; remoteJid: string };

export function createEvolutionChat(api: AxiosInstance) {
    let conversations: Conversation[] = [];
    let io: SocketIOServer | null = null;
    const deletedConversationIds = new Set<string>();

    function init(socketIO: SocketIOServer) {
        io = socketIO;
    }

    function emitConversationsUpdate() {
        if (io) io.emit('conversations-update', [...conversations]);
    }

    function parseConversationId(conversationId: string): ParsedConversation | null {
        const idx = conversationId.indexOf(':');
        if (idx < 0) return null;
        const connectionId = conversationId.slice(0, idx);
        const chatPart = conversationId.slice(idx + 1);
        return {
            connectionId,
            chatPart,
            remoteJid: toRemoteJid(chatPart),
        };
    }

    function toRemoteJid(chatPart: string): string {
        if (chatPart.includes('@')) return chatPart;
        const digits = chatPart.replace(/\D/g, '');
        return `${digits}@s.whatsapp.net`;
    }

    function buildConversationId(connectionId: string, remoteJid: string): string {
        return `${connectionId}:${remoteJid}`;
    }

    function toPhoneDisplay(jidOrPhone: string): string {
        const base = jidOrPhone.split('@')[0].replace(/\D/g, '');
        return base ? `+${base}` : jidOrPhone;
    }

    function formatTime(tsMs: number): string {
        return new Date(tsMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function inferMessageType(message: Record<string, unknown> | undefined): ChatMessage['type'] {
        if (!message) return 'text';
        if (message.imageMessage) return 'image';
        if (message.videoMessage) return 'video';
        if (message.audioMessage || message.pttMessage) return 'audio';
        if (message.stickerMessage) return 'sticker';
        if (message.documentMessage) return 'document';
        return 'text';
    }

    function extractMessageText(message: Record<string, unknown> | undefined): string {
        if (!message) return '';
        const { bodyText } = extractEvolutionReplyBody(message as Parameters<typeof extractEvolutionReplyBody>[0]);
        if (bodyText) return bodyText;
        const doc = message.documentMessage as { fileName?: string; caption?: string } | undefined;
        if (doc?.fileName) return doc.caption || doc.fileName;
        return '';
    }

    function extractMediaUrl(message: Record<string, unknown> | undefined): string | undefined {
        if (!message) return undefined;
        for (const key of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
            const part = message[key] as { url?: string } | undefined;
            if (part?.url && String(part.url).startsWith('http')) return String(part.url);
        }
        return undefined;
    }

    function evolutionRawToChatMessage(raw: any, skipMedia: boolean): ChatMessage | null {
        if (!raw) return null;
        const key = raw.key || {};
        const remoteJid = String(key.remoteJid || '');
        if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) return null;

        const message = raw.message || raw.messageContent || {};
        const msgId = String(key.id || raw.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        const tsRaw = Number(raw.messageTimestamp || raw.message?.messageTimestamp || raw.timestamp || Date.now());
        const tsMs = tsRaw > 1_000_000_000_000 ? tsRaw : tsRaw * 1000;
        const fromMe = Boolean(key.fromMe);
        const type = inferMessageType(message);
        const text = extractMessageText(message) || (type !== 'text' ? `[${type}]` : '');
        const mediaUrl = skipMedia ? undefined : extractMediaUrl(message);

        return {
            id: msgId,
            text,
            timestamp: formatTime(tsMs),
            sender: fromMe ? 'me' : 'them',
            status: fromMe ? 'sent' : 'delivered',
            type,
            ...(mediaUrl ? { mediaUrl } : {}),
            timestampMs: tsMs,
        };
    }

    function upsertConversation(conv: Conversation) {
        if (deletedConversationIds.has(conv.id)) return;
        const idx = conversations.findIndex((c) => c.id === conv.id);
        if (idx >= 0) {
            conversations[idx] = { ...conversations[idx], ...conv };
        } else {
            conversations.push(conv);
        }
        conversations.sort(
            (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
        );
    }

    function appendMessageToConversation(
        conversationId: string,
        msg: ChatMessage,
        meta?: { contactName?: string; contactPhone?: string; connectionId?: string; incrementUnread?: boolean }
    ) {
        if (deletedConversationIds.has(conversationId)) return;
        let conv = conversations.find((c) => c.id === conversationId);
        if (!conv) {
            conv = {
                id: conversationId,
                contactName: meta?.contactName || meta?.contactPhone || conversationId.split(':')[1] || 'Contato',
                contactPhone: meta?.contactPhone || '',
                connectionId: meta?.connectionId || conversationId.split(':')[0] || '',
                unreadCount: 0,
                lastMessage: msg.text,
                lastMessageTime: msg.timestamp,
                lastMessageTimestamp: msg.timestampMs,
                messages: [],
                tags: [],
            };
            conversations.push(conv);
        }

        const exists = conv.messages.some((m) => m.id === msg.id);
        if (!exists) {
            conv.messages = [...conv.messages.slice(-(MAX_MESSAGES - 1)), msg];
        }
        conv.lastMessage = msg.text || conv.lastMessage;
        conv.lastMessageTime = msg.timestamp;
        conv.lastMessageTimestamp = msg.timestampMs || conv.lastMessageTimestamp;
        if (meta?.incrementUnread && msg.sender === 'them') {
            conv.unreadCount = (conv.unreadCount || 0) + 1;
        } else if (msg.sender === 'me') {
            conv.unreadCount = 0;
        }
        upsertConversation(conv);
    }

    function mapEvolutionChatToConversation(connectionId: string, chat: any): Conversation | null {
        const remoteJid =
            chat?.id ||
            chat?.remoteJid ||
            chat?.jid ||
            chat?.key?.remoteJid ||
            chat?.lastMessage?.key?.remoteJid;
        if (!remoteJid || String(remoteJid).endsWith('@g.us') || String(remoteJid) === 'status@broadcast') {
            return null;
        }

        const jid = String(remoteJid);
        const id = buildConversationId(connectionId, jid);
        const name =
            chat?.name ||
            chat?.pushName ||
            chat?.contactName ||
            chat?.verifiedName ||
            jid.split('@')[0];
        const lastMsgRaw = chat?.lastMessage || chat?.messages?.[0];
        const lastChatMsg = lastMsgRaw ? evolutionRawToChatMessage(lastMsgRaw, true) : null;
        const tsMs =
            lastChatMsg?.timestampMs ||
            Number(chat?.conversationTimestamp || chat?.updatedAt || chat?.t || Date.now()) *
                (Number(chat?.conversationTimestamp) > 1_000_000_000_000 ? 1 : 1000);

        const existing = conversations.find((c) => c.id === id);
        return {
            id,
            contactName: String(name),
            contactPhone: toPhoneDisplay(jid),
            profilePicUrl: existing?.profilePicUrl,
            connectionId,
            unreadCount: Number(chat?.unreadCount ?? chat?.unread ?? existing?.unreadCount ?? 0) || 0,
            lastMessage: lastChatMsg?.text || existing?.lastMessage || '',
            lastMessageTime: lastChatMsg?.timestamp || existing?.lastMessageTime || formatTime(tsMs),
            lastMessageTimestamp: tsMs,
            messages: existing?.messages || (lastChatMsg ? [lastChatMsg] : []),
            tags: existing?.tags || [],
        };
    }

    async function syncChatsForConnection(connectionId: string): Promise<number> {
        try {
            const response = await api.post(`/chat/findChats/${connectionId}`, {});
            const raw = response.data;
            const chats: any[] = Array.isArray(raw)
                ? raw
                : Array.isArray(raw?.chats)
                  ? raw.chats
                  : Array.isArray(raw?.records)
                    ? raw.records
                    : [];

            let added = 0;
            for (const chat of chats) {
                const conv = mapEvolutionChatToConversation(connectionId, chat);
                if (!conv) continue;
                upsertConversation(conv);
                added++;
            }
            if (added > 0) emitConversationsUpdate();
            return added;
        } catch (error: any) {
            console.warn(`[EvolutionChat] syncChats ${connectionId}:`, error?.message || error);
            return 0;
        }
    }

    async function fetchMessages(connectionId: string, remoteJid: string, limit: number): Promise<any[]> {
        const body = {
            where: { key: { remoteJid } },
            limit,
            page: 1,
        };
        try {
            const response = await api.post(`/chat/findMessages/${connectionId}`, body);
            const raw = response.data;
            let messages: any[] = Array.isArray(raw)
                ? raw
                : Array.isArray(raw?.messages)
                  ? raw.messages
                  : Array.isArray(raw?.records)
                    ? raw.records
                    : [];

            if (messages.length > limit * 2) {
                messages = messages.filter(
                    (m) => String(m?.key?.remoteJid || m?.remoteJid || '') === remoteJid
                );
            }
            return messages;
        } catch (error: any) {
            console.warn(`[EvolutionChat] findMessages ${connectionId}:`, error?.message || error);
            return [];
        }
    }

    function handleWebhookMessage(instance: string, data: any) {
        const msg = data?.messages?.[0] || data;
        if (!msg?.key) return;

        const remoteJid = String(msg.key.remoteJid || '');
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;

        const conversationId = buildConversationId(instance, remoteJid);
        const chatMsg = evolutionRawToChatMessage(msg, true);
        if (!chatMsg) return;

        const pushName = data?.messages?.[0]?.pushName || msg.pushName || remoteJid.split('@')[0];
        appendMessageToConversation(conversationId, chatMsg, {
            connectionId: instance,
            contactName: String(pushName),
            contactPhone: toPhoneDisplay(remoteJid),
            incrementUnread: !msg.key.fromMe,
        });
        emitConversationsUpdate();
    }

    function updateMessageStatus(messageId: string, evolutionStatus: number) {
        let changed = false;
        for (const conv of conversations) {
            const msg = conv.messages.find((m) => m.id === messageId);
            if (!msg || msg.sender !== 'me') continue;
            if (evolutionStatus >= 4 && msg.status !== 'read') {
                msg.status = 'read';
                changed = true;
            } else if (evolutionStatus >= 3 && msg.status === 'sent') {
                msg.status = 'delivered';
                changed = true;
            }
        }
        if (changed) emitConversationsUpdate();
    }

    async function sendMessage(conversationId: string, text: string): Promise<void> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) throw new Error('conversationId inválido');

        const number = parsed.remoteJid.replace(/@.+$/, '').replace(/\D/g, '');
        const response = await api.post(`/message/sendText/${parsed.connectionId}`, { number, text });
        const messageId = response.data?.key?.id || response.data?.key?._serialized;
        const nowMs = Date.now();

        const newMsg: ChatMessage = {
            id: messageId ? String(messageId) : `${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
            text,
            timestamp: formatTime(nowMs),
            sender: 'me',
            status: 'sent',
            type: 'text',
            timestampMs: nowMs,
        };

        const effectiveId = buildConversationId(parsed.connectionId, parsed.remoteJid);
        appendMessageToConversation(effectiveId, newMsg, {
            connectionId: parsed.connectionId,
            contactPhone: toPhoneDisplay(parsed.remoteJid),
        });
        emitConversationsUpdate();
    }

    async function sendMedia(
        conversationId: string,
        payload: {
            dataBase64: string;
            mimeType: string;
            fileName: string;
            caption?: string;
            sendMediaAsDocument?: boolean;
        }
    ): Promise<void> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) throw new Error('conversationId inválido');
        if (!payload?.dataBase64 || !payload.mimeType || !payload.fileName) {
            throw new Error('Arquivo inválido para envio.');
        }

        const number = parsed.remoteJid.replace(/@.+$/, '').replace(/\D/g, '');
        const { url } = await saveMediaFromBase64(payload.dataBase64, payload.mimeType, payload.fileName);

        let type = 'document';
        if (!payload.sendMediaAsDocument) {
            if (payload.mimeType.startsWith('image/')) type = 'image';
            else if (payload.mimeType.startsWith('video/')) type = 'video';
            else if (payload.mimeType.startsWith('audio/')) type = 'audio';
        }

        const response = await api.post(`/message/sendMedia/${parsed.connectionId}`, {
            number,
            options: { delay: 1200, presence: 'composing' },
            mediaMessage: {
                mediatype: type,
                caption: payload.caption || '',
                media: url,
                fileName: payload.fileName,
            },
        });

        const messageId = response.data?.key?.id || response.data?.key?._serialized;
        const nowMs = Date.now();
        const msgType: ChatMessage['type'] = payload.sendMediaAsDocument
            ? 'document'
            : payload.mimeType.startsWith('image/')
              ? 'image'
              : payload.mimeType.startsWith('video/')
                ? 'video'
                : payload.mimeType.startsWith('audio/')
                  ? 'audio'
                  : 'document';

        const newMsg: ChatMessage = {
            id: messageId ? String(messageId) : `${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
            text: payload.caption || payload.fileName,
            timestamp: formatTime(nowMs),
            sender: 'me',
            status: 'sent',
            type: msgType,
            mediaUrl: url,
            timestampMs: nowMs,
        };

        appendMessageToConversation(buildConversationId(parsed.connectionId, parsed.remoteJid), newMsg, {
            connectionId: parsed.connectionId,
            contactPhone: toPhoneDisplay(parsed.remoteJid),
        });
        emitConversationsUpdate();
    }

    async function loadChatHistory(
        conversationId: string,
        limit = 500,
        skipMedia = true
    ): Promise<{ ok: boolean; total: number; error?: string }> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) return { ok: false, total: 0, error: 'conversationId inválido.' };

        const requested = Math.max(50, Math.min(limit, MAX_MESSAGES));
        const fetched = await fetchMessages(parsed.connectionId, parsed.remoteJid, requested);
        const converted = fetched
            .map((m) => evolutionRawToChatMessage(m, skipMedia))
            .filter((m): m is ChatMessage => Boolean(m))
            .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));

        let conv = conversations.find((c) => c.id === conversationId);
        if (!conv) {
            const last = converted[converted.length - 1];
            conv = {
                id: conversationId,
                contactName: toPhoneDisplay(parsed.remoteJid),
                contactPhone: toPhoneDisplay(parsed.remoteJid),
                connectionId: parsed.connectionId,
                unreadCount: 0,
                lastMessage: last?.text || '',
                lastMessageTime: last?.timestamp || '',
                lastMessageTimestamp: last?.timestampMs,
                messages: [],
                tags: [],
            };
            deletedConversationIds.delete(conversationId);
            upsertConversation(conv);
            conv = conversations.find((c) => c.id === conversationId);
        }
        if (!conv) return { ok: true, total: converted.length };

        const byId = new Map<string, ChatMessage>();
        for (const m of converted) byId.set(m.id, m);
        for (const m of conv.messages) {
            const existing = byId.get(m.id);
            if (existing) {
                if (m.fromCampaign) existing.fromCampaign = m.fromCampaign;
                if (m.campaignId) existing.campaignId = m.campaignId;
                if (m.mediaUrl && !existing.mediaUrl) existing.mediaUrl = m.mediaUrl;
            } else {
                byId.set(m.id, m);
            }
        }
        conv.messages = Array.from(byId.values())
            .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0))
            .slice(-MAX_MESSAGES);
        emitConversationsUpdate();
        return { ok: true, total: conv.messages.length };
    }

    async function loadMessageMedia(
        conversationId: string,
        messageId: string
    ): Promise<{ ok: boolean; mediaUrl?: string; error?: string }> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) return { ok: false, error: 'conversationId inválido.' };

        const conv = conversations.find((c) => c.id === conversationId);
        const local = conv?.messages.find((m) => m.id === messageId);
        if (local?.mediaUrl) return { ok: true, mediaUrl: local.mediaUrl };

        const fetched = await fetchMessages(parsed.connectionId, parsed.remoteJid, 200);
        const match = fetched.find((m) => String(m?.key?.id) === messageId);
        if (!match) return { ok: false, error: 'Mensagem não encontrada.' };

        try {
            const response = await api.post(`/chat/getBase64FromMediaMessage/${parsed.connectionId}`, {
                message: match,
            });
            const base64 = response.data?.base64 || response.data?.data;
            const mime = response.data?.mimetype || response.data?.mimeType || 'application/octet-stream';
            if (base64) {
                const mediaUrl = `data:${mime};base64,${base64}`;
                if (local) {
                    local.mediaUrl = mediaUrl;
                    emitConversationsUpdate();
                }
                return { ok: true, mediaUrl };
            }
        } catch {
            /* fallback URL direta */
        }

        const directUrl = extractMediaUrl(match.message);
        if (directUrl) {
            if (local) {
                local.mediaUrl = directUrl;
                emitConversationsUpdate();
            }
            return { ok: true, mediaUrl: directUrl };
        }
        return { ok: false, error: 'Mídia indisponível.' };
    }

    async function markAsRead(conversationId: string): Promise<void> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) return;

        const conv = conversations.find((c) => c.id === conversationId);
        if (conv) {
            conv.unreadCount = 0;
            emitConversationsUpdate();
        }

        const unreadThem = (conv?.messages || []).filter((m) => m.sender === 'them').slice(-5);
        if (unreadThem.length === 0) return;

        try {
            await api.post(`/chat/markMessageAsRead/${parsed.connectionId}`, {
                readMessages: unreadThem.map((m) => ({
                    remoteJid: parsed.remoteJid,
                    fromMe: false,
                    id: m.id,
                })),
            });
        } catch (error: any) {
            console.warn('[EvolutionChat] markAsRead:', error?.message || error);
        }
    }

    async function fetchConversationPicture(conversationId: string): Promise<string | null> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) return null;

        const conv = conversations.find((c) => c.id === conversationId);
        if (conv?.profilePicUrl) return conv.profilePicUrl;

        const number = parsed.remoteJid.replace(/@.+$/, '').replace(/\D/g, '');
        try {
            const response = await api.post(`/chat/fetchProfilePictureUrl/${parsed.connectionId}`, { number });
            const pic = response.data?.profilePictureUrl || response.data?.url || response.data?.picture;
            if (pic && String(pic).startsWith('http')) {
                if (conv) {
                    conv.profilePicUrl = String(pic);
                    emitConversationsUpdate();
                }
                return String(pic);
            }
        } catch (error: any) {
            console.warn('[EvolutionChat] fetchProfilePicture:', error?.message || error);
        }
        return null;
    }

    function deleteLocalConversations(conversationIds: string[]): number {
        if (!conversationIds.length) return 0;
        const idSet = new Set(conversationIds);
        const before = conversations.length;
        conversations = conversations.filter((c) => !idSet.has(c.id));
        conversationIds.forEach((id) => deletedConversationIds.add(id));
        const removed = before - conversations.length;
        if (removed > 0) emitConversationsUpdate();
        return removed;
    }

    function purgeConversationsForConnection(connectionId: string): number {
        const cid = String(connectionId || '').trim();
        if (!cid) return 0;
        const ids = conversations
            .filter((c) => c.id.startsWith(`${cid}:`) || c.connectionId === cid)
            .map((c) => c.id);
        return deleteLocalConversations(ids);
    }

    return {
        init,
        getConversations: () => [...conversations],
        emitConversationsUpdate,
        syncChatsForConnection,
        handleWebhookMessage,
        updateMessageStatus,
        sendMessage,
        sendMedia,
        loadChatHistory,
        loadMessageMedia,
        markAsRead,
        fetchConversationPicture,
        deleteLocalConversations,
        purgeConversationsForConnection,
    };
}

export type EvolutionChatStore = ReturnType<typeof createEvolutionChat>;
