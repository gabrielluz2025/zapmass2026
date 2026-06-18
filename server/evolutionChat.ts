import type { AxiosInstance } from 'axios';
import type { Server as SocketIOServer } from 'socket.io';
import { Conversation, ChatMessage } from './types.js';
import { extractEvolutionReplyBody } from './replyFlowEngine.js';
import { saveMediaFromBase64 } from './mediaStorage.js';
import {
    prepareConversationsForSocketEmit,
    socketConversationDeltaPayload
} from './conversationsEmit.js';
import { enrichConversationsWithCrmNames } from './contactNameEnrich.js';
import {
    enrichConversationsWithCrmPhones,
    resolveCrmPhonePeerForConversation,
    scrubInvalidConversationPhone
} from './contactPhoneEnrich.js';
import {
    looksLikeLongLidDigits,
    normalizePhoneDigits,
    pickContactDisplayName
} from '../src/utils/contactPhoneLookup.js';
import {
    collapseConversationsByPhone,
    mergeConversationsPair
} from '../src/utils/collapseConversationsByPhone.js';
import {
    parseEvolutionPresenceWebhook,
    type WaContactPresence,
} from '../src/utils/evolutionPresence.js';
import {
    createPhonebookNameIndex,
    evolutionContactDisplayName,
    filterEvolutionContactLabel,
    indexPhonebookRow,
    resolvePhonebookName,
    type PhonebookNameIndex
} from './evolutionContactName.js';
import { chatRemoteJidFromFindChatsRow, formatChatListTime, isGarbagePersonChatJid, resolveChatRowTimestampMs } from './evolutionChatJid.js';
import {
    formatEvolutionHttpError,
    resolveOutboundSendTarget
} from './evolutionChatSend.js';
import {
    hasResolvablePhone,
    isLidJid,
    mergeLidPeerFields,
    peerFieldsFromEvolutionChatRow,
    pickSendableWaJidAlt,
    peerFromRawMessageRecord,
    peerFromStoredMessages,
    resolveLidPeerFromEvolutionApi
} from './evolutionLidResolve.js';
import { resolvePhoneDigitsFromEvolutionMessage } from './evolutionWebhookMessages.js';
import {
    appendChatArchiveMessages,
    isWaChatArchiveEnabled,
    threadIdFromConversationId
} from './chatArchiveStore.js';
import {
    hydrateChatArchiveForConversation as mergeHydrateChatArchive,
    mergeChatArchiveIntoConversation
} from './chatArchiveMerge.js';

export type EvolutionChatArchiveCtx = {
    resolveConnectionOwnerUid: (connectionId: string) => string | undefined;
    ownerUidFromConnectionId: (connectionId: string) => string | undefined;
};

const MAX_MESSAGES = 10000;

type ParsedConversation = { connectionId: string; chatPart: string; remoteJid: string };

function evoInst(instanceName: string): string {
    return encodeURIComponent(String(instanceName || '').trim());
}

