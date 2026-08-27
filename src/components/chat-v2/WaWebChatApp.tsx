import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { aiSuggestChatReplies } from '../../services/aiApi';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  useZapMassCore,
  useZapMassConversations,
  useZapMassInboxPagination,
  useZapMassConnectionsSlice,
  useZapMassUiSnapshot,
} from '../../context/ZapMassContext';
import { ClientCrmPanel } from '../chat/ClientCrmPanel';
import { WaContactDrawer } from '../chat/wa/WaContactDrawer';
import { useClientCrm } from '../chat/useClientCrm';
import { useSendChatMedia } from './hooks/useSendChatMedia';
import { dedupeConversationsById } from '../../utils/conversationInboxTrim';
import { collapseConversationsByPhone } from '../../utils/collapseConversationsByPhone';
import { buildCanonicalConversationId } from '../../utils/conversationId';
import { OPEN_CHAT_BY_CONVERSATION_ID_KEY } from '../../utils/openChatByConversationIdNav';
import { normPhoneKey } from '../../utils/brPhoneNormalize';
import {
  buildPhoneDigitLookupKeys,
  normalizePhoneDigits
} from '../../utils/contactPhoneLookup';
import type { ChatMessage, Conversation } from '../../types';
import { WaInbox } from './WaInbox';
import { WaThread } from './WaThread';
import { WaChannelRail } from './WaChannelRail';
import { WaContextPanel } from './WaContextPanel';
import { WaForwardModal, WaScheduleModal } from './WaForwardModal';
import { WaMediaPreviewModal } from './WaMediaPreviewModal';
import { WaInboxTeamBar } from './WaInboxTeamBar';
import { ReplyIntentPanel } from './ReplyIntentPanel';
import { autoApplyReplyIntents } from '../../services/replyIntentApi';
import { useWaRealtime } from './hooks/useWaRealtime';
import { useScheduledOutboundDispatch } from './hooks/useScheduledOutbound';
import {
  filterConversationsBySmartTab,
  sortInboxWithPins,
} from './lib/inboxFilter';
import { slaLevelForConversation } from './lib/slaUtils';
import {
  addScheduledMessagePref,
  isConversationArchived,
  isConversationPinned,
  loadChatInboxPrefs,
  pruneExpiredSnoozes,
  removeScheduledMessagePref,
  saveChatInboxPrefs,
  snoozeConversationPref,
  toggleArchivedPref,
  togglePinnedPref,
  type ChatInboxPrefsState,
  type InboxSmartTab,
  type ScheduledOutbound,
} from '../../utils/chatInboxPrefs';
import {
  avatarUrl,
  buildDisplayIndex,
  connectionDisplayLabel,
  phoneRawForContactLookup,
  inboxListTitle,
  unreadCount
} from './lib/conversationDisplay';
import { getConversationPipelineAgg } from './lib/chatPreview';
import {
  isInboxFullSyncDoneToday,
  markInboxFullSyncDoneForToday,
} from '../../utils/tenantDailyCache';

