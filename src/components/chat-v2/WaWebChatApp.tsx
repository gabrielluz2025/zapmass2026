import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import {
  useZapMassCore,
  useZapMassConversations,
  useZapMassInboxPagination,
} from '../../context/ZapMassContext';
import { ClientCrmPanel } from '../chat/ClientCrmPanel';
import { WaContactDrawer } from '../chat/wa/WaContactDrawer';
import { useClientCrm } from '../chat/useClientCrm';
import { useSendChatMedia } from './hooks/useSendChatMedia';
import { dedupeConversationsById } from '../../utils/conversationInboxTrim';
import { collapseConversationsByPhone } from '../../utils/collapseConversationsByPhone';
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
  connectionDisplayLabel,
  phoneRawForContactLookup,
  inboxListTitle,
  unreadCount
} from './lib/conversationDisplay';
import { getConversationPipelineAgg } from './lib/chatPreview';
import '../../styles/wa-web-v2.css';

export const WaWebChatApp: React.FC<{
  autoSelectedConversationId?: string | null;
  onClearAutoSelected?: () => void;
}> = ({ autoSelectedConversationId, onClearAutoSelected }) => {
  const { user } = useAuth();
  const crm = useClientCrm(user?.uid);
  const conversations = useZapMassConversations();
  const { inboxHasMore, inboxLoadingMore, loadMoreInbox } = useZapMassInboxPagination();
  const {
    contacts,
    connections,
    sendMessage,
    sendMedia,
    markAsRead,
    loadChatHistory,
    fetchConversationPicture,
    socket,
    isBackendConnected,
  } = useZapMassCore();

  const connectedChannels = useMemo(
    () => connections.filter((c) => c.status === 'CONNECTED'),
    [connections]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftConversations, setDraftConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [connectionFilterId, setConnectionFilterId] = useState<string | 'ALL'>('ALL');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyExhausted, setHistoryExhausted] = useState<Record<string, boolean>>({});
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const { sending: sendingMedia, sendFile: sendChatFile } = useSendChatMedia(sendMedia);
  /** Evita pedir a mesma foto várias vezes ao servidor (prefetch + chat aberto). */
  const pictureAttemptedRef = useRef<Set<string>>(new Set());
  const historyRequestedRef = useRef<Map<string, number>>(new Map());
  const HISTORY_LEVELS = [200, 600, 1500, 3500, 8000];

  const requestSync = useCallback((opts?: { full?: boolean }) => {
    if (socket?.connected) socket.emit('request-conversations-sync', opts);
  }, [socket]);

  const { socketStatus, syncing, runResync } = useWaRealtime(socket, requestSync, {
    chipsConnected: connectedChannels.length
  });

  /** Ao abrir Atendimento: sync completo uma vez (chips online) + botão manual continua disponível. */
  const initialFullSyncDoneRef = useRef(false);
  useEffect(() => {
    if (!isBackendConnected || !socket?.connected || connectedChannels.length === 0) return;
    if (initialFullSyncDoneRef.current) return;
    initialFullSyncDoneRef.current = true;
    runResync({ full: true });
    requestSync({ full: true });
  }, [isBackendConnected, socket, connectedChannels.length, runResync, requestSync]);

  const mergedConversations = useMemo(() => {
    const realIds = new Set(conversations.map((c) => c.id));
    const drafts = draftConversations.filter((d) => !realIds.has(d.id));
    return collapseConversationsByPhone(
      dedupeConversationsById([...conversations, ...drafts])
    );
  }, [conversations, draftConversations]);

  const sortedConversations = useMemo(() => {
    const list = collapseConversationsByPhone(dedupeConversationsById(mergedConversations));
    return [...list].sort((a, b) => {
      const ta = a.lastMessageTimestamp ?? 0;
      const tb = b.lastMessageTimestamp ?? 0;
      return tb - ta;
    });
  }, [mergedConversations]);

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
      if (connectionFilterId !== 'ALL' && c.connectionId !== connectionFilterId) return false;
      if (unreadOnly && unreadCount(c) === 0) return false;
      if (!q) return true;
      const disp = displayById.get(c.id);
      const primary = disp?.primary?.toLowerCase() ?? '';
      const sub = disp?.whatsappSubtitle?.toLowerCase() ?? '';
      const phone = (c.contactPhone || '').toLowerCase();
      const preview = (c.lastMessage || '').toLowerCase();
      return primary.includes(q) || sub.includes(q) || phone.includes(q) || preview.includes(q);
    });
  }, [sortedConversations, search, unreadOnly, connectionFilterId, displayById]);

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
    try {
      const raw = sessionStorage.getItem('zapmass.openChatByPhone');
      if (!raw) return;
      if (mergedConversations.length === 0 && connections.length === 0) return;
      sessionStorage.removeItem('zapmass.openChatByPhone');

      let phoneRaw = raw;
      let contactName = '';
      let profilePicUrl = '';
      if (raw.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(raw) as {
            phone?: string;
            name?: string;
            profilePicUrl?: string;
          };
          phoneRaw = parsed.phone || '';
          contactName = (parsed.name || '').trim();
          profilePicUrl = parsed.profilePicUrl || '';
        } catch {
          /* string pura */
        }
      }

      const digits = (phoneRaw || '').replace(/\D/g, '');
      if (!digits) return;

      const matchesDigits = (cd: string) =>
        !!cd &&
        (cd === digits ||
          cd.endsWith(digits) ||
          digits.endsWith(cd) ||
          (cd.length >= 10 && digits.length >= 10 && cd.slice(-10) === digits.slice(-10)));

      const candidates = sortedConversations.filter((c) =>
        matchesDigits((c.contactPhone || '').replace(/\D/g, ''))
      );
      if (candidates.length > 0) {
        const best = candidates.sort(
          (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
        )[0];
        selectChat(best.id);
        return;
      }

      const connectedList = connections.filter((c) => c.status === 'CONNECTED');
      const chosen = connectedList[0] || connections[0];
      const draftId = chosen ? `${chosen.id}:${digits}@c.us` : `draft:${digits}`;
      const agendaHit = contacts.find((ct) => {
        const cd = (ct.phone || '').replace(/\D/g, '');
        return matchesDigits(cd);
      });
      const displayName =
        (agendaHit?.name || '').trim() || contactName || `+${digits}`;
      const draft: Conversation = {
        id: draftId,
        contactName: displayName,
        contactPhone: digits,
        profilePicUrl: profilePicUrl || agendaHit?.profilePicUrl || undefined,
        connectionId: chosen?.id || '',
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: '',
        lastMessageTimestamp: Date.now(),
        messages: [],
        tags: []
      };
      setDraftConversations((prev) => (prev.some((d) => d.id === draftId) ? prev : [...prev, draft]));
      selectChat(draftId);
      if (!chosen) {
        toast('Conversa aberta sem chip. Conecte um chip em Conexões para enviar.', {
          icon: 'ℹ️',
          duration: 4500
        });
      } else if (chosen.status !== 'CONNECTED') {
        toast('Chip selecionado não está online. Conecte-o antes de enviar.', {
          icon: '⚠️',
          duration: 4500
        });
      }
    } catch {
      /* ignore */
    }
  }, [mergedConversations.length, connections.length, sortedConversations, contacts, selectChat]);

  useEffect(() => {
    if (draftConversations.length === 0) return;
    const realIds = new Set(conversations.map((c) => c.id));
    const stillPending = draftConversations.filter((d) => !realIds.has(d.id));
    if (stillPending.length !== draftConversations.length) {
      setDraftConversations(stillPending);
    }
  }, [conversations, draftConversations]);

  const conversationNeedsRemotePicture = useCallback(
    (conv: Conversation) => {
      const pic = conv.profilePicUrl;
      if (pic && (pic.startsWith('http') || pic.startsWith('data:'))) return false;
      const raw = phoneRawForContactLookup(conv);
      const nk = normPhoneKey(raw);
      if (nk && profilePicByPhoneKey.has(nk)) return false;
      return true;
    },
    [profilePicByPhoneKey]
  );

  const requestConversationPicture = useCallback(
    (conversationId: string) => {
      if (!conversationId || pictureAttemptedRef.current.has(conversationId)) return;
      pictureAttemptedRef.current.add(conversationId);
      fetchConversationPicture(conversationId);
    },
    [fetchConversationPicture]
  );

  /** Prefetch da lista (não espera clicar na conversa). */
  useEffect(() => {
    const MAX = 60;
    const BATCH = 4;
    const DELAY_MS = 400;
    const queue: string[] = [];
    for (const conv of sortedConversations) {
      if (queue.length >= MAX) break;
      if (!conversationNeedsRemotePicture(conv)) continue;
      if (pictureAttemptedRef.current.has(conv.id)) continue;
      queue.push(conv.id);
    }
    if (queue.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (let i = 0; i < queue.length; i += BATCH) {
        if (cancelled) break;
        const batch = queue.slice(i, i + BATCH);
        for (const id of batch) requestConversationPicture(id);
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sortedConversations, conversationNeedsRemotePicture, requestConversationPicture]);

  useEffect(() => {
    if (!selected?.id || selected.profilePicUrl) return;
    if (!conversationNeedsRemotePicture(selected)) return;
    requestConversationPicture(selected.id);
  }, [selected?.id, selected?.profilePicUrl, conversationNeedsRemotePicture, requestConversationPicture]);

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
    runResync({ full: true });
    requestSync({ full: true });
    toast.success('Sincronizando com o WhatsApp…', { duration: 2500 });
  }, [runResync, requestSync]);

  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === selected?.connectionId) ?? null,
    [connections, selected?.connectionId]
  );

  const selectedChipConnected = useMemo(() => {
    if (!selected?.connectionId) return connectedChannels.length > 0;
    return connectedChannels.some((c) => c.id === selected.connectionId);
  }, [selected?.connectionId, connectedChannels]);

  const pipelineAgg = useMemo(() => getConversationPipelineAgg(selected ?? undefined), [selected]);

  const handleSendMedia = useCallback(
    (file: File, caption?: string) => {
      if (!selected?.id) return;
      if (connectedChannels.length === 0) {
        toast.error('Nenhum chip WhatsApp conectado.');
        return;
      }
      void sendChatFile(selected.id, file, caption);
    },
    [selected?.id, connectedChannels.length, sendChatFile]
  );

  useEffect(() => {
    if (!selected) setShowContactInfo(false);
  }, [selected?.id]);

  const selectedDisplay = selected ? displayById.get(selected.id) : null;
  const selectedTitle = selected
    ? inboxListTitle(selectedDisplay, selected)
    : '';

  return (
    <div className="wa-chat-pro wa-pipeline-root flex min-h-0">
      <WaInbox
        conversations={filtered}
        allConversations={sortedConversations}
        displayById={displayById}
        avatarById={avatarById}
        selectedId={selectedId}
        search={search}
        unreadOnly={unreadOnly}
        connectionFilterId={connectionFilterId}
        onConnectionFilterChange={setConnectionFilterId}
        socketStatus={isBackendConnected ? socketStatus : 'offline'}
        syncing={syncing}
        chipsConnected={connectedChannels.length}
        connections={connections}
        onSearch={setSearch}
        onToggleUnread={() => setUnreadOnly((v) => !v)}
        onRefresh={handleRefresh}
        onSelect={selectChat}
        hideOnMobile={mobileShowThread}
        inboxHasMore={inboxHasMore}
        inboxLoadingMore={inboxLoadingMore}
        onLoadMore={loadMoreInbox}
      />

      <WaThread
        conversation={selected}
        display={selectedDisplay ?? null}
        avatarSrc={selected ? avatarById.get(selected.id) || '' : ''}
        loadingHistory={loadingHistory}
        historyExhausted={selected ? !!historyExhausted[selected.id] : true}
        canSend={!!selected && connectedChannels.length > 0}
        socketStatus={isBackendConnected ? socketStatus : 'offline'}
        syncing={syncing}
        chipConnected={selectedChipConnected}
        connectionName={
          selected?.connectionId
            ? connectionDisplayLabel(connections, selected.connectionId)
            : null
        }
        showConnectionLabel={connections.length > 1}
        showBack={mobileShowThread}
        onBack={() => setMobileShowThread(false)}
        onLoadOlder={loadOlder}
        onSend={handleSend}
        onAttach={handleSendMedia}
        sendingMedia={sendingMedia}
        onOpenContactInfo={selected ? () => setShowContactInfo(true) : undefined}
        hideOnMobile={!mobileShowThread}
      />

      {selected && (
        <WaContactDrawer
          open={showContactInfo}
          title="Ficha do cliente"
          subtitle={selectedTitle}
          onClose={() => setShowContactInfo(false)}
        >
          <ClientCrmPanel
            conversation={selected}
            connectionName={selectedConnection?.name}
            avatar={avatarById.get(selected.id) || ''}
            crmData={crm.get(selected.id)}
            pipelineAgg={pipelineAgg}
            displayTitle={selectedTitle}
            whatsappAlias={selectedDisplay?.whatsappSubtitle}
            onClose={() => setShowContactInfo(false)}
            onUpdate={(patch) => crm.update(selected.id, patch)}
            onClear={() => crm.clear(selected.id)}
          />
        </WaContactDrawer>
      )}
    </div>
  );
};

export default WaWebChatApp;
