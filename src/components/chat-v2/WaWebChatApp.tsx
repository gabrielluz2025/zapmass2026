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
import type { Conversation } from '../../types';
import { WaInbox } from './WaInbox';
import { WaThread } from './WaThread';
import { WaChannelRail } from './WaChannelRail';
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
import {
  isInboxFullSyncDoneToday,
  markInboxFullSyncDoneForToday,
} from '../../utils/tenantDailyCache';

export const WaWebChatApp: React.FC<{
  autoSelectedConversationId?: string | null;
  onClearAutoSelected?: () => void;
}> = ({ autoSelectedConversationId, onClearAutoSelected }) => {
  const { user } = useAuth();
  const { effectiveWorkspaceUid } = useWorkspace();
  const tenantUid = effectiveWorkspaceUid ?? user?.uid ?? '';
  const crm = useClientCrm(user?.uid);
  const conversations = useZapMassConversations();
  const { inboxHasMore, inboxLoadingMore, loadMoreInbox } = useZapMassInboxPagination();
  const connections = useZapMassConnectionsSlice();
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
  const { sending: sendingMedia, sendFile: sendChatFile } = useSendChatMedia(sendMedia);
  /** Evita pedir a mesma foto várias vezes ao servidor (prefetch + chat aberto). */
  const pictureAttemptedRef = useRef<Set<string>>(new Set());
  const historyRequestedRef = useRef<Map<string, number>>(new Map());
  const historyInitializedRef = useRef<Set<string>>(new Set());
  const HISTORY_LEVELS = [200, 600, 1500, 3500, 8000];

  const requestSync = useCallback((opts?: { full?: boolean }) => {
    if (socket?.connected) socket.emit('request-conversations-sync', opts);
  }, [socket]);

  const { socketStatus, syncing, runResync } = useWaRealtime(socket, requestSync, {
    chipsConnected: connectedChannels.length
  });

  /** Atendimento: sync completo no máximo 1× por dia; se inbox vazia, força full (ex.: pós-deploy). */
  const initialFullSyncDoneRef = useRef(false);
  const emptyInboxRecoveryRef = useRef(false);

  useEffect(() => {
    if (!isBackendConnected || !socket?.connected || connectedChannels.length === 0 || !tenantUid) return;
    if (initialFullSyncDoneRef.current) return;
    initialFullSyncDoneRef.current = true;
    if (isInboxFullSyncDoneToday(tenantUid)) {
      requestSync({ full: false });
      return;
    }
    markInboxFullSyncDoneForToday(tenantUid);
    runResync({ full: true });
    requestSync({ full: true });
  }, [isBackendConnected, socket, connectedChannels.length, tenantUid, runResync, requestSync]);

  /** Chips online mas zero conversas — servidor pode ter reiniciado (RAM vazia). */
  useEffect(() => {
    if (!isBackendConnected || !socket?.connected || connectedChannels.length === 0) return;
    if (conversations.length > 0) {
      emptyInboxRecoveryRef.current = false;
      return;
    }
    if (emptyInboxRecoveryRef.current) return;
    emptyInboxRecoveryRef.current = true;
    const t = window.setTimeout(() => {
      requestSync({ full: true });
      runResync({ full: true });
    }, 2800);
    return () => window.clearTimeout(t);
  }, [
    isBackendConnected,
    socket,
    connectedChannels.length,
    conversations.length,
    requestSync,
    runResync,
  ]);

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

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
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
  }, [sortedConversations, deferredSearch, unreadOnly, connectionFilterId, displayById]);

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

  /** Prefetch leve — só primeiras conversas visíveis (evita 60 round-trips ao abrir a aba). */
  useEffect(() => {
    const MAX = 28;
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
      void hydrateFirestoreChatArchive(selected.id, 500);
    }, 70);
    return () => window.clearTimeout(t);
  }, [selected?.id, isSelectedDraft, hydrateFirestoreChatArchive]);

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
    runResync({ full: true });
    requestSync({ full: true });
    toast.success('Sincronizando com o WhatsApp…', { duration: 2500 });
  }, [runResync, requestSync]);

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

  const loadOlder = useCallback(() => {
    if (selected?.id) void loadMoreHistory(selected.id);
  }, [selected?.id, loadMoreHistory]);

  // Auto-load sequencial de histórico ao abrir conversa — espera cada nível terminar antes do próximo
  const autoLoadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selected?.id || isSelectedDraft || !socket?.connected) return;
    if (autoLoadedRef.current.has(selected.id)) return;
    autoLoadedRef.current.add(selected.id);

    const convId = selected.id;
    const loadSequential = async () => {
      // Aguarda 300ms para hydrate terminar antes de começar
      await new Promise((r) => setTimeout(r, 300));
      // Carrega todos os níveis sequencialmente até o nível máximo (8000)
      for (let i = 0; i < HISTORY_LEVELS.length; i++) {
        // Para se trocou de conversa
        if (autoLoadedRef.current.has(convId) === false) break;
        await loadMoreHistory(convId, true);
        // Pequena pausa entre níveis para não sobrecarregar o socket
        if (i < HISTORY_LEVELS.length - 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    };
    void loadSequential();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, isSelectedDraft]);

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

  const selectedDisplay = selected ? displayById.get(selected.id) : null;
  const selectedTitle = selected
    ? inboxListTitle(selectedDisplay, selected)
    : '';

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="wa-chat-pro wa-pipeline-root flex min-h-0 flex-1">

      {/* ── Rail de canais (3ª coluna à esquerda) ── */}
      <WaChannelRail
        connections={connections}
        conversations={sortedConversations}
        activeId={connectionFilterId}
        onChange={setConnectionFilterId}
      />

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
        onRequestPicture={requestConversationPicture}
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
        isDraft={isSelectedDraft}
        draftChannels={connections}
        draftChannelId={selectedDraftChannelId}
        onDraftChannelChange={handleDraftChannelChange}
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
    </div>
  );
};

export default WaWebChatApp;
