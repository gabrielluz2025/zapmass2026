import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useZapMassCore, useZapMassConversations } from '../../context/ZapMassContext';
import { dedupeConversationsById } from '../../utils/conversationInboxTrim';
import { OPEN_CHAT_BY_CONVERSATION_ID_KEY } from '../../utils/openChatByConversationIdNav';
import { normPhoneKey } from '../../utils/brPhoneNormalize';
import {
  buildPhoneDigitLookupKeys,
  normalizePhoneDigits
} from '../../utils/contactPhoneLookup';
import type { Conversation } from '../../types';
import { WaInbox } from './WaInbox';
import { WaThread } from './WaThread';
import { useWaRealtime } from './hooks/useWaRealtime';
import {
  avatarUrl,
  buildDisplayIndex,
  phoneRawForContactLookup,
  unreadCount
} from './lib/conversationDisplay';
import '../../styles/wa-web-v2.css';

export const WaWebChatApp: React.FC<{
  autoSelectedConversationId?: string | null;
  onClearAutoSelected?: () => void;
}> = ({ autoSelectedConversationId, onClearAutoSelected }) => {
  const conversations = useZapMassConversations();
  const {
    contacts,
    connections,
    sendMessage,
    markAsRead,
    loadChatHistory,
    fetchConversationPicture,
    socket,
    isBackendConnected
  } = useZapMassCore();

  const connectedChannels = useMemo(
    () => connections.filter((c) => c.status === 'CONNECTED'),
    [connections]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyExhausted, setHistoryExhausted] = useState<Record<string, boolean>>({});
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const pictureFetchedRef = useRef<Set<string>>(new Set());
  const historyRequestedRef = useRef<Map<string, number>>(new Map());
  const HISTORY_LEVELS = [200, 600, 1500, 3500, 8000];

  const requestSync = useCallback(() => {
    if (socket?.connected) socket.emit('request-conversations-sync');
  }, [socket]);

  const { status: connectionStatus } = useWaRealtime(socket, requestSync);
  const live = connectionStatus === 'online' && isBackendConnected;

  useEffect(() => {
    requestSync();
  }, [requestSync, connectedChannels.map((c) => c.id).sort().join('|')]);

  const sortedConversations = useMemo(() => {
    const list = dedupeConversationsById(conversations);
    return [...list].sort((a, b) => {
      const ta = a.lastMessageTimestamp ?? 0;
      const tb = b.lastMessageTimestamp ?? 0;
      return tb - ta;
    });
  }, [conversations]);

  const displayById = useMemo(
    () => buildDisplayIndex(sortedConversations, contacts),
    [sortedConversations, contacts]
  );

  const profilePicByPhoneKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const ct of contacts) {
      const pic = ct.profilePicUrl;
      if (!pic) continue;
      const digits = normalizePhoneDigits(ct.phone || '');
      const nk = normPhoneKey(ct.phone || '');
      if (nk) map.set(nk, pic);
      for (const key of buildPhoneDigitLookupKeys(digits)) {
        if (!map.has(key)) map.set(key, pic);
      }
    }
    return map;
  }, [contacts]);

  const avatarById = useMemo(() => {
    const map = new Map<string, string>();
    for (const conv of sortedConversations) {
      const primary = displayById.get(conv.id)?.primary ?? 'Contato';
      let pic = conv.profilePicUrl;
      if (!pic) {
        const raw = phoneRawForContactLookup(conv);
        const nk = normPhoneKey(raw);
        if (nk) pic = profilePicByPhoneKey.get(nk);
        if (!pic) {
          const d = normalizePhoneDigits(raw);
          for (const key of buildPhoneDigitLookupKeys(d)) {
            const hit = profilePicByPhoneKey.get(key);
            if (hit) {
              pic = hit;
              break;
            }
          }
        }
      }
      map.set(conv.id, avatarUrl(primary, pic));
    }
    return map;
  }, [sortedConversations, displayById, profilePicByPhoneKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedConversations.filter((c) => {
      if (unreadOnly && unreadCount(c) === 0) return false;
      if (!q) return true;
      const disp = displayById.get(c.id);
      const primary = disp?.primary?.toLowerCase() ?? '';
      const sub = disp?.whatsappSubtitle?.toLowerCase() ?? '';
      const phone = (c.contactPhone || '').toLowerCase();
      const preview = (c.lastMessage || '').toLowerCase();
      return primary.includes(q) || sub.includes(q) || phone.includes(q) || preview.includes(q);
    });
  }, [sortedConversations, search, unreadOnly, displayById]);

  const selected = useMemo(
    () => sortedConversations.find((c) => c.id === selectedId) ?? null,
    [sortedConversations, selectedId]
  );

  const selectChat = useCallback(
    (id: string) => {
      setSelectedId(id);
      setMobileShowThread(true);
      markAsRead(id);
    },
    [markAsRead]
  );

  useEffect(() => {
    let id = autoSelectedConversationId?.trim() || '';
    if (!id) {
      try {
        id = sessionStorage.getItem(OPEN_CHAT_BY_CONVERSATION_ID_KEY)?.trim() || '';
      } catch {
        id = '';
      }
    }
    if (!id) return;
    const hit = sortedConversations.find((c) => c.id === id);
    if (hit) {
      selectChat(hit.id);
      try {
        sessionStorage.removeItem(OPEN_CHAT_BY_CONVERSATION_ID_KEY);
      } catch {
        /* ignore */
      }
      onClearAutoSelected?.();
    }
  }, [autoSelectedConversationId, sortedConversations, selectChat, onClearAutoSelected]);

  useEffect(() => {
    if (!selected?.id || selected.profilePicUrl) return;
    if (pictureFetchedRef.current.has(selected.id)) return;
    pictureFetchedRef.current.add(selected.id);
    fetchConversationPicture(selected.id);
  }, [selected?.id, selected?.profilePicUrl, fetchConversationPicture]);

  const loadMoreHistory = useCallback(
    async (conversationId: string, silent = false) => {
      if (!conversationId || historyExhausted[conversationId]) return;
      const current = historyRequestedRef.current.get(conversationId) || 0;
      const nextLevel =
        HISTORY_LEVELS.find((lvl) => lvl > current) || HISTORY_LEVELS[HISTORY_LEVELS.length - 1];
      if (nextLevel === current) return;

      historyRequestedRef.current.set(conversationId, nextLevel);
      setLoadingHistory(true);
      const prevCount =
        sortedConversations.find((c) => c.id === conversationId)?.messages.length || 0;
      try {
        const res = await loadChatHistory(
          conversationId,
          Math.max(nextLevel, prevCount + 50),
          false
        );
        if (!res.ok) {
          const suppressed = [
            'Conversa nao encontrada.',
            'Chat nao encontrado no cliente.',
            'Canal desconectado.'
          ];
          if (res.error && !silent && !suppressed.includes(res.error)) {
            toast.error(res.error);
          }
          return;
        }
        const grew = res.total > prevCount;
        if (!grew && nextLevel >= HISTORY_LEVELS[HISTORY_LEVELS.length - 1]) {
          setHistoryExhausted((prev) => ({ ...prev, [conversationId]: true }));
        } else if (grew) {
          setHistoryExhausted((prev) => {
            const next = { ...prev };
            delete next[conversationId];
            return next;
          });
        }
      } finally {
        setLoadingHistory(false);
      }
    },
    [historyExhausted, loadChatHistory, sortedConversations]
  );

  useEffect(() => {
    if (!selected?.id || !socket?.connected) return;
    const msgCount = selected.messages?.length ?? 0;
    if (msgCount < 30) void loadMoreHistory(selected.id, true);
  }, [selected?.id, selected?.messages?.length, socket?.connected, loadMoreHistory]);

  const loadOlder = useCallback(() => {
    if (selected?.id) void loadMoreHistory(selected.id);
  }, [selected?.id, loadMoreHistory]);

  const handleSend = useCallback(
    (text: string) => {
      if (!selected?.id) return;
      if (connectedChannels.length === 0) {
        toast.error('Nenhum chip WhatsApp conectado.');
        return;
      }
      sendMessage(selected.id, text);
    },
    [selected?.id, connectedChannels.length, sendMessage]
  );

  const handleRefresh = useCallback(() => {
    requestSync();
    toast.success('Sincronizando conversas…', { duration: 2000 });
  }, [requestSync]);

  return (
    <div className="wa-v2-root flex h-[calc(100vh-5.5rem)] min-h-[480px] rounded-xl overflow-hidden border border-[#e9edef] shadow-lg">
      <WaInbox
        conversations={filtered}
        allConversations={sortedConversations}
        displayById={displayById}
        avatarById={avatarById}
        selectedId={selectedId}
        search={search}
        unreadOnly={unreadOnly}
        connectionStatus={live ? 'online' : 'offline'}
        chipsConnected={connectedChannels.length}
        onSearch={setSearch}
        onToggleUnread={() => setUnreadOnly((v) => !v)}
        onRefresh={handleRefresh}
        onSelect={selectChat}
        hideOnMobile={mobileShowThread}
      />

      <WaThread
        conversation={selected}
        display={selected ? displayById.get(selected.id) ?? null : null}
        avatarSrc={selected ? avatarById.get(selected.id) || '' : ''}
        loadingHistory={loadingHistory}
        historyExhausted={selected ? !!historyExhausted[selected.id] : true}
        canSend={!!selected && connectedChannels.length > 0}
        showBack={mobileShowThread}
        onBack={() => setMobileShowThread(false)}
        onLoadOlder={loadOlder}
        onSend={handleSend}
        hideOnMobile={!mobileShowThread}
      />
    </div>
  );
};

export default WaWebChatApp;
