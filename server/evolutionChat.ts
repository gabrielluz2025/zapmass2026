import type { AxiosInstance } from 'axios';
import type { Server as SocketIOServer } from 'socket.io';
import { Conversation, ChatMessage } from './types.js';
import { extractEvolutionReplyBody } from './replyFlowEngine.js';
import { saveMediaFromBase64 } from './mediaStorage.js';
import { prepareConversationsForSocketEmit } from './conversationsEmit.js';
import { chatRemoteJidFromFindChatsRow, formatChatListTime, isGarbagePersonChatJid, resolveChatRowTimestampMs } from './evolutionChatJid.js';

const MAX_MESSAGES = 10000;

type ParsedConversation = { connectionId: string; chatPart: string; remoteJid: string };

function evoInst(instanceName: string): string {
    return encodeURIComponent(String(instanceName || '').trim());
}

export function createEvolutionChat(api: AxiosInstance) {
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
    /** Contador de amostras de diagnóstico de conversas @lid (cap p/ não floodar logs). */
    let lidDiagSamples = 0;
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
        // Debounce: agrupa emits rápidos em lote (ex: sync de 800+ conversas → 1 emit ao final).
        if (emitDebounceTimer) clearTimeout(emitDebounceTimer);
        emitDebounceTimer = setTimeout(() => {
            emitDebounceTimer = null;
            if (!io || !ownerUidForScope) return;
            io.to(`user:${ownerUidForScope}`).emit(
                'conversations-update',
                prepareConversationsForSocketEmit(conversations)
            );
        }, 80);
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
            const prev = conversations[idx];
            const prevTs = prev.lastMessageTimestamp || 0;
            const convTs = conv.lastMessageTimestamp || 0;
            const bestTs = Math.max(prevTs, convTs);
            const newerFromConv = convTs >= prevTs;
            conversations[idx] = {
                ...prev,
                ...conv,
                contactName: conv.contactName || prev.contactName,
                contactPhone: conv.contactPhone || prev.contactPhone,
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
    }

    function appendMessageToConversation(
        conversationId: string,
        msg: ChatMessage,
        meta?: { contactName?: string; contactPhone?: string; connectionId?: string; incrementUnread?: boolean }
    ) {
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
                limit: 1000,
            });
            const list = tryExtract(response.data);
            for (const ct of list) {
                const row = ct as Record<string, unknown>;
                const jid = chatRemoteJidFromFindChatsRow(row);
                if (!jid || seen.has(jid) || jid.endsWith('@g.us') || isGarbagePersonChatJid(jid)) continue;
                seen.add(jid);
                out.push({
                    ...row,
                    remoteJid: jid,
                    name: row.pushName || row.name || row.verifiedName,
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
        for (let i = 0; i < Math.min(targets.length, 300); i += batchSize) {
            const slice = targets.slice(i, i + batchSize);
            const results = await Promise.all(slice.map((c) => fetchConversationPicture(c.id)));
            fetched += results.filter(Boolean).length;
        }
        if (fetched > 0 && !opts?.deferEmit) emitConversationsUpdate();
        return fetched;
    }

    /**
     * Filtra nomes genéricos/inválidos que a Evolution API retorna quando não encontra o nome real do contato.
     * Retorna undefined para que o próximo campo na cadeia seja tentado.
     */
    function filterEvolutionName(raw: unknown): string | undefined {
        if (typeof raw !== 'string') return undefined;
        const t = raw.trim();
        if (!t) return undefined;
        const lower = t.toLowerCase();
        // Nomes genéricos/padrão que não identificam o contato
        if (lower === 'contato' || lower === 'contact' || lower === 'unknown' || lower === 'desconhecido') return undefined;
        return t;
    }

    /**
     * Tenta extrair um telefone real (não-LID) do registro da Evolution.
     * Conversas @lid não têm telefone no JID, mas a Evolution costuma enviar o número
     * real num campo alternativo (phoneNumber, number, jidAlt, pn, contact.phoneNumber etc.).
     * Retorna apenas dígitos plausíveis (10–13) — descarta LIDs longos.
     */
    function extractRealPhoneDigits(chat: any): string {
        if (!chat || typeof chat !== 'object') return '';
        const candidates: unknown[] = [
            chat.phoneNumber,
            chat.number,
            chat.pn,
            chat.pnJid,
            chat.jidAlt,
            chat.altJid,
            chat.remoteJidAlt,
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
        const name =
            filterEvolutionName(chat?.name) ||
            filterEvolutionName(chat?.chatName) ||
            filterEvolutionName(chat?.pushName) ||
            filterEvolutionName(chat?.contactName) ||
            filterEvolutionName(chat?.verifiedName) ||
            jid.split('@')[0];
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
        const jidPhone = toPhoneDisplay(jid);
        const altPhoneDigits = jidPhone ? '' : extractRealPhoneDigits(chat);
        const contactPhone = jidPhone || (altPhoneDigits ? `+${altPhoneDigits}` : '') || existing?.contactPhone || '';

        return {
            id,
            contactName: String(name),
            contactPhone,
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

            let added = 0;
            for (const chat of chats) {
                const conv = mapEvolutionChatToConversation(connectionId, chat);
                if (!conv) continue;
                upsertConversation(conv);
                added++;
            }

            // findChats nem sempre traz lastMessage — busca histórico recente para as primeiras conversas.
            // Limite de 10 (era 35) para acelerar o sync inicial e não travar em 800+ contatos.
            const emptyConvs = conversations
                .filter((c) => c.connectionId === connectionId && (!c.messages || c.messages.length === 0))
                .slice(0, 10);
            if (emptyConvs.length > 0) {
                await Promise.all(
                    emptyConvs.map(async (conv) => {
                        const parsed = parseConversationId(conv.id);
                        if (!parsed) return;
                        try {
                            const fetched = await fetchMessages(parsed.connectionId, parsed.remoteJid, 30);
                            const converted = fetched
                                .map((m) => evolutionRawToChatMessage(m, true))
                                .filter((m): m is ChatMessage => Boolean(m))
                                .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
                            if (converted.length === 0) return;
                            const target = conversations.find((c) => c.id === conv.id);
                            if (!target) return;
                            target.messages = converted.slice(-80);
                            const last = converted[converted.length - 1];
                            target.lastMessage = last.text || target.lastMessage;
                            target.lastMessageTime = last.timestamp || target.lastMessageTime;
                            target.lastMessageTimestamp = last.timestampMs || target.lastMessageTimestamp;
                        } catch {
                            /* ignore por conversa */
                        }
                    })
                );
            }

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

    async function fetchMessages(connectionId: string, remoteJid: string, limit: number): Promise<any[]> {
        const body = {
            where: { key: { remoteJid } },
            limit,
            page: 1,
        };
        try {
            const response = await api.post(`/chat/findMessages/${evoInst(connectionId)}`, body);
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

        let appended = false;
        for (const msg of items) {
            if (!msg?.key) continue;

            const remoteJid = String(msg.key.remoteJid || '');
            if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue;

            const conversationId = buildConversationId(instance, remoteJid);
            const chatMsg = evolutionRawToChatMessage(msg, true);
            if (!chatMsg) continue;

            const pushName = msg.pushName || remoteJid.split('@')[0];
            appendMessageToConversation(conversationId, chatMsg, {
                connectionId: instance,
                contactName: String(pushName),
                contactPhone: toPhoneDisplay(remoteJid),
                incrementUnread: !msg.key.fromMe,
            });
            appended = true;
        }
        if (appended) emitConversationsUpdate();
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
        const response = await api.post(`/message/sendText/${evoInst(parsed.connectionId)}`, {
            number,
            text,
            textMessage: {
                text
            },
            delay: 1200,
        });
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

        // Evolution API v2: campos na raiz (SendMediaDto extends Metadata), sem wrapper mediaMessage
        const response = await api.post(`/message/sendMedia/${evoInst(parsed.connectionId)}`, {
            number,
            delay: 1200,
            mediatype: type,
            mimetype: payload.mimeType,
            caption: payload.caption || '',
            media: url,
            fileName: payload.fileName,
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
            const response = await api.post(`/chat/getBase64FromMediaMessage/${evoInst(parsed.connectionId)}`, {
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

    async function fetchConversationPicture(conversationId: string): Promise<string | null> {
        const parsed = parseConversationId(conversationId);
        if (!parsed) return null;

        const conv = conversations.find((c) => c.id === conversationId);
        if (conv?.profilePicUrl?.startsWith('data:')) return conv.profilePicUrl;
        if (conv?.profilePicUrl?.startsWith('http')) {
            const mirrored = await normalizeProfilePictureUrl(conv.profilePicUrl);
            if (mirrored) {
                conv.profilePicUrl = mirrored;
                emitConversationsUpdate();
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
                        emitConversationsUpdate();
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
                    emitConversationsUpdate();
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
        enrichProfilePicturesForConnection,
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