export function createEvolutionChat(api: AxiosInstance, archiveCtx?: EvolutionChatArchiveCtx) {
    let conversations: Conversation[] = [];
    let io: SocketIOServer | null = null;
    let notifyConversationsChanged: (() => void) | null = null;
    /** ownerUid do tenant atual — usado para escopo seguro em emitConversationsUpdate. */
    let ownerUidForScope: string | null = null;
    const deletedConversationIds = new Set<string>();
    /** Evita corrida quando vários canais sincronizam findChats em paralelo. */
    let storeLock: Promise<void> = Promise.resolve();
    /** Debounce de 120ms para evitar dezenas de emits em sequência (ex: sync inicial de 1300+ conversas). */
    let emitDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingDeltaIds = new Set<string>();
    let deltaDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const DELTA_FLUSH_MAX = (() => {
        const raw = Number(process.env.CHAT_DELTA_FLUSH_MAX ?? 80);
        if (!Number.isFinite(raw)) return 80;
        return Math.max(10, Math.min(200, Math.floor(raw)));
    })();
    /** Contador de amostras de diagnóstico de conversas @lid (cap p/ não floodar logs). */
    let lidDiagSamples = 0;
    const phonebookCache = new Map<string, { at: number; index: PhonebookNameIndex }>();
    const PHONEBOOK_CACHE_MS = 120_000;
    const withStoreLock = <T>(fn: () => Promise<T>): Promise<T> => {
        const run = storeLock.then(fn);
        storeLock = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    };

    function init(
        socketIO: SocketIOServer,
        opts?: { notifyConversationsChanged?: () => void; ownerUid?: string }
    ) {
        io = socketIO;
        notifyConversationsChanged = opts?.notifyConversationsChanged ?? null;
        if (opts?.ownerUid) ownerUidForScope = opts.ownerUid;
    }

    function collapseStoredConversations(): void {
        const collapsed = collapseConversationsByPhone(conversations);
        if (collapsed.length >= conversations.length) return;
        conversations.length = 0;
        conversations.push(...collapsed);
    }

    /** Lista completa — só sync findChats, delete em massa ou rajada grande de deltas. */
    function emitConversationsUpdate() {
        if (notifyConversationsChanged) {
            notifyConversationsChanged();
            return;
        }
        if (!io) return;
        if (!ownerUidForScope) {
            console.warn('[evolutionChat] emitConversationsUpdate sem ownerUid — update suprimido para evitar cross-tenant.');
            return;
        }
        pendingDeltaIds.clear();
        if (deltaDebounceTimer) {
            clearTimeout(deltaDebounceTimer);
            deltaDebounceTimer = null;
        }
        if (emitDebounceTimer) clearTimeout(emitDebounceTimer);
        emitDebounceTimer = setTimeout(() => {
            emitDebounceTimer = null;
            if (!io || !ownerUidForScope) return;
            void (async () => {
                collapseStoredConversations();
                let payload = prepareConversationsForSocketEmit(conversations);
                payload = await enrichConversationsWithCrmPhones(ownerUidForScope!, payload);
                payload = await enrichConversationsWithCrmNames(ownerUidForScope!, payload);
                io!.to(`user:${ownerUidForScope}`).emit('conversations-update', payload);
            })();
        }, 80);
    }

    function emitConversationDeltaNow(conversationId: string) {
        if (notifyConversationsChanged) return;
        if (!io || !ownerUidForScope) return;
        const conv = conversations.find((c) => c.id === conversationId);
        if (!conv) return;
        void (async () => {
            const payload = await socketConversationDeltaPayload(
                ownerUidForScope!,
                ownerUidForScope!,
                conv,
                archiveCtx?.resolveConnectionOwnerUid
            );
            if (!payload) return;
            io!.to(`user:${ownerUidForScope}`).emit('conversation-delta', payload);
        })();
    }

    function flushConversationDeltas() {
        deltaDebounceTimer = null;
        const ids = [...pendingDeltaIds];
        pendingDeltaIds.clear();
        if (ids.length === 0) return;
        if (ids.length > DELTA_FLUSH_MAX) {
            emitConversationsUpdate();
            return;
        }
        for (const id of ids) emitConversationDeltaNow(id);
    }

    function queueConversationDelta(conversationId: string) {
        if (!conversationId) return;
        pendingDeltaIds.add(conversationId);
        if (deltaDebounceTimer) clearTimeout(deltaDebounceTimer);
        deltaDebounceTimer = setTimeout(flushConversationDeltas, 50);
    }

    function emitConversationDelta(conversationId: string) {
        queueConversationDelta(conversationId);
    }

    function emitConversationsRemoved(conversationIds: string[]) {
        if (notifyConversationsChanged) return;
        if (!io || !ownerUidForScope || conversationIds.length === 0) return;
        io.to(`user:${ownerUidForScope}`).emit('conversations-removed', {
            conversationIds: [...new Set(conversationIds)],
        });
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
        if (jidOrPhone.endsWith('@lid')) return '';
        const base = jidOrPhone.split('@')[0].replace(/\D/g, '');
        if (!base || base === '0' || base.length < 8) return '';
        return `+${base}`;
    }

    function formatTime(tsMs: number): string {
        return formatChatListTime(tsMs);
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

    const MEDIA_TYPE_LABEL: Record<string, string> = {
        image: '📷 Imagem',
        video: '🎥 Vídeo',
        audio: '🎵 Áudio',
        sticker: '🎭 Figurinha',
        document: '📎 Documento',
    };

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
        const text = extractMessageText(message) || MEDIA_TYPE_LABEL[type] || '';
        const mediaUrl = skipMedia ? undefined : extractMediaUrl(message);
        const waRemoteJidAlt = pickSendableWaJidAlt(key.remoteJidAlt) || undefined;
        const waSenderPn = pickSendableWaJidAlt(key.senderPn, key.participant) || undefined;

        return {
            id: msgId,
            text,
            timestamp: formatTime(tsMs),
            sender: fromMe ? 'me' : 'them',
            status: fromMe ? 'sent' : 'delivered',
            type,
            ...(mediaUrl ? { mediaUrl } : {}),
            timestampMs: tsMs,
            ...(waRemoteJidAlt ? { waRemoteJidAlt } : {}),
            ...(waSenderPn ? { waSenderPn } : {}),
        };
    }

    function allowDeletedConversation(conversationId: string) {
        deletedConversationIds.delete(conversationId);
    }

    const persistConversationDeltaArchive = (
        prev: Conversation | null | undefined,
        next: Conversation
    ): void => {
        if (!isWaChatArchiveEnabled() || !archiveCtx) return;
        if (!next?.connectionId || deletedConversationIds.has(next.id)) return;
        const ownerUid =
            archiveCtx.resolveConnectionOwnerUid(next.connectionId) ||
            archiveCtx.ownerUidFromConnectionId(next.connectionId);
        if (!ownerUid || ownerUid === 'anonymous') return;
        const threadId = threadIdFromConversationId(next.id, next.contactPhone);
        if (!threadId) return;
        const prevIds = new Set((prev?.messages || []).map((m) => m.id));
        const delta = (next.messages || []).filter((m) => m?.id && !prevIds.has(m.id));
        if (delta.length === 0) return;
        void appendChatArchiveMessages(ownerUid, threadId, {
            contactName: next.contactName || 'Contato',
            contactPhone: next.contactPhone || '',
            connectionId: next.connectionId
        }, delta).catch(() => undefined);
    };

    const evoChatArchiveHooks = () => ({
        getConversations: () => conversations,
        upsertConversation,
        allowDeletedConversation,
        emitConversationDelta,
        resolveConnectionOwnerUid: archiveCtx!.resolveConnectionOwnerUid,
        ownerUidFromConnectionId: archiveCtx!.ownerUidFromConnectionId,
        maxMessages: MAX_MESSAGES
    });

    function upsertConversation(incoming: Conversation, opts?: { skipArchive?: boolean }) {
        const originalId = incoming.id;
        const canonicalId = resolveCanonicalConversationId(
            incoming.connectionId,
            incoming.id,
            { contactPhone: incoming.contactPhone, waJidAlt: incoming.waJidAlt }
        );
        let conv =
            canonicalId !== incoming.id
                ? { ...incoming, id: canonicalId }
                : incoming;
        if (canonicalId !== originalId) {
            conv = removeDuplicateConversationId(originalId, conv);
        }
        if (deletedConversationIds.has(conv.id)) return;
        const idx = conversations.findIndex((c) => c.id === conv.id);
        const prev = idx >= 0 ? conversations[idx] : null;
        if (idx >= 0) {
            const prevTs = prev.lastMessageTimestamp || 0;
            const convTs = conv.lastMessageTimestamp || 0;
            const bestTs = Math.max(prevTs, convTs);
            const newerFromConv = convTs >= prevTs;
            conversations[idx] = {
                ...prev,
                ...conv,
                contactName: pickContactDisplayName({
                    waName: conv.contactName,
                    previous: prev.contactName,
                    fallback: prev.contactName || conv.contactName || 'Contato'
                }),
                contactPhone: (() => {
                    const merged = mergeLidPeerFields(
                        parseConversationId(conv.id)?.remoteJid || '',
                        { contactPhone: conv.contactPhone, waJidAlt: conv.waJidAlt },
                        { contactPhone: prev.contactPhone, waJidAlt: prev.waJidAlt }
                    );
                    return merged.contactPhone || prev.contactPhone || conv.contactPhone;
                })(),
                waJidAlt: (() => {
                    const merged = mergeLidPeerFields(
                        parseConversationId(conv.id)?.remoteJid || '',
                        { contactPhone: conv.contactPhone, waJidAlt: conv.waJidAlt },
                        { contactPhone: prev.contactPhone, waJidAlt: prev.waJidAlt }
                    );
                    return merged.waJidAlt || prev.waJidAlt || conv.waJidAlt;
                })(),
                profilePicUrl: conv.profilePicUrl || prev.profilePicUrl,
                lastMessageTimestamp: bestTs,
                lastMessage:
                    newerFromConv && (conv.lastMessage || '').trim()
                        ? conv.lastMessage
                        : prev.lastMessage || conv.lastMessage || '',
                lastMessageTime: bestTs > 0 ? formatTime(bestTs) : '',
                messages:
                    (prev.messages?.length || 0) > (conv.messages?.length || 0)
                        ? prev.messages
                        : conv.messages?.length
                          ? conv.messages
                          : prev.messages,
                unreadCount: Math.max(prev.unreadCount || 0, conv.unreadCount || 0),
                tags: prev.tags?.length ? prev.tags : conv.tags,
            };
        } else {
            const ts = conv.lastMessageTimestamp || 0;
            conversations.push({
                ...conv,
                lastMessageTime: ts > 0 ? conv.lastMessageTime || formatTime(ts) : '',
                lastMessageTimestamp: ts,
            });
        }
        conversations.sort(
            (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
        );
        if (!opts?.skipArchive) {
            persistConversationDeltaArchive(prev ?? undefined, conversations.find((c) => c.id === conv.id) || conv);
        }
    }

    function appendMessageToConversation(
        conversationId: string,
        msg: ChatMessage,
        meta?: {
            contactName?: string;
            contactPhone?: string;
            waJidAlt?: string;
            connectionId?: string;
            incrementUnread?: boolean;
        }
    ) {
        const connectionId = meta?.connectionId || conversationId.split(':')[0] || '';
        const originalId = conversationId;
        conversationId = resolveCanonicalConversationId(connectionId, conversationId, {
            contactPhone: meta?.contactPhone,
            waJidAlt: meta?.waJidAlt
        });
        if (conversationId !== originalId) {
            deletedConversationIds.delete(conversationId);
            const canon = conversations.find((c) => c.id === conversationId);
            const orphan = conversations.find((c) => c.id === originalId);
            if (orphan && canon) {
                const idx = conversations.findIndex((c) => c.id === conversationId);
                conversations[idx] = removeDuplicateConversationId(originalId, canon);
            } else if (orphan) {
                const oIdx = conversations.findIndex((c) => c.id === originalId);
                conversations[oIdx] = { ...orphan, id: conversationId };
                deletedConversationIds.delete(originalId);
            }
        }
        // Nova mensagem reabre conversa que o usuário tinha removido da lista local.
        if (deletedConversationIds.has(conversationId)) {
            deletedConversationIds.delete(conversationId);
        }
        let conv = conversations.find((c) => c.id === conversationId);
        if (!conv) {
            const resolvedName = filterEvolutionName(meta?.contactName) || meta?.contactPhone || conversationId.split(':')[1] || '';
            conv = {
                id: conversationId,
                contactName: resolvedName,
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
        } else {
            // Atualiza nome se o atual é genérico/vazio e chegou uma versão melhor via pushName
            const betterName = filterEvolutionName(meta?.contactName);
            if (betterName && (!conv.contactName || !filterEvolutionName(conv.contactName))) {
                conv.contactName = betterName;
            }
            const parsedAppend = parseConversationId(conv.id);
            if (parsedAppend) {
                const merged = mergeLidPeerFields(
                    parsedAppend.remoteJid,
                    { contactPhone: meta?.contactPhone, waJidAlt: meta?.waJidAlt },
                    { contactPhone: conv.contactPhone, waJidAlt: conv.waJidAlt }
                );
                if (merged.contactPhone) conv.contactPhone = merged.contactPhone;
                if (merged.waJidAlt) conv.waJidAlt = merged.waJidAlt;
            }
        }

        const exists = conv.messages.some((m) => m.id === msg.id);
        if (!exists) {
            conv.messages = [...conv.messages.slice(-(MAX_MESSAGES - 1)), msg]
                .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
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

    function resolveConversationIdForPhone(connectionId: string, phoneDigits: string): string {
        const target = normalizePhoneDigits(phoneDigits);
        if (!target) return buildConversationId(connectionId, `${phoneDigits}@s.whatsapp.net`);
        for (const c of conversations) {
            if (c.connectionId !== connectionId) continue;
            const cp = normalizePhoneDigits(c.contactPhone || '');
            if (cp && cp === target) return c.id;
            const jidPart = c.id.includes(':') ? c.id.slice(c.id.indexOf(':') + 1) : '';
            const jidDigits = normalizePhoneDigits(jidPart.split('@')[0] || '');
            if (jidDigits && jidDigits === target) return c.id;
        }
        return buildConversationId(connectionId, `${target}@s.whatsapp.net`);
    }

    /** Uma thread por telefone: @lid e @s.whatsapp.net do mesmo contato viram o mesmo id. */
    function resolveCanonicalConversationId(
        connectionId: string,
        conversationId: string,
        peer?: { contactPhone?: string; waJidAlt?: string }
    ): string {
        const parsed = parseConversationId(conversationId);
        if (!parsed || parsed.connectionId !== connectionId) return conversationId;
        const existing = conversations.find((c) => c.id === conversationId);
        const merged = mergeLidPeerFields(
            parsed.remoteJid,
            peer || {},
            existing
                ? { contactPhone: existing.contactPhone, waJidAlt: existing.waJidAlt }
                : undefined
        );
        if (!hasResolvablePhone(merged)) return conversationId;
        const digits = normalizePhoneDigits(merged.contactPhone);
        return resolveConversationIdForPhone(connectionId, digits);
    }

    function removeDuplicateConversationId(dropId: string, keep: Conversation): Conversation {
        const dropIdx = conversations.findIndex((c) => c.id === dropId);
        if (dropIdx < 0) return keep;
        const merged = mergeConversationsPair(keep, conversations[dropIdx]!);
        conversations.splice(dropIdx, 1);
        deletedConversationIds.add(dropId);
        return merged;
    }

    /** Registra envio de campanha no store local para ACK (entregue/lido) e relatório na UI. */
    function appendCampaignOutboundMessage(opts: {
        connectionId: string;
        phoneDigits: string;
        messageId: string;
        text: string;
        campaignId: string;
        messageType?: ChatMessage['type'];
    }): void {
        const digits = normalizePhoneDigits(opts.phoneDigits);
        const conversationId = resolveConversationIdForPhone(opts.connectionId, digits || opts.phoneDigits);
        const nowMs = Date.now();
        const msgId = String(opts.messageId || '').trim() || `camp_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;
        const newMsg: ChatMessage = {
            id: msgId,
            text: opts.text,
            timestamp: formatTime(nowMs),
            sender: 'me',
            status: 'sent',
            type: opts.messageType || 'text',
            fromCampaign: true,
            campaignId: opts.campaignId,
            timestampMs: nowMs,
        };
        appendMessageToConversation(conversationId, newMsg, {
            connectionId: opts.connectionId,
            contactPhone: digits.length >= 8 ? `+${digits}` : undefined,
            contactName: digits.length >= 8 ? `+${digits}` : undefined,
        });
        const conv = conversations.find((c) => c.id === conversationId);
        if (conv) {
            const tags = conv.tags || [];
            if (!tags.includes('Campanha')) conv.tags = [...tags, 'Campanha'];
        }
        emitConversationDelta(conversationId);
    }

    function messageIdsMatch(storedId: string, incomingId: string): boolean {
        const a = String(storedId || '').trim();
        const b = String(incomingId || '').trim();
        if (!a || !b) return false;
        if (a === b) return true;
        if (a.endsWith(b) || b.endsWith(a)) return true;
        const shortA = a.includes(':') ? a.split(':').pop()! : a;
        const shortB = b.includes(':') ? b.split(':').pop()! : b;
        return shortA === shortB || a.includes(shortB) || b.includes(shortA);
    }

    function chatRemoteJid(chat: any): string | null {
        return chatRemoteJidFromFindChatsRow(chat);
    }

    function extractFindChatsList(raw: unknown): any[] {
        if (Array.isArray(raw)) return raw;
        if (!raw || typeof raw !== 'object') return [];
        const row = raw as Record<string, unknown>;
        for (const key of ['chats', 'records', 'data', 'result', 'response'] as const) {
            const v = row[key];
            if (Array.isArray(v)) return v;
            if (v && typeof v === 'object') {
                const nested = v as Record<string, unknown>;
                if (Array.isArray(nested.chats)) return nested.chats as any[];
                if (Array.isArray(nested.records)) return nested.records as any[];
            }
        }
        return [];
    }

    function pruneGarbageConversations(forConnectionId?: string): number {
        const before = conversations.length;
        conversations = conversations.filter((c) => {
            /** Nunca remove conversas de outro chip durante sync parcial de um canal. */
            if (forConnectionId && c.connectionId !== forConnectionId) return true;
            const jidPart = c.id.includes(':') ? c.id.slice(c.id.indexOf(':') + 1) : '';
            if (jidPart && isGarbagePersonChatJid(jidPart)) return false;
            const msgs = c.messages?.length ?? 0;
            const name = String(c.contactName || '').trim();
            const phone = String(c.contactPhone || '').trim();
            const hasPreview =
                Boolean((c.lastMessage || '').trim()) ||
                (typeof c.lastMessageTimestamp === 'number' &&
                    Number.isFinite(c.lastMessageTimestamp) &&
                    c.lastMessageTimestamp > 0);
            if (msgs === 0 && !hasPreview && (name === '0' || phone === '+0' || phone === '0')) {
                return false;
            }
            if (c.lastMessageTime === 'Invalid Date') {
                c.lastMessageTime = formatChatListTime(c.lastMessageTimestamp || 0);
            }
            return true;
        });
        return before - conversations.length;
    }

    function extractChatProfilePic(chat: Record<string, unknown> | null | undefined): string | undefined {
        if (!chat) return undefined;
        const contact = chat.contact as Record<string, unknown> | undefined;
        const candidates: unknown[] = [
            chat.profilePictureUrl,
            chat.profilePicUrl,
            chat.picture,
            chat.imgUrl,
            contact?.profilePictureUrl,
            contact?.profilePicUrl,
        ];
        for (const c of candidates) {
            if (typeof c !== 'string' || c.length < 8) continue;
            if (c.startsWith('http') || c.startsWith('data:')) return c;
        }
        return undefined;
    }

    function parseProfilePicturePayload(raw: unknown): string | null {
        if (!raw || typeof raw !== 'object') return null;
        const row = raw as Record<string, unknown>;
        for (const key of ['profilePictureUrl', 'url', 'picture', 'imgUrl', 'base64'] as const) {
            const v = row[key];
            if (typeof v !== 'string' || v.length < 8) continue;
            if (v.startsWith('http') || v.startsWith('data:')) return v;
        }
        const nested = row.response ?? row.data ?? row.result;
        if (nested && nested !== raw) return parseProfilePicturePayload(nested);
        return null;
    }

    /** Baixa foto remota (WhatsApp CDN) e devolve data URL — evita bloqueio no browser. */
    async function mirrorRemoteProfilePicture(url: string): Promise<string | null> {
        if (!url.startsWith('http')) return url.startsWith('data:') ? url : null;
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ZapMass/1.0)',
                    Accept: 'image/*',
                },
                signal: AbortSignal.timeout(12_000),
            });
            if (!res.ok) return null;
            const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
            if (!mime.startsWith('image/')) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 64 || buf.length > 2_500_000) return null;
            return `data:${mime};base64,${buf.toString('base64')}`;
        } catch {
            return null;
        }
    }

    async function normalizeProfilePictureUrl(url: string | null): Promise<string | null> {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        if (url.startsWith('http')) {
            const mirrored = await mirrorRemoteProfilePicture(url);
            return mirrored || url;
        }
        return null;
    }

    async function fetchAllChatsPaginated(connectionId: string): Promise<any[]> {
        const inst = evoInst(connectionId);
        const all: any[] = [];
        const seen = new Set<string>();

        const ingest = (list: any[]) => {
            for (const chat of list) {
                const jid = chatRemoteJidFromFindChatsRow(chat);
                if (!jid || seen.has(jid)) continue;
                seen.add(jid);
                all.push(chat);
            }
        };

        for (let page = 1; page <= 30; page++) {
            let list: any[] = [];
            try {
                const response = await api.post(`/chat/findChats/${inst}`, { page, limit: 500 });
                list = extractFindChatsList(response.data);
            } catch {
                try {
                    const response = await api.get(`/chat/findChats/${inst}`, {
                        params: { page, limit: 500 },
                    });
                    list = extractFindChatsList(response.data);
                } catch {
                    break;
                }
            }
            if (list.length === 0) break;
            ingest(list);
            if (list.length < 500) break;
        }

        const contactRows = await fetchContactsSupplement(connectionId, seen);
        all.push(...contactRows);
        return all;
    }

    async function fetchContactsSupplement(connectionId: string, seen: Set<string>): Promise<any[]> {
        const inst = evoInst(connectionId);
        const out: any[] = [];
        const tryExtract = (raw: unknown): any[] => {
            if (Array.isArray(raw)) return raw;
            if (!raw || typeof raw !== 'object') return [];
            const row = raw as Record<string, unknown>;
            for (const key of ['contacts', 'records', 'data', 'response'] as const) {
                const v = row[key];
                if (Array.isArray(v)) return v;
            }
            return [];
        };
        try {
            const response = await api.post(`/chat/findContacts/${inst}`, {
                where: {},
                page: 1,
                limit: 5000,
            });
            const list = tryExtract(response.data);
            for (const ct of list) {
                const row = ct as Record<string, unknown>;
                const jid = chatRemoteJidFromFindChatsRow(row);
                if (!jid || seen.has(jid) || jid.endsWith('@g.us') || isGarbagePersonChatJid(jid)) continue;
                seen.add(jid);
                const bookName = evolutionContactDisplayName(row);
                out.push({
                    ...row,
                    remoteJid: jid,
                    name: bookName || row.pushName || row.name || row.verifiedName,
                    notify: row.notify,
                });
            }
        } catch (err: any) {
            console.warn(`[EvolutionChat] findContacts ${connectionId}:`, err?.message || err);
        }
        return out;
    }

    async function enrichProfilePicturesForConnection(
        connectionId: string,
        opts?: { deferEmit?: boolean }
    ): Promise<number> {
        const targets = conversations.filter((c) => {
            if (c.connectionId !== connectionId) return false;
            const pic = c.profilePicUrl;
            if (!pic) return true;
            return pic.startsWith('http') && !pic.startsWith('data:');
        });
        let fetched = 0;
        const batchSize = 6;
        const pictureUpdatedIds: string[] = [];
        for (let i = 0; i < Math.min(targets.length, 300); i += batchSize) {
            const slice = targets.slice(i, i + batchSize);
            const results = await Promise.all(
                slice.map(async (c) => {
                    const pic = await fetchConversationPicture(c.id, { silentEmit: true });
                    return pic ? c.id : null;
                })
            );
            for (const id of results) {
                if (id) pictureUpdatedIds.push(id);
            }
            fetched += results.filter(Boolean).length;
        }
        if (!opts?.deferEmit && pictureUpdatedIds.length > 0) {
            for (const id of pictureUpdatedIds) queueConversationDelta(id);
            flushConversationDeltas();
        }
        return fetched;
    }

    /**
     * Filtra nomes genéricos/inválidos que a Evolution API retorna quando não encontra o nome real do contato.
     * Retorna undefined para que o próximo campo na cadeia seja tentado.
     */
    function filterEvolutionName(raw: unknown): string | undefined {
        return filterEvolutionContactLabel(raw);
    }

    function extractFindMessagesRecords(raw: unknown): {
        records: any[];
        pages: number;
        currentPage: number;
        total: number;
    } {
        if (Array.isArray(raw)) {
            return { records: raw, pages: 1, currentPage: 1, total: raw.length };
        }
        if (!raw || typeof raw !== 'object') {
            return { records: [], pages: 0, currentPage: 0, total: 0 };
        }
        const row = raw as Record<string, unknown>;
        const bag =
            row.messages && typeof row.messages === 'object'
                ? (row.messages as Record<string, unknown>)
                : row;
        const records = Array.isArray(bag.records)
            ? (bag.records as any[])
            : Array.isArray(bag.messages)
              ? (bag.messages as any[])
              : Array.isArray(row.records)
                ? (row.records as any[])
                : [];
        const pages = Number(bag.pages) || (records.length > 0 ? 1 : 0);
        const currentPage = Number(bag.currentPage) || 1;
        const total = Number(bag.total) || records.length;
        return { records, pages, currentPage, total };
    }

    async function fetchPhonebookNameIndex(connectionId: string, force = false): Promise<PhonebookNameIndex> {
        const hit = phonebookCache.get(connectionId);
        if (!force && hit && Date.now() - hit.at < PHONEBOOK_CACHE_MS) return hit.index;

        const inst = evoInst(connectionId);
        const index = createPhonebookNameIndex();
        const tryExtract = (raw: unknown): any[] => {
            if (Array.isArray(raw)) return raw;
            if (!raw || typeof raw !== 'object') return [];
            const row = raw as Record<string, unknown>;
            for (const key of ['contacts', 'records', 'data', 'response'] as const) {
                const v = row[key];
                if (Array.isArray(v)) return v;
            }
            return [];
        };
        for (let page = 1; page <= 30; page++) {
            try {
                const response = await api.post(`/chat/findContacts/${inst}`, {
                    where: {},
                    page,
                    offset: 500,
                    limit: 500,
                });
                const list = tryExtract(response.data);
                if (list.length === 0) break;
                for (const ct of list) {
                    indexPhonebookRow(index, ct as Record<string, unknown>);
                }
                if (list.length < 500) break;
            } catch (err: any) {
                console.warn(`[EvolutionChat] findContacts phonebook ${connectionId} p${page}:`, err?.message || err);
                break;
            }
        }
        phonebookCache.set(connectionId, { at: Date.now(), index });
        return index;
    }

    function applyPhonebookNamesToConnection(connectionId: string, index: PhonebookNameIndex) {
        if (index.byJid.size === 0 && index.byPhone.size === 0) return;
        for (const c of conversations) {
            if (c.connectionId !== connectionId) continue;
            const parsed = parseConversationId(c.id);
            if (!parsed) continue;
            const book = resolvePhonebookName(index, {
                remoteJid: parsed.remoteJid,
                contactPhone: c.contactPhone,
                waJidAlt: c.waJidAlt
            });
            if (!book) continue;
            const next = pickContactDisplayName({
                waName: book,
                previous: c.contactName,
                fallback: c.contactPhone || 'Contato'
            });
            if (next !== c.contactName) c.contactName = next;
        }
    }

    /**
     * Tenta extrair um telefone real (não-LID) do registro da Evolution.
     * Conversas @lid não têm telefone no JID, mas a Evolution costuma enviar o número
     * real num campo alternativo (phoneNumber, number, jidAlt, pn, contact.phoneNumber etc.).
     * Retorna apenas dígitos plausíveis (10–13) — descarta LIDs longos.
     */
    function extractRealPhoneDigits(chat: any): string {
        if (!chat || typeof chat !== 'object') return '';
        const lastKey = chat?.lastMessage?.key;
        const candidates: unknown[] = [
            chat.phoneNumber,
            chat.number,
            chat.pn,
            chat.pnJid,
            chat.jidAlt,
            chat.altJid,
            chat.remoteJidAlt,
            lastKey?.remoteJidAlt,
            lastKey?.senderPn,
            lastKey?.participant,
            chat.contact?.phoneNumber,
            chat.contact?.number,
            chat.contact?.jid,
        ];
        for (const c of candidates) {
            if (c == null) continue;
            const digits = String(c).split('@')[0].replace(/\D/g, '');
            // Telefone plausível: 10–13 dígitos (BR/internacional), nunca LID longo (>15).
            if (digits.length >= 10 && digits.length <= 13) return digits;
        }
        return '';
    }

    function mapEvolutionChatToConversation(connectionId: string, chat: any): Conversation | null {
        const remoteJid = chatRemoteJid(chat);
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
            return null;
        }
        if (isGarbagePersonChatJid(remoteJid)) return null;

        // DIAGNÓSTICO @lid: registra os campos que a Evolution envia para conversas @lid
        // (sem telefone no JID), para descobrir onde está o número real. Limitado a 8 amostras/processo.
        if (remoteJid.endsWith('@lid') && lidDiagSamples < 8 && chat && typeof chat === 'object') {
            lidDiagSamples++;
            const keys = Object.keys(chat);
            const sample: Record<string, unknown> = {};
            for (const k of keys) {
                const v = (chat as Record<string, unknown>)[k];
                if (v == null) continue;
                if (typeof v === 'string') sample[k] = v.length > 80 ? `${v.slice(0, 80)}…(${v.length})` : v;
                else if (typeof v === 'number' || typeof v === 'boolean') sample[k] = v;
                else sample[k] = `[${typeof v}]`;
            }
            console.info(`[EvolutionChat][LID-DIAG ${lidDiagSamples}/8] ${connectionId} remoteJid=${remoteJid} keys=${keys.join(',')} sample=${JSON.stringify(sample)}`);
        }

        const jid = remoteJid;
        const id = buildConversationId(connectionId, jid);
        // Usa filterEvolutionName para ignorar nomes genéricos ("Contato", "Contact" etc.)
        // e cair para o próximo campo até chegar ao telefone como última instância.
        const waName =
            evolutionContactDisplayName(chat as Record<string, unknown>) ||
            filterEvolutionName(chat?.name) ||
            filterEvolutionName(chat?.chatName) ||
            filterEvolutionName(chat?.pushName) ||
            filterEvolutionName(chat?.contactName) ||
            filterEvolutionName(chat?.verifiedName) ||
            '';
        const lastMsgRaw = chat?.lastMessage || chat?.messages?.[0];
        const lastChatMsg = lastMsgRaw ? evolutionRawToChatMessage(lastMsgRaw, true) : null;
        const existing = conversations.find((c) => c.id === id);

        // resolveChatRowTimestampMs usa fallback 0 quando não há timestamp; nesse caso,
        // tenta preservar o existente ou usa Date.now() para que a conversa apareça na lista.
        const resolvedTs = resolveChatRowTimestampMs(chat, existing?.lastMessageTimestamp ?? 0);
        const tsMs =
            (lastChatMsg?.timestampMs && Number.isFinite(lastChatMsg.timestampMs)
                ? lastChatMsg.timestampMs
                : undefined) ??
            (resolvedTs > 0 ? resolvedTs : existing?.lastMessageTimestamp ?? 0);

        // contactPhone: usa o telefone do JID; se for @lid (sem telefone), tenta o número real
        // de campos alternativos para que a UI mostre o número e cruze com o CRM.
        const peer = peerFieldsFromEvolutionChatRow(chat as Record<string, unknown>, {
            contactPhone: existing?.contactPhone,
            waJidAlt: existing?.waJidAlt
        });
        const contactPhone = peer.contactPhone || existing?.contactPhone || '';
        const waJidAlt = peer.waJidAlt;
        const fallbackLabel =
            contactPhone || (jid.endsWith('@lid') ? 'Contato' : toPhoneDisplay(jid) || 'Contato');

        return {
            id,
            contactName: pickContactDisplayName({
                waName: waName || undefined,
                previous: existing?.contactName,
                fallback: fallbackLabel
            }),
            contactPhone,
            waJidAlt: waJidAlt || undefined,
            profilePicUrl: extractChatProfilePic(chat) || existing?.profilePicUrl,
            connectionId,
            unreadCount: Number(chat?.unreadCount ?? chat?.unread ?? existing?.unreadCount ?? 0) || 0,
            lastMessage: lastChatMsg?.text || existing?.lastMessage || '',
            lastMessageTime: tsMs > 0 ? lastChatMsg?.timestamp || formatTime(tsMs) : '',
            lastMessageTimestamp: tsMs,
            messages: existing?.messages || (lastChatMsg ? [lastChatMsg] : []),
            tags: existing?.tags || [],
        };
    }

    async function syncChatsForConnection(
        connectionId: string,
        opts?: { deferEmit?: boolean }
    ): Promise<number> {
        return withStoreLock(async () => {
        const inst = evoInst(connectionId);

        try {
            let chats = await fetchAllChatsPaginated(connectionId);
            if (chats.length === 0) {
                await new Promise((r) => setTimeout(r, 1500));
                chats = await fetchAllChatsPaginated(connectionId);
            }

            const phonebook = await fetchPhonebookNameIndex(connectionId, true);

            let added = 0;
            for (const chat of chats) {
                const conv = mapEvolutionChatToConversation(connectionId, chat);
                if (!conv) continue;
                const book = resolvePhonebookName(phonebook, {
                    remoteJid: parseConversationId(conv.id)?.remoteJid || '',
                    contactPhone: conv.contactPhone,
                    waJidAlt: conv.waJidAlt
                });
                if (book) {
                    conv.contactName = pickContactDisplayName({
                        waName: book,
                        previous: conv.contactName,
                        fallback: conv.contactPhone || 'Contato'
                    });
                }
                upsertConversation(conv, { skipArchive: true });
                added++;
            }

            // Prefetch de histórico para conversas com pouco/no cache local (prioriza as mais recentes).
            const sparseConvs = conversations
                .filter(
                    (c) =>
                        c.connectionId === connectionId &&
                        (!c.messages || c.messages.length <= 3)
                )
                .slice(0, 40);
            if (sparseConvs.length > 0) {
                await Promise.all(
                    sparseConvs.map(async (conv) => {
                        const parsed = parseConversationId(conv.id);
                        if (!parsed) return;
                        try {
                            const fetched = await fetchMessages(parsed.connectionId, parsed.remoteJid, 80);
                            const converted = fetched
                                .map((m) => evolutionRawToChatMessage(m, true))
                                .filter((m): m is ChatMessage => Boolean(m))
                                .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
                            if (converted.length === 0) return;
                            const target = conversations.find((c) => c.id === conv.id);
                            if (!target) return;
                            target.messages = converted.slice(-120);
                            const last = converted[converted.length - 1];
                            target.lastMessage = last.text || target.lastMessage;
                            target.lastMessageTime = last.timestamp || target.lastMessageTime;
                            target.lastMessageTimestamp = last.timestampMs || target.lastMessageTimestamp;
                            if (isLidJid(parsed.remoteJid)) {
                                const fromMsgs = peerFromStoredMessages(target.messages);
                                if (fromMsgs && hasResolvablePhone(fromMsgs)) {
                                    const merged = mergeLidPeerFields(parsed.remoteJid, fromMsgs, target);
                                    target.contactPhone = merged.contactPhone;
                                    target.waJidAlt = merged.waJidAlt;
                                }
                            }
                        } catch {
                            /* ignore por conversa */
                        }
                    })
                );
            }

            applyPhonebookNamesToConnection(connectionId, phonebook);

            const pruned = pruneGarbageConversations(connectionId);
            if (pruned > 0) {
                console.info(`[EvolutionChat] syncChats ${connectionId}: ${pruned} conversa(s) lixo removida(s)`);
            }

            for (const c of conversations) {
                if (c.connectionId !== connectionId) continue;
                const hasPreview = Boolean((c.lastMessage || '').trim());
                const hasMsgs = (c.messages?.length || 0) > 0;
                if (!hasPreview && !hasMsgs) {
                    c.lastMessageTimestamp = 0;
                    c.lastMessageTime = '';
                }
            }

            const pics = await enrichProfilePicturesForConnection(connectionId, opts);
            if (pics > 0) {
                console.info(`[EvolutionChat] syncChats ${connectionId}: ${pics} foto(s) de perfil carregada(s)`);
            }

            const lidFixed = await backfillLidConversationsForConnection(connectionId);
            if (lidFixed > 0) {
                console.info(`[EvolutionChat] syncChats ${connectionId}: ${lidFixed} chat(s) @lid com telefone resolvido`);
            }

            for (let i = 0; i < conversations.length; i++) {
                const c = conversations[i];
                if (c.connectionId !== connectionId) continue;
                const parsed = parseConversationId(c.id);
                if (!parsed) continue;
                conversations[i] = scrubInvalidConversationPhone(c, parsed.remoteJid);
            }
            if (ownerUidForScope) {
                const scopedIdx = conversations
                    .map((c, i) => (c.connectionId === connectionId ? i : -1))
                    .filter((i) => i >= 0);
                const scoped = scopedIdx.map((i) => conversations[i]);
                const withCrmPhones = await enrichConversationsWithCrmPhones(ownerUidForScope, scoped);
                const withCrmNames = await enrichConversationsWithCrmNames(ownerUidForScope, withCrmPhones);
                scopedIdx.forEach((idx, j) => {
                    conversations[idx] = withCrmNames[j] ?? conversations[idx];
                });
            }

            collapseStoredConversations();

            // findChats: lista grande — um conversations-update debounced (sync completo intencional).
            if (!opts?.deferEmit) emitConversationsUpdate();
            if (chats.length > 0 && added === 0) {
                console.warn(
                    `[EvolutionChat] syncChats ${connectionId}: ${chats.length} item(ns) da API, 0 conversas 1:1 mapeadas (grupos/@broadcast ou JID ilegível)`
                );
            } else if (added > 0) {
                console.info(`[EvolutionChat] syncChats ${connectionId}: ${added}/${chats.length} conversa(s) 1:1`);
            }
            return added;
        } catch (error: any) {
            console.warn(`[EvolutionChat] syncChats ${connectionId}:`, error?.message || error);
            return 0;
        }
        });
    }

    async function backfillLidConversationsForConnection(connectionId: string): Promise<number> {
        let updated = 0;
        for (const c of conversations) {
            if (c.connectionId !== connectionId || !c.id.includes('@lid')) continue;
            const parsed = parseConversationId(c.id);
            if (!parsed || !isLidJid(parsed.remoteJid)) continue;
            const current = mergeLidPeerFields(parsed.remoteJid, c);
            if (hasResolvablePhone(current)) continue;
            const fromStored = peerFromStoredMessages(c.messages);
            if (fromStored && hasResolvablePhone(fromStored)) {
                const merged = mergeLidPeerFields(parsed.remoteJid, fromStored, c);
                c.contactPhone = merged.contactPhone;
                c.waJidAlt = merged.waJidAlt;
                updated++;
                if (updated >= 40) break;
                continue;
            }
            const hit = await resolveLidPeerFromEvolutionApi(
                api,
                evoInst,
                connectionId,
                parsed.remoteJid
            );
            if (!hit || !hasResolvablePhone(hit)) continue;
            const merged = mergeLidPeerFields(parsed.remoteJid, hit, c);
            c.contactPhone = merged.contactPhone;
            c.waJidAlt = merged.waJidAlt;
            updated++;
            if (updated >= 40) break;
        }
        return updated;
    }

    async function ensureSendablePeer(
        conversationId: string,
        parsed: ParsedConversation
    ): Promise<{ contactPhone: string; waJidAlt?: string }> {
        const conv = conversations.find((c) => c.id === conversationId);
        let peer = mergeLidPeerFields(parsed.remoteJid, {
            contactPhone: conv?.contactPhone,
            waJidAlt: conv?.waJidAlt
        });
        if (isLidJid(parsed.remoteJid) && !hasResolvablePhone(peer)) {
            const fromStored = conv?.messages?.length ? peerFromStoredMessages(conv.messages) : null;
            if (fromStored && hasResolvablePhone(fromStored)) {
                peer = mergeLidPeerFields(parsed.remoteJid, fromStored, peer);
            }
        }
        if (isLidJid(parsed.remoteJid) && !hasResolvablePhone(peer) && ownerUidForScope) {
            const crmPeer = await resolveCrmPhonePeerForConversation(ownerUidForScope, {
                id: conversationId,
                contactName: conv?.contactName,
                contactPhone: conv?.contactPhone,
                waJidAlt: conv?.waJidAlt
            });
            if (crmPeer && hasResolvablePhone(crmPeer)) {
                peer = mergeLidPeerFields(parsed.remoteJid, crmPeer, peer);
            }
        }
        if (isLidJid(parsed.remoteJid) && !hasResolvablePhone(peer)) {
            const hit = await resolveLidPeerFromEvolutionApi(
                api,
                evoInst,
                parsed.connectionId,
                parsed.remoteJid
            );
            if (hit && hasResolvablePhone(hit)) {
                peer = mergeLidPeerFields(parsed.remoteJid, hit, peer);
            }
        }
        if (isLidJid(parsed.remoteJid) && !hasResolvablePhone(peer)) {
            try {
                const fetched = await fetchMessages(parsed.connectionId, parsed.remoteJid, 80);
                for (const m of fetched) {
                    const hit = peerFromRawMessageRecord(m as Record<string, unknown>);
                    if (hit && hasResolvablePhone(hit)) {
                        peer = mergeLidPeerFields(parsed.remoteJid, hit, peer);
                        break;
                    }
                }
            } catch {
                /* ignore */
            }
        }
        if (conv && hasResolvablePhone(peer)) {
            conv.contactPhone = peer.contactPhone;
            conv.waJidAlt = peer.waJidAlt;
        }
        return peer;
    }

    async function fetchMessages(
        connectionId: string,
        remoteJid: string,
        maxTotal: number,
        opts?: { beforeTimestampMs?: number }
    ): Promise<any[]> {
        const pageSize = 100;
        const maxPages = Math.min(80, Math.ceil(maxTotal / pageSize) + 3);
        const collected: any[] = [];
        const seen = new Set<string>();

        try {
            for (let page = 1; page <= maxPages && collected.length < maxTotal; page++) {
                const keyWhere: Record<string, unknown> = { remoteJid };
                if (opts?.beforeTimestampMs && opts.beforeTimestampMs > 0) {
                    const sec = Math.floor(opts.beforeTimestampMs / 1000);
                    keyWhere.messageTimestamp = { lte: String(sec) };
                }
                const body = {
                    where: { key: keyWhere },
                    page,
                    offset: pageSize,
                    limit: pageSize,
                };
                const response = await api.post(
                    `/chat/findMessages/${evoInst(connectionId)}`,
                    body
                );
                const { records, pages, currentPage } = extractFindMessagesRecords(response.data);
                if (records.length === 0) break;

                for (const m of records) {
                    const jid = String(m?.key?.remoteJid || m?.remoteJid || '');
                    if (jid && jid !== remoteJid) continue;
                    const id = String(m?.key?.id || m?.id || '');
                    if (id) {
                        if (seen.has(id)) continue;
                        seen.add(id);
                    }
                    collected.push(m);
                }

                if (currentPage >= pages || records.length < pageSize) break;
            }

            return collected
                .sort(
                    (a, b) =>
                        (Number(a?.messageTimestamp || a?.key?.messageTimestamp || 0) || 0) -
                        (Number(b?.messageTimestamp || b?.key?.messageTimestamp || 0) || 0)
                )
                .slice(-maxTotal);
        } catch (error: any) {
            console.warn(`[EvolutionChat] findMessages ${connectionId}:`, error?.message || error);
            return [];
        }
    }

    function handleWebhookMessage(instance: string, data: any) {
        // Evolution v2 pode mandar `data` em 3 formatos:
        //   1) { messages: [ { key, message, ... } ] }
        //   2) array direto: [ { key, message, ... }, ... ]
        //   3) objeto unico: { key, message, ... }
        // Antes, fallback `msg = data` quando data era array nao tinha .key
        // e a mensagem era descartada silenciosamente — pipeline ficava vazio.
        const items: any[] = Array.isArray(data)
            ? data
            : Array.isArray(data?.messages)
                ? data.messages
                : data?.key
                    ? [data]
                    : [];
        if (items.length === 0) return;

        const touched = new Set<string>();
        for (const msg of items) {
            if (!msg?.key) continue;

            const remoteJid = String(msg.key.remoteJid || '');
            if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue;

            let conversationId = buildConversationId(instance, remoteJid);
            const chatMsg = evolutionRawToChatMessage(msg, true);
            if (!chatMsg) continue;

            const pushName = msg.pushName || remoteJid.split('@')[0];
            const rawPeer = peerFromRawMessageRecord(msg as Record<string, unknown>);
            const phoneDigits = rawPeer
                ? normalizePhoneDigits(rawPeer.contactPhone)
                : resolvePhoneDigitsFromEvolutionMessage(
                      { key: msg.key },
                      { getConversations: () => conversations },
                      instance
                  );
            conversationId = resolveCanonicalConversationId(instance, conversationId, {
                contactPhone: phoneDigits.length >= 8 ? `+${phoneDigits}` : rawPeer?.contactPhone,
                waJidAlt: rawPeer?.waJidAlt || chatMsg.waRemoteJidAlt || chatMsg.waSenderPn
            });
            appendMessageToConversation(conversationId, chatMsg, {
                connectionId: instance,
                contactName: String(pushName),
                contactPhone: phoneDigits.length >= 8 ? `+${phoneDigits}` : rawPeer?.contactPhone || '',
                waJidAlt: rawPeer?.waJidAlt || chatMsg.waRemoteJidAlt || chatMsg.waSenderPn,
                incrementUnread: !msg.key.fromMe,
            });
            touched.add(conversationId);
        }
        for (const id of touched) emitConversationDelta(id);
    }

    function updateMessageStatus(messageId: string, evolutionStatus: number) {
        const touched = new Set<string>();
        for (const conv of conversations) {
            const msg = conv.messages.find((m) => messageIdsMatch(m.id, messageId));
            if (!msg || msg.sender !== 'me') continue;
            if (evolutionStatus >= 4 && msg.status !== 'read') {
                msg.status = 'read';
                touched.add(conv.id);
            } else if (evolutionStatus >= 3) {
                if (msg.status === 'sent') msg.status = 'delivered';
                else if (msg.status === 'delivered' && evolutionStatus >= 4) msg.status = 'read';
                touched.add(conv.id);
            } else if (evolutionStatus >= 2 && msg.status === 'sent') {
                msg.status = 'delivered';
                touched.add(conv.id);
            }
        }
        for (const id of touched) emitConversationDelta(id);
    }

    function applyPresenceFields(
        conv: Conversation,
        presence: WaContactPresence,
        lastSeenMs: number | undefined,
        updatedAt: number
    ): void {
        conv.waPresence = presence;
        conv.waPresenceUpdatedAt = updatedAt;
        if (lastSeenMs != null && Number.isFinite(lastSeenMs)) {
            conv.waLastSeenMs = lastSeenMs;
        } else if (presence === 'unavailable' || presence === 'paused') {
            conv.waLastSeenMs = conv.waLastSeenMs ?? updatedAt;
        }
    }

    function handlePresenceUpdate(instance: string, data: unknown, eventDateIso?: string): void {
        const batch = parseEvolutionPresenceWebhook(data, eventDateIso);
        if (!batch || batch.entries.length === 0) return;

        const touched = new Set<string>();
        for (const entry of batch.entries) {
            let conversationId = buildConversationId(instance, entry.remoteJid);
            const existing = conversations.find((c) => c.id === conversationId);
            conversationId = resolveCanonicalConversationId(
                instance,
                conversationId,
                existing
                    ? { contactPhone: existing.contactPhone, waJidAlt: existing.waJidAlt }
                    : undefined
            );
            const conv = conversations.find((c) => c.id === conversationId);
            if (!conv) continue;

            applyPresenceFields(conv, entry.presence, entry.lastSeenMs, batch.updatedAt);
            touched.add(conversationId);
        }
        for (const id of touched) emitConversationDelta(id);
    }

    async function sendMessage(conversationId: string, text: string): Promise<void> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) throw new Error('conversationId inválido');
        const trimmed = String(text || '').trim();
        if (!trimmed) throw new Error('Mensagem vazia.');

        const peer = await ensureSendablePeer(conversationId, parsed);
        const { number } = resolveOutboundSendTarget(parsed.remoteJid, peer);

        let response: { data?: { key?: { id?: string; _serialized?: string } } };
        try {
            response = await api.post(`/message/sendText/${evoInst(parsed.connectionId)}`, {
                number,
                text: trimmed,
                delay: 1200,
            });
        } catch (err) {
            throw new Error(formatEvolutionHttpError(err));
        }
        const messageId = response.data?.key?.id || response.data?.key?._serialized;
        const nowMs = Date.now();

        const newMsg: ChatMessage = {
            id: messageId ? String(messageId) : `${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
            text: trimmed,
            timestamp: formatTime(nowMs),
            sender: 'me',
            status: 'sent',
            type: 'text',
            timestampMs: nowMs,
        };

        const effectiveId = buildConversationId(parsed.connectionId, parsed.remoteJid);
        const convAfter = conversations.find((c) => c.id === conversationId);
        appendMessageToConversation(effectiveId, newMsg, {
            connectionId: parsed.connectionId,
            contactPhone: peer.contactPhone || convAfter?.contactPhone || '',
            waJidAlt: peer.waJidAlt || convAfter?.waJidAlt,
        });
        emitConversationDelta(effectiveId);
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

        const peer = await ensureSendablePeer(conversationId, parsed);
        const { number } = resolveOutboundSendTarget(parsed.remoteJid, peer);
        const { url } = await saveMediaFromBase64(payload.dataBase64, payload.mimeType, payload.fileName);

        let type = 'document';
        if (!payload.sendMediaAsDocument) {
            if (payload.mimeType.startsWith('image/')) type = 'image';
            else if (payload.mimeType.startsWith('video/')) type = 'video';
            else if (payload.mimeType.startsWith('audio/')) type = 'audio';
        }

        let response: { data?: { key?: { id?: string; _serialized?: string } } };
        try {
            response = await api.post(`/message/sendMedia/${evoInst(parsed.connectionId)}`, {
                number,
                delay: 1200,
                mediatype: type,
                mimetype: payload.mimeType,
                caption: payload.caption || '',
                media: url,
                fileName: payload.fileName,
            });
        } catch (err) {
            throw new Error(formatEvolutionHttpError(err));
        }

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

        const convAfter = conversations.find((c) => c.id === conversationId);
        appendMessageToConversation(buildConversationId(parsed.connectionId, parsed.remoteJid), newMsg, {
            connectionId: parsed.connectionId,
            contactPhone: peer.contactPhone || convAfter?.contactPhone || '',
            waJidAlt: peer.waJidAlt || convAfter?.waJidAlt,
        });
        emitConversationDelta(buildConversationId(parsed.connectionId, parsed.remoteJid));
    }

    async function hydrateChatArchiveForConversation(
        conversationId: string,
        historyLimit = 400
    ): Promise<{ ok: boolean; total: number; error?: string }> {
        if (!archiveCtx) {
            return { ok: false, total: 0, error: 'Arquivo de chat indisponível.' };
        }
        return mergeHydrateChatArchive(conversationId, historyLimit, evoChatArchiveHooks());
    }

    async function loadChatHistory(
        conversationId: string,
        limit = 500,
        skipMedia = true
    ): Promise<{ ok: boolean; total: number; error?: string }> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) return { ok: false, total: 0, error: 'conversationId inválido.' };

        if (archiveCtx) {
            await mergeChatArchiveIntoConversation(conversationId, limit, evoChatArchiveHooks());
        }

        const requested = Math.max(50, Math.min(limit, MAX_MESSAGES));
        let conv = conversations.find((c) => c.id === conversationId);
        const oldestLocalMs =
            conv?.messages?.length && conv.messages.length > 0
                ? Math.min(...conv.messages.map((m) => m.timestampMs || 0).filter((t) => t > 0))
                : undefined;

        let fetched = await fetchMessages(parsed.connectionId, parsed.remoteJid, requested);
        const beforeMerge = conv?.messages?.length || 0;

        // Segunda passagem: mensagens mais antigas que as já em cache (paginação real no DB Evolution).
        if (oldestLocalMs && oldestLocalMs > 0 && beforeMerge > 0) {
            const older = await fetchMessages(parsed.connectionId, parsed.remoteJid, requested, {
                beforeTimestampMs: oldestLocalMs - 1,
            });
            if (older.length > 0) {
                const byId = new Map<string, any>();
                for (const m of [...fetched, ...older]) {
                    const id = String(m?.key?.id || m?.id || '');
                    if (id) byId.set(id, m);
                    else byId.set(`${Math.random()}`, m);
                }
                fetched = Array.from(byId.values());
            }
        }

        conv = conversations.find((c) => c.id === conversationId);
        if (conv && isLidJid(parsed.remoteJid)) {
            for (const m of fetched) {
                const hit = peerFromRawMessageRecord(m as Record<string, unknown>);
                if (hit && hasResolvablePhone(hit)) {
                    const merged = mergeLidPeerFields(parsed.remoteJid, hit, conv);
                    conv.contactPhone = merged.contactPhone;
                    conv.waJidAlt = merged.waJidAlt;
                    break;
                }
            }
            if (!hasResolvablePhone(mergeLidPeerFields(parsed.remoteJid, conv))) {
                const apiHit = await resolveLidPeerFromEvolutionApi(
                    api,
                    evoInst,
                    parsed.connectionId,
                    parsed.remoteJid
                );
                if (apiHit && hasResolvablePhone(apiHit)) {
                    const merged = mergeLidPeerFields(parsed.remoteJid, apiHit, conv);
                    conv.contactPhone = merged.contactPhone;
                    conv.waJidAlt = merged.waJidAlt;
                }
            }
        }

        const converted = fetched
            .map((m) => evolutionRawToChatMessage(m, skipMedia))
            .filter((m): m is ChatMessage => Boolean(m))
            .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));

        conv = conversations.find((c) => c.id === conversationId);
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

        const phonebook = await fetchPhonebookNameIndex(parsed.connectionId);
        const book = resolvePhonebookName(phonebook, {
            remoteJid: parsed.remoteJid,
            contactPhone: conv.contactPhone,
            waJidAlt: conv.waJidAlt
        });
        if (book) {
            conv.contactName = pickContactDisplayName({
                waName: book,
                previous: conv.contactName,
                fallback: conv.contactPhone || 'Contato'
            });
        }

        const byId = new Map<string, ChatMessage>();
        for (const m of converted) byId.set(m.id, m);
        for (const m of conv.messages) {
            const existing = byId.get(m.id);
            if (existing) {
                if (m.fromCampaign) existing.fromCampaign = m.fromCampaign;
                if (m.campaignId) existing.campaignId = m.campaignId;
                if (m.mediaUrl && !existing.mediaUrl) existing.mediaUrl = m.mediaUrl;
                if (m.waRemoteJidAlt && !existing.waRemoteJidAlt) existing.waRemoteJidAlt = m.waRemoteJidAlt;
                if (m.waSenderPn && !existing.waSenderPn) existing.waSenderPn = m.waSenderPn;
            } else {
                byId.set(m.id, m);
            }
        }
        conv.messages = Array.from(byId.values())
            .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0))
            .slice(-MAX_MESSAGES);
        if (isLidJid(parsed.remoteJid)) {
            const fromMsgs = peerFromStoredMessages(conv.messages);
            if (fromMsgs && hasResolvablePhone(fromMsgs)) {
                const merged = mergeLidPeerFields(parsed.remoteJid, fromMsgs, conv);
                conv.contactPhone = merged.contactPhone;
                conv.waJidAlt = merged.waJidAlt;
            }
        }
        emitConversationDelta(conversationId);
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
            const response = await api.post(`/chat/getBase64FromMediaMessage/${evoInst(parsed.connectionId)}`, {
                message: match,
            });
            const base64 = response.data?.base64 || response.data?.data;
            const mime = response.data?.mimetype || response.data?.mimeType || 'application/octet-stream';
            if (base64) {
                const mediaUrl = `data:${mime};base64,${base64}`;
                if (local) {
                    local.mediaUrl = mediaUrl;
                    emitConversationDelta(conversationId);
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
                emitConversationDelta(conversationId);
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
            emitConversationDelta(conversationId);
        }

        const unreadThem = (conv?.messages || []).filter((m) => m.sender === 'them').slice(-5);
        if (unreadThem.length === 0) return;

        try {
            await api.post(`/chat/markMessageAsRead/${evoInst(parsed.connectionId)}`, {
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

    async function fetchConversationPicture(
        conversationId: string,
        opts?: { silentEmit?: boolean }
    ): Promise<string | null> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) return null;

        const conv = conversations.find((c) => c.id === conversationId);
        if (conv?.profilePicUrl?.startsWith('data:')) return conv.profilePicUrl;
        if (conv?.profilePicUrl?.startsWith('http')) {
            const mirrored = await normalizeProfilePictureUrl(conv.profilePicUrl);
            if (mirrored) {
                conv.profilePicUrl = mirrored;
                if (!opts?.silentEmit) emitConversationDelta(conversationId);
                return mirrored;
            }
        }

        const inst = evoInst(parsed.connectionId);
        const remoteJid = parsed.remoteJid;
        const numberCandidates = [
            remoteJid,
            remoteJid.replace(/@.+$/, ''),
            remoteJid.replace(/@.+$/, '').replace(/\D/g, ''),
        ].filter((n, i, arr) => n && arr.indexOf(n) === i);

        for (const number of numberCandidates) {
            try {
                const response = await api.post(`/chat/fetchProfilePictureUrl/${inst}`, { number });
                const pic = await normalizeProfilePictureUrl(parseProfilePicturePayload(response.data));
                if (pic) {
                    if (conv) {
                        conv.profilePicUrl = pic;
                        if (!opts?.silentEmit) emitConversationDelta(conversationId);
                    }
                    return pic;
                }
            } catch {
                /* tenta próximo formato */
            }
        }

        try {
            const response = await api.post(`/chat/fetchProfile/${inst}`, { number: remoteJid });
            const pic = await normalizeProfilePictureUrl(parseProfilePicturePayload(response.data));
            if (pic) {
                if (conv) {
                    conv.profilePicUrl = pic;
                    if (!opts?.silentEmit) emitConversationDelta(conversationId);
                }
                return pic;
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
        if (removed > 0) emitConversationsRemoved(conversationIds);
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
        emitConversationDelta,
        syncChatsForConnection,
        enrichProfilePicturesForConnection,
        handleWebhookMessage,
        handlePresenceUpdate,
        appendCampaignOutboundMessage,
        updateMessageStatus,
        sendMessage,
        sendMedia,
        loadChatHistory,
        hydrateChatArchiveForConversation,
        loadMessageMedia,
        markAsRead,
        fetchConversationPicture,
        resolveConversationIdForPhone,
        deleteLocalConversations,
        purgeConversationsForConnection,
    };
}

export type EvolutionChatStore = ReturnType<typeof createEvolutionChat>;