export const WaWebChatApp: React.FC<{
  autoSelectedConversationId?: string | null;
  onClearAutoSelected?: () => void;
}> = ({ autoSelectedConversationId, onClearAutoSelected }) => {
  const { user } = useAuth();
  const { effectiveWorkspaceUid, authUid: workspaceAuthUid, isTeamMember } = useWorkspace();
  const isWorkspaceOwner = Boolean(
    workspaceAuthUid && effectiveWorkspaceUid && workspaceAuthUid === effectiveWorkspaceUid
  );
  const tenantUid = effectiveWorkspaceUid ?? user?.uid ?? '';
  const crm = useClientCrm(user?.uid);
  const conversations = useZapMassConversations();
  const { inboxHasMore, inboxLoadingMore, loadMoreInbox } = useZapMassInboxPagination();
  const connections = useZapMassConnectionsSlice();
  const { systemMetrics } = useZapMassUiSnapshot();
  const isGoWebhookInbox = systemMetrics.whatsappEngine === 'evolution-go';
  const {
    contacts,
    sendMessage,
    sendMedia,
    markAsRead,
    loadChatHistory,
    fetchConversationPicture,
    hydrateFirestoreChatArchive,
    loadMessageMedia,
    patchChatMessageMediaUrl,
    removeLocalChatMessage,
    deleteLocalConversations,
    patchConversationInboxClaim,
    socket,
    isBackendConnected,
  } = useZapMassCore();

  const connectedChannels = useMemo(
    () => connections.filter((c) => c.status === 'CONNECTED'),
    [connections]
  );

  /** Adia rebuilds de índice de contatos enquanto carregam em lote — evita recalcular displayById/avatarById a cada chunk */
  const deferredContacts = useDeferredValue(contacts);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftConversations, setDraftConversations] = useState<Conversation[]>([]);
  const [draftChannelById, setDraftChannelById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [connectionFilterId, setConnectionFilterId] = useState<string | 'ALL'>('ALL');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyExhausted, setHistoryExhausted] = useState<Record<string, boolean>>({});
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showReplyIntent, setShowReplyIntent] = useState(false);
  const [autoClassifying, setAutoClassifying] = useState(false);
  const [inboxPrefs, setInboxPrefs] = useState<ChatInboxPrefsState>(() => loadChatInboxPrefs());
  const [inboxTab, setInboxTab] = useState<InboxSmartTab>('all');
  const [focusMode, setFocusMode] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState<ChatMessage | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDefaultText, setScheduleDefaultText] = useState('');
  const [mediaPreviewFile, setMediaPreviewFile] = useState<File | null>(null);
  const [inThreadSearchOpen, setInThreadSearchOpen] = useState(false);
  const [inThreadQuery, setInThreadQuery] = useState('');
  const [inThreadMatchIndex, setInThreadMatchIndex] = useState(0);
  const autoSelectDoneRef = useRef(false);
  const { sending: sendingMedia, sendFile: sendChatFile } = useSendChatMedia(sendMedia);
  /** Evita pedir a mesma foto várias vezes ao servidor (prefetch + chat aberto). */
  const pictureAttemptedRef = useRef<Set<string>>(new Set());
  const historyRequestedRef = useRef<Map<string, number>>(new Map());
  const historyInitializedRef = useRef<Set<string>>(new Set());
  /** Níveis sob demanda (scroll-up); não carregar tudo ao abrir conversa. */
  const HISTORY_LEVELS = [200, 500, 1500, 3500];

  const requestSync = useCallback((opts?: { full?: boolean }) => {
    if (socket?.connected) socket.emit('request-conversations-sync', opts);
  }, [socket]);

  const { socketStatus, syncing, runResync } = useWaRealtime(socket, requestSync, {
    chipsConnected: connectedChannels.length
  });

  /** Sync leve ao abrir; full 1×/dia só na Evolution API (Go = inbox via webhook). */
  const initialFullSyncDoneRef = useRef(false);
  const emptyInboxRecoveryRef = useRef(false);

  useEffect(() => {
    if (!isBackendConnected || !socket?.connected || connectedChannels.length === 0 || !tenantUid) return;
    if (initialFullSyncDoneRef.current) return;
    initialFullSyncDoneRef.current = true;
    if (isGoWebhookInbox || isInboxFullSyncDoneToday(tenantUid)) {
      requestSync({ full: false });
      return;
    }
    markInboxFullSyncDoneForToday(tenantUid);
    runResync({ full: true });
    requestSync({ full: true });
  }, [
    isBackendConnected,
    socket,
    connectedChannels.length,
    tenantUid,
    runResync,
    requestSync,
    isGoWebhookInbox,
  ]);

  /** Chips online mas inbox vazia — sync leve (full no Go não traz histórico). */
  useEffect(() => {
    if (!isBackendConnected || !socket?.connected || connectedChannels.length === 0) return;
    if (conversations.length > 0) {
      emptyInboxRecoveryRef.current = false;
      return;
    }
    if (emptyInboxRecoveryRef.current) return;
    emptyInboxRecoveryRef.current = true;
    const t = window.setTimeout(() => {
      requestSync({ full: false });
      if (!isGoWebhookInbox) runResync({ full: true });
    }, 2800);
    return () => window.clearTimeout(t);
  }, [
    isBackendConnected,
    socket,
    connectedChannels.length,
    conversations.length,
    requestSync,
    runResync,
    isGoWebhookInbox,
  ]);

  useEffect(() => {
    saveChatInboxPrefs(inboxPrefs);
  }, [inboxPrefs]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setInboxPrefs((prev) => {
        const { state, wokeIds } = pruneExpiredSnoozes(prev);
        if (wokeIds.length === 0) return prev;
        return state;
      });
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const updateInboxPrefs = useCallback((updater: (prev: ChatInboxPrefsState) => ChatInboxPrefsState) => {
    setInboxPrefs((prev) => updater(prev));
  }, []);

  const mergedConversations = useMemo(() => {
    const realIds = new Set(conversations.map((c) => c.id));
    const drafts = draftConversations.filter((d) => !realIds.has(d.id));
    return collapseConversationsByPhone(
      dedupeConversationsById([...conversations, ...drafts])
    );
  }, [conversations, draftConversations]);

  // mergedConversations já foi collapsed/deduped — ordenar direto sem segundo collapse.
  const sortedConversations = useMemo(() => {
    return [...mergedConversations].sort((a, b) => {
      const ta = a.lastMessageTimestamp ?? 0;
      const tb = b.lastMessageTimestamp ?? 0;
      return tb - ta;
    });
  }, [mergedConversations]);

  // Usa deferredContacts — não precisa recalcular nomes ao carregar cada batch de contatos.
  const displayById = useMemo(
    () => buildDisplayIndex(sortedConversations, deferredContacts),
    [sortedConversations, deferredContacts]
  );

  const contactByPhoneKey = useMemo(() => {
    const map = new Map<string, (typeof deferredContacts)[number]>();
    for (const ct of deferredContacts) {
      const nk = normPhoneKey(ct.phone || '');
      if (nk) map.set(nk, ct);
    }
    return map;
  }, [deferredContacts]);

  const profilePicByPhoneKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const ct of deferredContacts) {
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
  }, [deferredContacts]);

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

  const slaByConvId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof slaLevelForConversation>>();
    const now = Date.now();
    for (const c of sortedConversations) {
      map.set(c.id, slaLevelForConversation(c, now));
    }
    return map;
  }, [sortedConversations]);

  const filtered = useMemo(() => {
    let list = sortedConversations;
    if (connectionFilterId !== 'ALL') {
      list = list.filter((c) => c.connectionId === connectionFilterId);
    }
    list = filterConversationsBySmartTab(
      list,
      inboxTab,
      inboxPrefs,
      (id) => crm.get(id),
      Date.now(),
      (conv) => {
        const phone = normPhoneKey(phoneRawForContactLookup(conv));
        return phone ? contactByPhoneKey.get(phone) : undefined;
      }
    );
    if (unreadOnly && inboxTab === 'all') {
      list = list.filter((c) => unreadCount(c) > 0);
    }
    const q = deferredSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const disp = displayById.get(c.id);
        const primary = disp?.primary?.toLowerCase() ?? '';
        const sub = disp?.whatsappSubtitle?.toLowerCase() ?? '';
        const phone = (c.contactPhone || '').toLowerCase();
        const preview = (c.lastMessage || '').toLowerCase();
        return primary.includes(q) || sub.includes(q) || phone.includes(q) || preview.includes(q);
      });
    }
    return sortInboxWithPins(list, inboxPrefs.pinnedIds);
  }, [
    sortedConversations,
    connectionFilterId,
    inboxTab,
    inboxPrefs,
    crm.get,
    crm.data,
    unreadOnly,
    deferredSearch,
    displayById,
    contactByPhoneKey,
  ]);

  const selected = useMemo(
    () => sortedConversations.find((c) => c.id === selectedId) ?? null,
    [sortedConversations, selectedId]
  );

  const selectChat = useCallback(
    (id: string) => {
      setSelectedId(id);
      setMobileShowThread(true);
      setQuoteMessage(null);
      markAsRead(id);
    },
    [markAsRead]
  );

  /** Desktop: auto-seleciona a primeira conversa quando a lista carrega. */
  useEffect(() => {
    if (autoSelectDoneRef.current || selectedId || filtered.length === 0) return;
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;
    if (autoSelectedConversationId?.trim()) return;
    autoSelectDoneRef.current = true;
    selectChat(filtered[0].id);
  }, [filtered, selectedId, selectChat, autoSelectedConversationId]);

  useEffect(() => {
    if (!selectedId) return;
    setInThreadSearchOpen(false);
    setInThreadQuery('');
    setInThreadMatchIndex(0);
    setQuoteMessage(null);
  }, [selectedId]);

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
      let preferredConnectionId = '';
      if (raw.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(raw) as {
            phone?: string;
            name?: string;
            profilePicUrl?: string;
            connectionId?: string;
          };
          phoneRaw = parsed.phone || '';
          contactName = (parsed.name || '').trim();
          profilePicUrl = parsed.profilePicUrl || '';
          preferredConnectionId = (parsed.connectionId || '').trim();
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
        const preferred = preferredConnectionId
          ? candidates.find((c) => c.connectionId === preferredConnectionId)
          : undefined;
        const best =
          preferred ||
          candidates.sort(
            (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
          )[0];
        selectChat(best.id);
        return;
      }

      const connectedList = connections.filter((c) => c.status === 'CONNECTED');
      const preferredConn = preferredConnectionId
        ? connections.find((c) => c.id === preferredConnectionId)
        : undefined;
      const chosen = preferredConn || connectedList[0] || connections[0];
      const draftId = chosen ? buildCanonicalConversationId(chosen.id, digits) || `draft:${digits}` : `draft:${digits}`;
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
      if (chosen?.id) {
        setDraftChannelById((prev) => ({ ...prev, [draftId]: chosen.id }));
      }
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
    (conversationId: string, force = false) => {
      if (!conversationId) return;
      if (!force && pictureAttemptedRef.current.has(conversationId)) return;
      pictureAttemptedRef.current.add(conversationId);
      fetchConversationPicture(conversationId);
    },
    [fetchConversationPicture]
  );

  /** Prefetch leve — só primeiras conversas visíveis. */
  useEffect(() => {
    const MAX = 12;
    const BATCH = 3;
    const DELAY_MS = 600;
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
  }, [sortedConversations.length, conversationNeedsRemotePicture, requestConversationPicture]);

  useEffect(() => {
    if (!selected?.id || selected.profilePicUrl) return;
    if (!conversationNeedsRemotePicture(selected)) return;
    requestConversationPicture(selected.id);
  }, [selected?.id, selected?.profilePicUrl, conversationNeedsRemotePicture, requestConversationPicture]);

  // loadingHistory por conversa (antes era boolean global — causava spinner errado ao trocar de chat)
  const loadingHistoryById = useRef<Set<string>>(new Set());

  const loadMoreHistory = useCallback(
    async (conversationId: string, silent = false) => {
      if (!conversationId) return;
      if (historyExhausted[conversationId]) return;
      // Evita carga paralela da mesma conversa
      if (loadingHistoryById.current.has(conversationId)) return;

      const current = historyRequestedRef.current.get(conversationId) || 0;
      const nextLevel =
        HISTORY_LEVELS.find((lvl) => lvl > current) || HISTORY_LEVELS[HISTORY_LEVELS.length - 1];
      if (nextLevel === current) return;

      loadingHistoryById.current.add(conversationId);
      setLoadingHistory(true);
      const prevCount =
        sortedConversations.find((c) => c.id === conversationId)?.messages.length || 0;
      try {
        const res = await loadChatHistory(
          conversationId,
          Math.max(nextLevel, prevCount + 50),
          true
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
        // Só avança o nível APÓS sucesso confirmado
        historyRequestedRef.current.set(conversationId, nextLevel);
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
        loadingHistoryById.current.delete(conversationId);
        setLoadingHistory(false);
      }
    },
    [historyExhausted, loadChatHistory, sortedConversations]
  );

  useEffect(() => {
    if (!selected?.id || !socket?.connected) return;
    if (!historyInitializedRef.current.has(selected.id)) {
      historyInitializedRef.current.add(selected.id);
      // Evolution Go: findMessages indisponível — histórico vem de arquivo + HistorySync webhook.
      void loadMoreHistory(selected.id, true);
    }
  }, [selected?.id, socket?.connected, loadMoreHistory]);

  const isSelectedDraft = useMemo(() => {
    if (!selected?.id) return false;
    return draftConversations.some((d) => d.id === selected.id);
  }, [selected?.id, draftConversations]);

  const selectedDraftChannelId = useMemo(() => {
    if (!selected?.id || !isSelectedDraft) return selected?.connectionId || '';
    return draftChannelById[selected.id] || selected.connectionId || '';
  }, [selected?.id, selected?.connectionId, isSelectedDraft, draftChannelById]);

  useEffect(() => {
    if (!selected?.id || isSelectedDraft) return;
    const t = window.setTimeout(() => {
      void hydrateFirestoreChatArchive(selected.id, isGoWebhookInbox ? 1500 : 500);
    }, 70);
    return () => window.clearTimeout(t);
  }, [selected?.id, isSelectedDraft, hydrateFirestoreChatArchive, isGoWebhookInbox]);

  const handleLoadMedia = useCallback(
    async (messageId: string, silent = false): Promise<string | null> => {
      if (!selected?.id) return null;
      // Timeout de 30s — Evolution API pode demorar
      const timeoutPromise = new Promise<{ ok: boolean; error?: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: 'Tempo esgotado. Tente novamente.' }), 30_000)
      );
      const res = await Promise.race([
        loadMessageMedia(selected.id, messageId),
        timeoutPromise,
      ]) as { ok: boolean; mediaUrl?: string; error?: string };
      if (!res.ok) {
        // silent=true quando é auto-load — não exibir toast para não poluir a UI.
        // Toast só aparece quando o usuário clica manualmente para recarregar.
        if (!silent && res.error) {
          const errMsg = res.error.toLowerCase().startsWith('mídia') ? res.error : `Mídia: ${res.error}`;
          toast.error(errMsg, { id: `media-fail-${messageId}`, duration: 4000 });
        }
        return null;
      }
      if (res.mediaUrl) {
        patchChatMessageMediaUrl(selected.id, messageId, res.mediaUrl);
      }
      return res.mediaUrl || null;
    },
    [selected?.id, loadMessageMedia, patchChatMessageMediaUrl]
  );

  const handleGetAiSuggestions = useCallback(async (): Promise<string[]> => {
    if (!selected?.messages?.length) return [];
    const msgs = (selected.messages ?? []).slice(-8).map((m) => ({
      sender: m.sender === 'me' ? 'eu' : 'contato',
      text: (m.text || '').trim(),
      type: m.type || 'text',
    })).filter((m) => m.text || m.type !== 'text');
    const res = await aiSuggestChatReplies(msgs);
    if (!res.ok || res.suggestions.length === 0) {
      toast.error('IA não conseguiu gerar sugestões. Tente novamente.');
      return [];
    }
    return res.suggestions;
  }, [selected]);

  const handleExportConversation = useCallback(() => {
    if (!selected) return;
    const msgs = selected.messages ?? [];
    const title = selected.contactName || selected.contactPhone || 'conversa';
    const lines: string[] = [
      `=== Conversa: ${title} ===`,
      `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
      '='.repeat(40),
      '',
    ];
    for (const msg of msgs) {
      const ts = msg.timestamp
        ? new Date(Number(msg.timestamp) * 1000).toLocaleString('pt-BR')
        : '';
      const who = msg.sender === 'me' ? 'Você' : title;
      const content =
        msg.type === 'image' ? '[Foto]'
          : msg.type === 'video' ? '[Vídeo]'
            : msg.type === 'audio' ? '[Áudio]'
              : msg.type === 'document' ? `[Documento: ${msg.text || ''}]`
                : msg.type === 'sticker' ? '[Figurinha]'
                  : (msg.text || '');
      lines.push(`[${ts}] ${who}: ${content}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zapmass_${title.replace(/\s+/g, '_')}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Conversa exportada!');
  }, [selected]);

  const handleDraftChannelChange = useCallback(
    (connectionId: string) => {
      if (!selected?.id || !isSelectedDraft) return;
      const digits = (selected.contactPhone || '').replace(/\D/g, '');
      if (!digits) return;
      const newId = buildCanonicalConversationId(connectionId, digits);
      if (!newId) return;
      setDraftChannelById((prev) => {
        const next = { ...prev };
        delete next[selected.id];
        next[newId] = connectionId;
        return next;
      });
      setDraftConversations((prev) =>
        prev.map((d) =>
          d.id === selected.id
            ? { ...d, id: newId, connectionId }
            : d
        )
      );
      setSelectedId(newId);
    },
    [selected?.id, selected?.contactPhone, isSelectedDraft]
  );

  const handleSend = useCallback(
    (text: string) => {
      if (!selected?.id) return;
      if (connectedChannels.length === 0) {
        toast.error('Nenhum chip WhatsApp conectado.');
        return;
      }
      if (isSelectedDraft) {
        const digits = (selected.contactPhone || '').replace(/\D/g, '');
        const chosenConnectionId = selectedDraftChannelId;
        if (!chosenConnectionId) {
          toast.error('Escolha um canal para enviar a primeira mensagem.');
          return;
        }
        if (!digits) {
          toast.error('Telefone inválido para iniciar conversa.');
          return;
        }
        const realConversationId = buildCanonicalConversationId(chosenConnectionId, digits);
        if (!realConversationId) {
          toast.error('Telefone inválido para iniciar conversa.');
          return;
        }
        if (realConversationId !== selected.id) {
          setDraftConversations((prev) =>
            prev.map((d) =>
              d.id === selected.id ? { ...d, id: realConversationId, connectionId: chosenConnectionId } : d
            )
          );
          setDraftChannelById((prev) => {
            const next = { ...prev };
            delete next[selected.id];
            next[realConversationId] = chosenConnectionId;
            return next;
          });
          setSelectedId(realConversationId);
        }
        sendMessage(realConversationId, text);
        return;
      }
      sendMessage(selected.id, text);
    },
    [
      selected?.id,
      selected?.contactPhone,
      connectedChannels.length,
      isSelectedDraft,
      selectedDraftChannelId,
      sendMessage
    ]
  );

  const handleRefresh = useCallback(() => {
    const full = !isGoWebhookInbox;
    runResync({ full, force: true });
    requestSync({ full });
    if (selectedId) void loadMoreHistory(selectedId, true);
    toast.success(
      full
        ? 'Sincronizando conversas e mensagens…'
        : 'Atualizando conversas recentes…',
      { duration: 2500 }
    );
  }, [runResync, requestSync, isGoWebhookInbox, selectedId, loadMoreHistory]);

  const handleAutoClassifyResponses = useCallback(async () => {
    const ok = window.confirm(
      'Buscar respostas «quero» e «sair» em todas as conversas?\n\n' +
        '• «Quero» / interesse → marca como quente\n' +
        '• «Sair» → lista negra\n' +
        '• Disse «quero» antes e depois «sair» → lista negra (prioridade)\n\n' +
        'Threads de aquecimento são ignoradas.'
    );
    if (!ok) return;

    setAutoClassifying(true);
    try {
      const preview = await autoApplyReplyIntents({ excludeWarmup: true, dryRun: true });
      if (preview.eligible === 0) {
        const parts = [
          `${preview.scanned} conversas analisadas`,
          preview.withInbound > 0 ? `${preview.withInbound} com resposta` : null,
          preview.skippedWarmup > 0 ? `${preview.skippedWarmup} só aquecimento` : null,
          preview.skippedNeutral > 0 ? `${preview.skippedNeutral} neutras/cortesia` : null,
        ].filter(Boolean);
        toast(
          `Nenhuma resposta «quero» ou «sair» encontrada.${parts.length ? ` (${parts.join(' · ')})` : ''}`,
          { icon: 'ℹ️', duration: 6000 }
        );
        return;
      }
      const confirmApply = window.confirm(
        `Encontradas ${preview.eligible} conversa(s) para classificar:\n` +
          `• ${preview.appliedHot} quente(s)\n` +
          `• ${preview.appliedBlacklist} lista negra (incl. ${preview.queroThenSair} quero→sair)\n\n` +
          'Aplicar agora?'
      );
      if (!confirmApply) return;

      const result = await autoApplyReplyIntents({ excludeWarmup: true });
      toast.success(
        `Pronto: ${result.appliedHot} quente(s), ${result.appliedBlacklist} lista negra.` +
          (result.queroThenSair > 0 ? ` (${result.queroThenSair} quero→sair)` : '')
      );
      if (result.skippedNoContact > 0) {
        toast(`${result.skippedNoContact} sem cadastro no CRM — ignorado(s).`, { icon: '⚠️' });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na classificação automática.');
    } finally {
      setAutoClassifying(false);
    }
  }, []);

  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === selected?.connectionId) ?? null,
    [connections, selected?.connectionId]
  );

  const selectedChipConnected = useMemo(() => {
    const cid = isSelectedDraft ? selectedDraftChannelId : selected?.connectionId;
    if (!cid) return connectedChannels.length > 0;
    return connectedChannels.some((c) => c.id === cid);
  }, [isSelectedDraft, selectedDraftChannelId, selected?.connectionId, connectedChannels]);

  const pipelineAgg = useMemo(() => getConversationPipelineAgg(selected ?? undefined), [selected]);

  const selectedContactId = useMemo(() => {
    if (!selected) return null;
    const phone = normPhoneKey(phoneRawForContactLookup(selected));
    if (!phone) return null;
    const hit = deferredContacts.find((c) => normPhoneKey(c.phone) === phone);
    return hit?.id ?? null;
  }, [selected, deferredContacts]);

  const loadOlder = useCallback(() => {
    if (selected?.id) void loadMoreHistory(selected.id);
  }, [selected?.id, loadMoreHistory]);

  const handleSendMedia = useCallback(
    (file: File, caption?: string) => {
      if (!selected?.id) return;
      if (connectedChannels.length === 0) {
        toast.error('Nenhum chip WhatsApp conectado.');
        return;
      }
      let conversationId = selected.id;
      if (isSelectedDraft) {
        const digits = (selected.contactPhone || '').replace(/\D/g, '');
        const chosenConnectionId = selectedDraftChannelId;
        if (!chosenConnectionId) {
          toast.error('Escolha um canal para enviar a primeira mensagem.');
          return;
        }
        const canonicalId = buildCanonicalConversationId(chosenConnectionId, digits);
        if (!canonicalId) {
          toast.error('Telefone inválido para iniciar conversa.');
          return;
        }
        conversationId = canonicalId;
        if (conversationId !== selected.id) {
          setDraftConversations((prev) =>
            prev.map((d) =>
              d.id === selected.id ? { ...d, id: conversationId, connectionId: chosenConnectionId } : d
            )
          );
          setDraftChannelById((prev) => {
            const next = { ...prev };
            delete next[selected.id];
            next[conversationId] = chosenConnectionId;
            return next;
          });
          setSelectedId(conversationId);
        }
      }
      void sendChatFile(conversationId, file, caption);
    },
    [
      selected?.id,
      selected?.contactPhone,
      connectedChannels.length,
      isSelectedDraft,
      selectedDraftChannelId,
      sendChatFile
    ]
  );

  useEffect(() => {
    if (!selected) setShowContactInfo(false);
  }, [selected?.id]);

  const inThreadMatchIds = useMemo(() => {
    if (!inThreadQuery.trim() || !selected?.messages?.length) return [];
    const q = inThreadQuery.trim().toLowerCase();
    return selected.messages
      .filter((m) => (m.text || '').toLowerCase().includes(q))
      .map((m) => m.id);
  }, [selected?.messages, inThreadQuery]);

  useEffect(() => {
    if (inThreadMatchIds.length === 0) {
      setInThreadMatchIndex(0);
      return;
    }
    setInThreadMatchIndex((i) => Math.min(i, inThreadMatchIds.length - 1));
  }, [inThreadMatchIds]);

  const highlightMessageId = inThreadMatchIds[inThreadMatchIndex] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && selected) {
        e.preventDefault();
        setInThreadSearchOpen(true);
      }
      if (e.key === 'Escape' && inThreadSearchOpen) {
        setInThreadSearchOpen(false);
        setInThreadQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, inThreadSearchOpen]);

  const handleScheduledDue = useCallback(
    (item: ScheduledOutbound) => {
      sendMessage(item.conversationId, item.text);
      updateInboxPrefs((prev) => removeScheduledMessagePref(prev, item.id));
      toast.success('Mensagem agendada enviada.');
    },
    [sendMessage, updateInboxPrefs]
  );

  useScheduledOutboundDispatch({
    scheduled: inboxPrefs.scheduled,
    onDue: handleScheduledDue,
  });

  const handleForward = useCallback(
    (targetId: string, text: string) => {
      if (!text.trim()) return;
      sendMessage(targetId, text.trim());
      toast.success('Mensagem encaminhada.');
    },
    [sendMessage]
  );

  const handleDeleteLocalMessage = useCallback(
    (msg: ChatMessage) => {
      if (!selected?.id) return;
      removeLocalChatMessage(selected.id, msg.id);
    },
    [selected?.id, removeLocalChatMessage]
  );

  const handleDeleteConversation = useCallback(() => {
    if (!selected?.id) return;
    const ok = window.confirm(
      'Remover esta conversa apenas da tela local?\n\nO histórico no WhatsApp não é apagado.'
    );
    if (!ok) return;
    void deleteLocalConversations([selected.id]).then((n) => {
      if (n > 0) {
        setSelectedId(null);
        toast.success('Conversa removida da lista local.');
      }
    });
  }, [selected?.id, deleteLocalConversations]);

  const handleScheduleConfirm = useCallback(
    (text: string, sendAt: number) => {
      if (!selected?.id) return;
      const item: ScheduledOutbound = {
        id: `sched-${Date.now()}`,
        conversationId: selected.id,
        text,
        sendAt,
        connectionId: selected.connectionId,
      };
      updateInboxPrefs((prev) => addScheduledMessagePref(prev, item));
      toast.success(`Agendado para ${new Date(sendAt).toLocaleString('pt-BR')}`);
    },
    [selected?.id, selected?.connectionId, updateInboxPrefs]
  );

  const handleMediaPreviewSend = useCallback(
    (caption: string) => {
      if (!mediaPreviewFile || !selected?.id) return;
      handleSendMedia(mediaPreviewFile, caption.trim() || undefined);
      setMediaPreviewFile(null);
    },
    [mediaPreviewFile, selected?.id, handleSendMedia]
  );

  const handleInboxTabChange = useCallback((tab: InboxSmartTab) => {
    setInboxTab(tab);
    if (tab === 'unread') setUnreadOnly(true);
    else if (tab === 'all') setUnreadOnly(false);
  }, []);

  const teamBar = selected ? (
    <WaInboxTeamBar
      conversation={selected}
      isDraft={isSelectedDraft}
      workspaceAuthUid={workspaceAuthUid}
      isTeamMember={isTeamMember}
      isWorkspaceOwner={isWorkspaceOwner}
      patchConversationInboxClaim={patchConversationInboxClaim}
      socket={socket}
    />
  ) : null;

  const selectedDisplay = selected ? displayById.get(selected.id) : null;
  const selectedTitle = selected
    ? inboxListTitle(selectedDisplay, selected)
    : '';

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div
        className={`wa-chat-pro wa-pipeline-root flex min-h-0 flex-1${focusMode ? ' wa-chat-pro--focus' : ''}`}
      >

      {!focusMode && (
      <WaChannelRail
        connections={connections}
        conversations={sortedConversations}
        activeId={connectionFilterId}
        onChange={setConnectionFilterId}
      />
      )}

      {!focusMode && (
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
        onAutoClassifyResponses={() => void handleAutoClassifyResponses()}
        autoClassifying={autoClassifying}
        onSelect={selectChat}
        hideOnMobile={mobileShowThread}
        inboxHasMore={inboxHasMore}
        inboxLoadingMore={inboxLoadingMore}
        onLoadMore={loadMoreInbox}
        onRequestPicture={requestConversationPicture}
        inboxTab={inboxTab}
        onInboxTabChange={handleInboxTabChange}
        pinnedIds={inboxPrefs.pinnedIds}
        slaByConvId={slaByConvId}
      />
      )}

      <WaThread
        conversation={selected}
        display={selectedDisplay ?? null}
        avatarSrc={selected ? avatarById.get(selected.id) || '' : ''}
        loadingHistory={loadingHistory}
        historyExhausted={selected ? !!historyExhausted[selected.id] : true}
        canSend={!!selected && selectedChipConnected}
        chipsConnected={connectedChannels.length}
        socketStatus={isBackendConnected ? socketStatus : 'offline'}
        syncing={syncing}
        chipConnected={selectedChipConnected}
        connectionName={
          selected?.connectionId
            ? connectionDisplayLabel(connections, selected.connectionId)
            : null
        }
        showConnectionLabel={connections.length > 0}
        showBack={mobileShowThread}
        onBack={() => setMobileShowThread(false)}
        onLoadOlder={loadOlder}
        onSend={handleSend}
        onAttach={handleSendMedia}
        sendingMedia={sendingMedia}
        onOpenContactInfo={selected ? () => setShowContactInfo(true) : undefined}
        hideOnMobile={!mobileShowThread}
        onLoadMedia={handleLoadMedia}
        onExport={selected ? handleExportConversation : undefined}
        onGetAiSuggestions={selected && !isSelectedDraft ? handleGetAiSuggestions : undefined}
        onAnalyzeIntent={selected && !isSelectedDraft ? () => setShowReplyIntent(true) : undefined}
        isDraft={isSelectedDraft}
        draftChannels={connections}
        draftChannelId={selectedDraftChannelId}
        onDraftChannelChange={handleDraftChannelChange}
        teamBar={teamBar}
        pipelineAgg={pipelineAgg}
        quoteMessage={quoteMessage}
        onQuoteChange={setQuoteMessage}
        onForwardMessage={(m) => setForwardMsg(m)}
        onDeleteLocalMessage={handleDeleteLocalMessage}
        onDeleteConversation={selected ? handleDeleteConversation : undefined}
        onSearchInThread={selected ? () => setInThreadSearchOpen(true) : undefined}
        inThreadSearchOpen={inThreadSearchOpen}
        inThreadQuery={inThreadQuery}
        inThreadMatchCount={inThreadMatchIds.length}
        inThreadMatchIndex={inThreadMatchIndex}
        onInThreadQueryChange={setInThreadQuery}
        onInThreadSearchClose={() => {
          setInThreadSearchOpen(false);
          setInThreadQuery('');
        }}
        onInThreadPrev={() =>
          setInThreadMatchIndex((i) =>
            inThreadMatchIds.length ? (i - 1 + inThreadMatchIds.length) % inThreadMatchIds.length : 0
          )
        }
        onInThreadNext={() =>
          setInThreadMatchIndex((i) =>
            inThreadMatchIds.length ? (i + 1) % inThreadMatchIds.length : 0
          )
        }
        highlightMessageId={highlightMessageId}
        onPickFileForPreview={(file) => setMediaPreviewFile(file)}
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode((v) => !v)}
      />

      {selected && !focusMode && (
        <WaContextPanel
          conversation={selected}
          display={selectedDisplay ?? null}
          avatarSrc={avatarById.get(selected.id) || ''}
          connectionName={selectedConnection?.name}
          crmData={crm.get(selected.id)}
          pipelineAgg={pipelineAgg}
          displayTitle={selectedTitle}
          onClose={() => setSelectedId(null)}
          onUpdateCrm={(patch) => crm.update(selected.id, patch)}
          onClearCrm={() => crm.clear(selected.id)}
          onExport={handleExportConversation}
          onAnalyzeIntent={() => setShowReplyIntent(true)}
          onPin={() => updateInboxPrefs((p) => togglePinnedPref(p, selected.id))}
          onArchive={() => updateInboxPrefs((p) => toggleArchivedPref(p, selected.id))}
          onSnooze={(hours) =>
            updateInboxPrefs((p) =>
              snoozeConversationPref(p, selected.id, Date.now() + hours * 60 * 60_000)
            )
          }
          onSchedule={() => {
            setScheduleDefaultText('');
            setScheduleOpen(true);
          }}
          isPinned={isConversationPinned(inboxPrefs, selected.id)}
          isArchived={isConversationArchived(inboxPrefs, selected.id)}
          onSearchInThread={() => setInThreadSearchOpen(true)}
          hideOnMobile={!mobileShowThread}
        />
      )}

      {selected && (
        <ReplyIntentPanel
          open={showReplyIntent}
          onClose={() => setShowReplyIntent(false)}
          conversation={selected}
          contactId={selectedContactId}
          onContactUpdated={() => {
            /* contatos atualizados via socket / próximo sync */
          }}
        />
      )}

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

      <WaForwardModal
        open={Boolean(forwardMsg)}
        messageText={forwardMsg?.text || ''}
        conversations={sortedConversations}
        displayById={displayById}
        excludeId={selected?.id}
        onClose={() => setForwardMsg(null)}
        onForward={handleForward}
      />

      <WaScheduleModal
        open={scheduleOpen}
        defaultText={scheduleDefaultText}
        onClose={() => setScheduleOpen(false)}
        onConfirm={handleScheduleConfirm}
      />

      <WaMediaPreviewModal
        open={Boolean(mediaPreviewFile)}
        file={mediaPreviewFile}
        busy={sendingMedia}
        onClose={() => setMediaPreviewFile(null)}
        onSend={handleMediaPreviewSend}
      />
      </div>
    </div>
  );
};

export default WaWebChatApp;
