import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  Search,
  Send,
  Check,
  CheckCheck,
  ArrowLeft,
  ArrowUp,
  History,
  Loader2,
  Mic,
  Smartphone,
  Trash2,
  Users,
  Smile,
  X,
  MessageCircle,
  ArrowDown,
  Paperclip,
  MoreVertical,
  Info,
  ShieldCheck,
  Zap,
  Workflow,
  ChevronRight,
  Package,
  Eye,
  CornerDownLeft,
  LayoutGrid,
  List,
  Pin,
  StickyNote,
  Bell,
  Star,
  Copy,
  RotateCcw,
  Image as ImageIcon
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useZapMass } from '../context/ZapMassContext';
import { ClientPipelineBoard } from './chat/ClientPipelineBoard';
import { ClientCrmPanel } from './chat/ClientCrmPanel';
import { ChatEmptyShowcase } from './chat/ChatEmptyShowcase';
import { useClientCrm, STATUS_META, hashTagColor } from './chat/useClientCrm';
import { Conversation, ChatMessage } from '../types';
import { Input, Modal, Select, Tabs, Badge, Button } from './ui';

// =====================================================================
// Origem de uma conversa — usada para separar o que veio do celular
// do que foi criado pelo sistema (ex: campanha para numero sem chat previo).
// =====================================================================
type ConversationOrigin = 'phone' | 'system' | 'empty';

const classifyConversation = (conv: Conversation): ConversationOrigin => {
  const msgs = conv.messages || [];
  if (msgs.length === 0) return 'empty';
  // Se NUNCA teve mensagem do contato ('them') E todas as 'me' sao de campanha,
  // consideramos criada pelo sistema (nao ha conversa real no celular ainda).
  const hasIncoming = msgs.some((m) => m.sender === 'them');
  if (hasIncoming) return 'phone';
  const allFromCampaign = msgs.every((m) => m.sender === 'me' && m.fromCampaign === true);
  if (allFromCampaign) return 'system';
  return 'phone';
};

const EMOJI_GROUPS = [
  { label: 'Mais usados', emojis: ['😊','😂','❤️','👍','🙏','😍','🔥','😭','😘','🥰','😁','🤣','💕','😅','👏','🎉','💪','✨','😎','🤗'] },
  { label: 'Rostos', emojis: ['😀','😃','😄','😁','😆','🥹','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😋','😎','🥳','😔','😴','🤔','😐','🙄','😬','😮','😯','🤯','🤠'] },
  { label: 'Gestos', emojis: ['👋','🤚','🖐️','✋','🖖','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🙏'] },
  { label: 'Objetos', emojis: ['💬','💭','💡','🔔','🎵','📱','💻','📷','📹','📞','📧','📦','📝','📋','📌','📎','🔑'] }
];

const QUICK_REPLIES = [
  { text: 'Ola! Tudo bem?', emoji: '👋' },
  { text: 'Obrigado pelo contato!', emoji: '🙏' },
  { text: 'Vou verificar e ja retorno.', emoji: '🔍' },
  { text: 'Perfeito! Vamos la!', emoji: '🚀' },
  { text: 'Pode me enviar mais detalhes?', emoji: '📝' }
];

/** Agregados da conversa para a faixa de pipeline (saidas + respostas recebidas). */
const getConversationPipelineAgg = (conv: Conversation | undefined) => {
  if (!conv) return null;
  const msgs = conv.messages || [];
  const outbound = msgs.filter((m) => m.sender === 'me');
  const inbound = msgs.filter((m) => m.sender === 'them');
  return {
    sent: outbound.length,
    delivered: outbound.filter((m) => m.status === 'delivered' || m.status === 'read').length,
    read: outbound.filter((m) => m.status === 'read').length,
    replies: inbound.length
  };
};

const MessagePipelineStrip: React.FC<{
  agg: NonNullable<ReturnType<typeof getConversationPipelineAgg>>;
}> = ({ agg }) => {
  const stages = [
    { key: 'sent', label: 'Enviadas', value: agg.sent, Icon: Send },
    { key: 'delivered', label: 'Entregues', value: agg.delivered, Icon: Package },
    { key: 'read', label: 'Lidas', value: agg.read, Icon: Eye },
    { key: 'replies', label: 'Respostas', value: agg.replies, Icon: CornerDownLeft }
  ] as const;
  return (
    <div
      className="px-3 py-2.5 flex-shrink-0 overflow-x-auto"
      style={{
        background: 'var(--surface-0)',
        borderBottom: '1px solid var(--border-subtle)'
      }}
    >
      <div className="flex items-stretch gap-0.5 min-w-max md:min-w-0 md:justify-between md:max-w-3xl md:mx-auto">
        {stages.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <div className="flex items-center px-0.5 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                <ChevronRight className="w-4 h-4 opacity-50" />
              </div>
            )}
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2 min-w-[100px] flex-1 md:flex-none"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border-subtle)'
              }}
              title={`${s.label}: mensagens neste estagio nesta conversa`}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--brand-600)' }}
              >
                <s.Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[16px] font-bold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                  {s.value.toLocaleString('pt-BR')}
                </p>
                <p className="text-[10px] font-medium mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
                  {s.label}
                </p>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

/** Barra compacta por mensagem enviada: enviado / entregue / lido. */
const OutboundPipelineBar: React.FC<{ status: ChatMessage['status'] }> = ({ status }) => {
  const filled = status === 'read' ? 3 : status === 'delivered' ? 2 : 1;
  const tip =
    status === 'read' ? 'Lido pelo destinatario' : status === 'delivered' ? 'Entregue no aparelho' : 'Enviado ao servidor';
  return (
    <span className="inline-flex items-center gap-px align-middle" title={tip}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className="h-[3px] rounded-full"
          style={{
            width: n === 3 && status === 'read' ? 12 : 10,
            background:
              n <= filled ? (n === 3 && status === 'read' ? '#bae6fd' : 'rgba(255,255,255,0.88)') : 'rgba(255,255,255,0.22)'
          }}
        />
      ))}
    </span>
  );
};

export const ChatTab: React.FC = () => {
  const {
    conversations,
    connections,
    sendMessage,
    markAsRead,
    fetchConversationPicture,
    deleteLocalConversations,
    loadChatHistory,
    loadMessageMedia
  } = useZapMass();
  const { user } = useAuth();
  const crm = useClientCrm(user?.uid);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  // Conversas "rascunho" criadas localmente para contatos sem histórico real.
  // Permitem abrir o chat e enviar a primeira mensagem sem depender de campanha.
  // Assim que o servidor responde com a conversa real (mesmo id), o rascunho
  // é automaticamente descartado pela mesclagem em `mergedConversations`.
  const [draftConversations, setDraftConversations] = useState<Conversation[]>([]);
  // Canal escolhido por draft (id da conversa draft -> id da conexão).
  const [draftChannelById, setDraftChannelById] = useState<Record<string, string>>({});
  const [pipelineView, setPipelineView] = useState<'lista' | 'quadro'>('lista');
  const [inputText, setInputText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | 'ALL'>('ALL');
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'groups' | 'system' | 'empty' | 'pinned'>('all');
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [searchInChat, setSearchInChat] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [auditSelection, setAuditSelection] = useState<Set<string>>(new Set());
  const [auditCategory, setAuditCategory] = useState<ConversationOrigin>('system');
  // Historico: rastreia por chat qual o ultimo limite solicitado + se esta carregando.
  // Isso permite carregamento progressivo tipo "WhatsApp Web" ao rolar para o topo.
  const historyRequestedRef = useRef<Map<string, number>>(new Map());
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [historyExhausted, setHistoryExhausted] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pipelineViewStorageKey = useMemo(
    () => `zapmass-pipeline-tab-view:v1:${user?.uid || 'anon'}`,
    [user?.uid]
  );

  useEffect(() => {
    try {
      const s = localStorage.getItem(pipelineViewStorageKey);
      if (s === 'quadro' || s === 'lista') setPipelineView(s);
    } catch {
      /* ignore */
    }
  }, [pipelineViewStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(pipelineViewStorageKey, pipelineView);
    } catch {
      /* ignore */
    }
  }, [pipelineView, pipelineViewStorageKey]);

  // Handshake vindo da aba Contatos: abrir conversa por telefone.
  // Evita prop drilling — Contatos grava sessionStorage + navega, aqui resolvemos.
  // Se não existir conversa real com esse número, criamos um rascunho local
  // para que o usuário possa iniciar o chat direto (sem precisar de campanha).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('zapmass.openChatByPhone');
      if (!raw) return;
      sessionStorage.removeItem('zapmass.openChatByPhone');

      // Aceita tanto string pura (legado) quanto payload JSON {phone, name, profilePicUrl}
      let phoneRaw = raw;
      let contactName = '';
      let profilePicUrl = '';
      if (raw.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(raw) as { phone?: string; name?: string; profilePicUrl?: string };
          phoneRaw = parsed.phone || '';
          contactName = (parsed.name || '').trim();
          profilePicUrl = parsed.profilePicUrl || '';
        } catch {
          /* ignora, segue como string pura */
        }
      }

      const digits = (phoneRaw || '').replace(/\D/g, '');
      if (!digits) return;

      // Procura conversa que case o contactPhone (flexibilidade BR: com/sem 55).
      const matchesDigits = (cd: string) =>
        !!cd &&
        (cd === digits ||
          cd.endsWith(digits) ||
          digits.endsWith(cd) ||
          (cd.length >= 10 && digits.length >= 10 && cd.slice(-10) === digits.slice(-10)));

      const candidatesReal = conversations.filter((c) =>
        matchesDigits((c.contactPhone || '').replace(/\D/g, ''))
      );
      const candidatesDraft = draftConversations.filter((c) =>
        matchesDigits((c.contactPhone || '').replace(/\D/g, ''))
      );

      if (candidatesReal.length > 0) {
        const best = candidatesReal.sort(
          (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
        )[0];
        setSelectedChatId(best.id);
        setShowMobileChat(true);
        return;
      }

      if (candidatesDraft.length > 0) {
        setSelectedChatId(candidatesDraft[0].id);
        setShowMobileChat(true);
        return;
      }

      // Nenhum histórico: vamos criar um rascunho local de conversa.
      // Se não houver canal, ainda assim abrimos o chat (somente envio fica bloqueado).
      const connectedList = connections.filter((c) => c.status === 'CONNECTED');
      const chosen = connectedList[0] || connections[0];
      // id segue o padrão do backend quando há canal; sem canal usamos id local.
      const draftId = chosen ? `${chosen.id}:${digits}@c.us` : `draft:${digits}`;
      const displayName = contactName || `+${digits}`;
      const draft: Conversation = {
        id: draftId,
        contactName: displayName,
        contactPhone: digits,
        profilePicUrl: profilePicUrl || undefined,
        connectionId: chosen?.id || '',
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: '',
        lastMessageTimestamp: Date.now(),
        messages: [],
        tags: [],
      };
      setDraftConversations((prev) => {
        if (prev.some((d) => d.id === draftId)) return prev;
        return [...prev, draft];
      });
      setDraftChannelById((prev) => ({
        ...prev,
        [draftId]: chosen?.id || ''
      }));
      setSelectedChatId(draftId);
      setShowMobileChat(true);
      if (!chosen) {
        toast('Conversa aberta sem canal. Escolha um canal para enviar a primeira mensagem.', {
          icon: 'ℹ️',
          duration: 4500
        });
      } else if (chosen.status !== 'CONNECTED') {
        toast(
          'Atenção: a conexão selecionada não está online. Conecte-a antes de enviar a mensagem.',
          { icon: '⚠️', duration: 4500 }
        );
      }
    } catch {
      /* ignore */
    }
    // Queremos rodar apenas uma vez quando conversations carrega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length, connections.length]);

  // Mescla conversas reais + rascunhos locais (reais têm prioridade).
  // Quando o servidor retorna a conversa real com mesmo id, o rascunho é
  // descartado automaticamente.
  const mergedConversations = useMemo(() => {
    if (draftConversations.length === 0) return conversations;
    const realIds = new Set(conversations.map((c) => c.id));
    const validDrafts = draftConversations.filter((d) => !realIds.has(d.id));
    if (validDrafts.length === 0) return conversations;
    return [...conversations, ...validDrafts];
  }, [conversations, draftConversations]);

  // Limpa rascunhos cujos ids já existem entre as conversas reais.
  useEffect(() => {
    if (draftConversations.length === 0) return;
    const realIds = new Set(conversations.map((c) => c.id));
    const stillPending = draftConversations.filter((d) => !realIds.has(d.id));
    if (stillPending.length !== draftConversations.length) {
      setDraftConversations(stillPending);
      const stillIds = new Set(stillPending.map((d) => d.id));
      setDraftChannelById((prev) => {
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(prev)) {
          if (stillIds.has(key)) next[key] = value;
        }
        return next;
      });
    }
  }, [conversations, draftConversations]);

  const selectedConversation = mergedConversations.find((c) => c.id === selectedChatId);
  const selectedConnection = connections.find((c) => c.id === selectedConversation?.connectionId);
  const pipelineAgg = useMemo(() => getConversationPipelineAgg(selectedConversation), [selectedConversation]);
  // Verdadeiro quando a conversa selecionada ainda é apenas um rascunho local
  // (usuário clicou em "abrir chat" para um contato que não tem histórico).
  const isSelectedDraft = useMemo(
    () => !!selectedChatId && draftConversations.some((d) => d.id === selectedChatId),
    [selectedChatId, draftConversations]
  );
  const selectedDraftChannelId = useMemo(() => {
    if (!selectedChatId) return '';
    return draftChannelById[selectedChatId] || selectedConversation?.connectionId || '';
  }, [selectedChatId, draftChannelById, selectedConversation?.connectionId]);
  const canSendCurrent = useMemo(() => {
    if (!selectedChatId) return false;
    if (!inputText.trim()) return false;
    if (!isSelectedDraft) return true;
    return !!selectedDraftChannelId;
  }, [selectedChatId, inputText, isSelectedDraft, selectedDraftChannelId]);

  const filteredByConnection =
    selectedConnectionId === 'ALL'
      ? mergedConversations
      : mergedConversations.filter((c) => c.connectionId === selectedConnectionId);

  // Classifica uma unica vez e reusa em filtros + contadores
  const originByConv = useMemo(() => {
    const map = new Map<string, ConversationOrigin>();
    for (const c of mergedConversations) map.set(c.id, classifyConversation(c));
    return map;
  }, [mergedConversations]);

  const filteredConversations = useMemo(() => {
    let list = filteredByConnection;
    if (chatFilter === 'unread') list = list.filter((c) => c.unreadCount > 0);
    if (chatFilter === 'groups') list = list.filter((c) => c.id.endsWith('@g.us'));
    if (chatFilter === 'system') list = list.filter((c) => originByConv.get(c.id) === 'system');
    if (chatFilter === 'empty') list = list.filter((c) => originByConv.get(c.id) === 'empty');
    if (chatFilter === 'pinned') list = list.filter((c) => crm.get(c.id).pinned);
    return list
      .filter(
        (c) =>
          c.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.contactPhone.includes(searchTerm)
      )
      .sort((a, b) => {
        // Fixados sempre no topo
        const pa = crm.get(a.id).pinned ? 1 : 0;
        const pb = crm.get(b.id).pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
      });
  }, [filteredByConnection, chatFilter, searchTerm, originByConv, crm]);

  const totalUnread = filteredByConnection.reduce((a, c) => a + c.unreadCount, 0);
  const totalGroups = filteredByConnection.filter((c) => c.id.endsWith('@g.us')).length;
  const totalSystem = filteredByConnection.filter((c) => originByConv.get(c.id) === 'system').length;
  const totalEmpty = filteredByConnection.filter((c) => originByConv.get(c.id) === 'empty').length;
  const totalPhone = filteredByConnection.filter((c) => originByConv.get(c.id) === 'phone').length;

  // Listas usadas no modal de auditoria
  const systemConvs = useMemo(
    () => conversations.filter((c) => originByConv.get(c.id) === 'system'),
    [conversations, originByConv]
  );
  const emptyConvs = useMemo(
    () => conversations.filter((c) => originByConv.get(c.id) === 'empty'),
    [conversations, originByConv]
  );
  const phoneConvs = useMemo(
    () => conversations.filter((c) => originByConv.get(c.id) === 'phone'),
    [conversations, originByConv]
  );

  const auditList =
    auditCategory === 'system' ? systemConvs : auditCategory === 'empty' ? emptyConvs : phoneConvs;

  const toggleAuditRow = (id: string) => {
    setAuditSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAuditAll = () => {
    setAuditSelection((prev) => {
      if (prev.size === auditList.length) return new Set();
      return new Set(auditList.map((c) => c.id));
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(auditSelection);
    if (ids.length === 0) {
      toast('Selecione ao menos uma conversa.');
      return;
    }
    const removed = await deleteLocalConversations(ids);
    if (removed > 0) {
      setAuditSelection(new Set());
      if (ids.includes(selectedChatId || '')) setSelectedChatId(null);
    }
  };

  const handleDeleteSingle = async (id: string) => {
    await deleteLocalConversations([id]);
    if (selectedChatId === id) setSelectedChatId(null);
  };

  // Carrega/expande o historico do chat ativo usando a API do servidor.
  // Cada chamada usa um limite maior que a anterior (progressivo: 200 -> 600 -> 1500 -> 3500 -> 8000).
  const HISTORY_LEVELS = [200, 600, 1500, 3500, 8000];

  const loadMoreHistoryFor = useCallback(
    async (conversationId: string, forceNext: boolean = false, silent: boolean = false) => {
      if (!conversationId) return;
      if (historyExhausted.has(conversationId) && !forceNext) return;
      const current = historyRequestedRef.current.get(conversationId) || 0;
      const nextLevel =
        HISTORY_LEVELS.find((lvl) => lvl > current) || HISTORY_LEVELS[HISTORY_LEVELS.length - 1];
      if (nextLevel === current && !forceNext) return;

      historyRequestedRef.current.set(conversationId, nextLevel);
      setHistoryLoading(conversationId);
      const prevCount =
        conversations.find((c) => c.id === conversationId)?.messages.length || 0;
      const res = await loadChatHistory(conversationId, nextLevel, false);
      setHistoryLoading((prev) => (prev === conversationId ? null : prev));
      if (!res.ok) {
        // Erros esperados em conversas vazias/criadas por sistema — nao incomodar o usuario.
        // Tambem suprimimos toasts em carregamentos automaticos (scroll ou auto-abrir).
        const suppressed = ['Conversa nao encontrada.', 'Chat nao encontrado no cliente.', 'Canal desconectado.'];
        if (res.error && !silent && !suppressed.includes(res.error)) {
          toast.error(res.error);
        }
        return;
      }
      // Se carregou e nao aumentou o total, significa que chegamos no inicio
      if (res.total <= prevCount + 2 && nextLevel >= HISTORY_LEVELS[HISTORY_LEVELS.length - 1]) {
        setHistoryExhausted((prev) => new Set(prev).add(conversationId));
      }
    },
    [historyExhausted, loadChatHistory, conversations]
  );

  // Auto-carrega historico ao abrir um chat que ainda tem poucas mensagens.
  useEffect(() => {
    if (!selectedChatId) return;
    // Rascunhos locais não têm histórico no servidor — ignoramos.
    if (isSelectedDraft) return;
    const conv = conversations.find((c) => c.id === selectedChatId);
    if (!conv) return;
    const already = historyRequestedRef.current.get(selectedChatId) || 0;
    if (already > 0) return;
    // Primeiro carregamento quando temos menos que 60 mensagens cacheadas
    if (conv.messages.length < 60) {
      loadMoreHistoryFor(selectedChatId, true, true);
    }
  }, [selectedChatId, conversations, loadMoreHistoryFor, isSelectedDraft]);

  const handleLoadMediaOnDemand = async (messageId: string) => {
    if (!selectedChatId) return;
    const res = await loadMessageMedia(selectedChatId, messageId);
    if (!res.ok && res.error) toast.error(res.error);
  };

  useEffect(() => {
    // Não faz sentido marcar como lida em um rascunho local.
    if (selectedChatId && !isSelectedDraft) markAsRead(selectedChatId);
  }, [selectedChatId, selectedConversation?.messages.length, isSelectedDraft]);

  useEffect(() => {
    if (selectedChatId && selectedConversation && !selectedConversation.profilePicUrl && !isSelectedDraft) {
      fetchConversationPicture(selectedChatId);
    }
  }, [selectedChatId, selectedConversation?.profilePicUrl, isSelectedDraft]);

  useEffect(() => {
    if (!showChatMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) {
        setShowChatMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showChatMenu]);

  // Para preservar a posicao de rolagem apos carregar historico antigo (senao o
  // usuario "pula" para o topo sozinho). Guardamos a altura/scroll antes do update.
  const scrollPreserveRef = useRef<{ id: string; height: number; top: number } | null>(null);

  useEffect(() => {
    // Se estamos preservando scroll para um chat que acabou de receber historico,
    // ajustamos pelo delta de altura para manter o mesmo ponto visivel.
    if (
      scrollPreserveRef.current &&
      selectedChatId === scrollPreserveRef.current.id &&
      messagesContainerRef.current
    ) {
      const el = messagesContainerRef.current;
      const delta = el.scrollHeight - scrollPreserveRef.current.height;
      el.scrollTop = scrollPreserveRef.current.top + delta;
      scrollPreserveRef.current = null;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConversation?.messages, selectedChatId]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(fromBottom > 200);
    // Carregamento progressivo quando chega perto do topo (200px)
    if (
      selectedChatId &&
      el.scrollTop < 200 &&
      historyLoading !== selectedChatId &&
      !historyExhausted.has(selectedChatId)
    ) {
      scrollPreserveRef.current = {
        id: selectedChatId,
        height: el.scrollHeight,
        top: el.scrollTop
      };
      loadMoreHistoryFor(selectedChatId, false, true);
    }
  }, [selectedChatId, historyLoading, historyExhausted, loadMoreHistoryFor]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  const selectChat = (id: string) => {
    setSelectedChatId(id);
    setShowMobileChat(true);
    setShowContactInfo(false);
    setShowEmojiPicker(false);
    setShowChatSearch(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || !selectedChatId) return;
    if (isSelectedDraft) {
      const digits = (selectedConversation?.contactPhone || '').replace(/\D/g, '');
      const chosenConnectionId = selectedDraftChannelId;
      if (!chosenConnectionId) {
        toast.error('Escolha um canal para enviar a primeira mensagem.');
        return;
      }
      if (!digits) {
        toast.error('Telefone inválido para iniciar conversa.');
        return;
      }

      const realConversationId = `${chosenConnectionId}:${digits}@c.us`;
      if (realConversationId !== selectedChatId) {
        setDraftConversations((prev) =>
          prev.map((d) =>
            d.id === selectedChatId ? { ...d, id: realConversationId, connectionId: chosenConnectionId } : d
          )
        );
        setDraftChannelById((prev) => {
          const next = { ...prev };
          delete next[selectedChatId];
          next[realConversationId] = chosenConnectionId;
          return next;
        });
        setSelectedChatId(realConversationId);
      }
      sendMessage(realConversationId, inputText);
    } else {
      sendMessage(selectedChatId, inputText);
    }
    setInputText('');
    setShowEmojiPicker(false);
    setShowQuickReplies(false);
    inputRef.current?.focus();
  };

  const insertEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const getAvatar = (name: string, pic?: string) =>
    pic || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=059669&color=fff&size=200`;

  const getLastMsgPreview = (conv: Conversation) => {
    const last = conv.messages[conv.messages.length - 1];
    if (!last) return conv.lastMessage || '';
    if (last.type === 'image') return 'Foto';
    if (last.type === 'video') return 'Video';
    if (last.type === 'audio') return 'Audio';
    if (last.type === 'sticker') return 'Figurinha';
    if (last.type === 'document') return 'Documento';
    return conv.lastMessage || last.text || '';
  };

  const getLastMsgIcon = (conv: Conversation) => {
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.sender !== 'me') return null;
    if (last.status === 'read')
      return <CheckCheck className="w-[14px] h-[14px] flex-shrink-0 text-blue-400" />;
    if (last.status === 'delivered')
      return <CheckCheck className="w-[14px] h-[14px] flex-shrink-0" style={{ color: 'var(--text-3)' }} />;
    return <Check className="w-[14px] h-[14px] flex-shrink-0" style={{ color: 'var(--text-3)' }} />;
  };

  const highlightMatch = (text: string, highlight: string) => {
    if (!highlight.trim()) return text;
    const re = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(re);
    return parts.map((p, i) =>
      re.test(p) ? (
        <span key={i} style={{ background: 'rgba(16,185,129,0.3)', borderRadius: 2 }}>
          {p}
        </span>
      ) : (
        p
      )
    );
  };

  const renderMediaPlaceholder = (msg: ChatMessage, label: string, icon: string) => (
    <button
      type="button"
      onClick={() => handleLoadMediaOnDemand(msg.id)}
      className="flex items-center gap-2 p-2 rounded-md mb-1 transition-colors hover:bg-black/10"
      style={{ background: 'rgba(0,0,0,0.06)', minWidth: 160 }}
      title="Baixar midia do celular"
    >
      <span className="text-lg">{icon}</span>
      <span className="text-[12px] opacity-80 truncate">{label}</span>
      <ArrowDown className="w-3 h-3 ml-auto opacity-60" />
    </button>
  );

  const renderMessageContent = (msg: ChatMessage) => {
    const isMedia = msg.type !== 'text';
    if (msg.type === 'sticker' && msg.mediaUrl)
      return <img src={msg.mediaUrl} alt="" className="w-32 h-32 object-contain" />;
    if (msg.type === 'image' && msg.mediaUrl)
      return (
        <div className="rounded-md overflow-hidden mb-1 cursor-pointer" style={{ maxWidth: 330 }}>
          <img src={msg.mediaUrl} alt="" className="w-full object-cover" style={{ minHeight: 100, maxHeight: 330 }} />
        </div>
      );
    if (msg.type === 'video' && msg.mediaUrl)
      return (
        <div className="rounded-md overflow-hidden mb-1" style={{ maxWidth: 330 }}>
          <video src={msg.mediaUrl} controls className="w-full" style={{ maxHeight: 280 }} />
        </div>
      );
    if (msg.type === 'document' && msg.mediaUrl)
      return (
        <a
          href={msg.mediaUrl}
          download
          className="flex items-center gap-3 p-3 rounded-lg mb-1"
          style={{ background: 'rgba(255,255,255,0.06)', minWidth: 240 }}
        >
          <div className="w-10 h-12 rounded-lg flex items-center justify-center flex-shrink-0 bg-black/20">
            <span className="text-xl">📄</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] truncate">{msg.text || 'Documento'}</p>
            <p className="text-[11px] opacity-70">Toque para baixar</p>
          </div>
        </a>
      );
    // Midia nao baixada ainda (veio do carregamento historico com skipMedia)
    if (isMedia && !msg.mediaUrl) {
      if (msg.type === 'image') return renderMediaPlaceholder(msg, 'Foto - toque para ver', '📷');
      if (msg.type === 'video') return renderMediaPlaceholder(msg, 'Video - toque para ver', '🎥');
      if (msg.type === 'audio') return renderMediaPlaceholder(msg, 'Audio - toque para ouvir', '🎙️');
      if (msg.type === 'sticker') return renderMediaPlaceholder(msg, 'Figurinha', '🌟');
      if (msg.type === 'document') return renderMediaPlaceholder(msg, msg.text || 'Documento', '📄');
    }
    return (
      <span style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
        {searchInChat ? highlightMatch(msg.text, searchInChat) : msg.text}
      </span>
    );
  };

  return (
    <div
      className="flex h-[calc(100vh-5.5rem)] overflow-hidden rounded-xl"
      style={{
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)'
      }}
    >
      <div
        className={`${showMobileChat ? 'hidden md:flex' : 'flex'} w-full flex-col flex-shrink-0 ${
          pipelineView === 'quadro' ? 'md:flex-1 md:min-w-0 md:max-w-[min(960px,64vw)]' : 'md:w-[380px]'
        }`}
        style={{ background: 'var(--surface-0)', borderRight: '1px solid var(--border-subtle)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center brand-soft flex-shrink-0">
              <Workflow className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="ui-title text-[15px] leading-tight">Pipeline</h2>
              <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                <Smartphone className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                {totalPhone} do celular
                {totalSystem > 0 && (
                  <span style={{ color: 'var(--warning, #f59e0b)' }}> • {totalSystem} do sistema</span>
                )}
                {totalEmpty > 0 && (
                  <span style={{ color: 'var(--text-3)' }}> • {totalEmpty} vazias</span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setAuditCategory(totalSystem > 0 ? 'system' : totalEmpty > 0 ? 'empty' : 'phone');
              setAuditSelection(new Set());
              setShowAudit(true);
            }}
            className="flex-shrink-0 p-2 rounded-lg transition-colors"
            style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}
            title="Auditar origem das conversas"
          >
            <ShieldCheck className="w-4 h-4" />
          </button>
        </div>

        {(totalSystem > 0 || totalEmpty > 0) && (
          <div
            className="mx-3 mt-3 rounded-lg px-3 py-2 flex items-start gap-2 cursor-pointer"
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.25)'
            }}
            onClick={() => {
              setAuditCategory(totalSystem > 0 ? 'system' : 'empty');
              setAuditSelection(new Set());
              setShowAudit(true);
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-semibold leading-tight" style={{ color: 'var(--text-1)' }}>
                {totalSystem + totalEmpty} conversa{totalSystem + totalEmpty === 1 ? '' : 's'} nao {totalSystem + totalEmpty === 1 ? 'veio' : 'vieram'} do celular
              </p>
              <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                Clique para revisar e apagar.
              </p>
            </div>
          </div>
        )}

        <div className="px-3 py-3 space-y-2.5 flex-shrink-0">
          <Input
            leftIcon={<Search className="w-4 h-4" />}
            rightIcon={
              searchTerm ? (
                <button onClick={() => setSearchTerm('')} type="button">
                  <X className="w-4 h-4" />
                </button>
              ) : undefined
            }
            placeholder="Pesquisar conversas"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          {connections.length > 0 && (
            <Select
              value={selectedConnectionId}
              onChange={(e) => setSelectedConnectionId(e.target.value as string | 'ALL')}
            >
              <option value="ALL">Todos os canais ({conversations.length})</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({conversations.filter((cv) => cv.connectionId === c.id).length})
                </option>
              ))}
            </Select>
          )}

          <Tabs
            value={chatFilter}
            onChange={(v) => setChatFilter(v as typeof chatFilter)}
            size="sm"
            items={[
              { id: 'all', label: 'Todas' },
              {
                id: 'unread',
                label: 'Nao lidas',
                badge: totalUnread > 0 ? <Badge variant="success">{totalUnread}</Badge> : undefined
              },
              ...(crm.stats.pinned > 0
                ? [{
                    id: 'pinned' as const,
                    label: 'Fixadas',
                    icon: <Pin className="w-3 h-3" />,
                    badge: <Badge variant="warning">{crm.stats.pinned}</Badge>
                  }]
                : []),
              {
                id: 'groups',
                label: 'Grupos',
                badge: totalGroups > 0 ? <Badge variant="neutral">{totalGroups}</Badge> : undefined
              },
              ...(totalSystem > 0
                ? [{
                    id: 'system' as const,
                    label: 'Disparo',
                    badge: <Badge variant="warning">{totalSystem}</Badge>
                  }]
                : []),
              ...(totalEmpty > 0
                ? [{
                    id: 'empty' as const,
                    label: 'Vazias',
                    badge: <Badge variant="neutral">{totalEmpty}</Badge>
                  }]
                : [])
            ]}
          />

          <Tabs
            value={pipelineView}
            onChange={(v) => setPipelineView(v as 'lista' | 'quadro')}
            size="sm"
            items={[
              { id: 'lista', label: 'Lista', icon: <List className="w-3.5 h-3.5 opacity-80" /> },
              { id: 'quadro', label: 'Quadro', icon: <LayoutGrid className="w-3.5 h-3.5 opacity-80" /> }
            ]}
          />
          {pipelineView === 'quadro' && (
            <p className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>
              Use &quot;Adicionar coluna&quot; no topo do quadro (ou o bloco tracejado à direita) para criar quantas colunas quiser. Arraste os cartoes entre elas. Dados salvos neste navegador.
            </p>
          )}
        </div>

        <div
          className={`flex-1 min-h-0 ${
            pipelineView === 'quadro' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'
          }`}
        >
          {pipelineView === 'quadro' ? (
            <ClientPipelineBoard
              userUid={user?.uid}
              conversations={filteredConversations}
              selectedChatId={selectedChatId}
              onSelectChat={selectChat}
              getAvatar={getAvatar}
              connectionName={(id) => connections.find((c) => c.id === id)?.name}
            />
          ) : (
            <>
          {filteredConversations.map((conv) => {
            const isActive = selectedChatId === conv.id;
            const isGroup = conv.id.endsWith('@g.us');
            const origin = originByConv.get(conv.id) || 'phone';
            const lastMsgPreview = getLastMsgPreview(conv);
            const lastIcon = getLastMsgIcon(conv);
            const connection = connections.find((c) => c.id === conv.connectionId);
            const crmData = crm.get(conv.id);
            const crmStatus = crmData.status ? STATUS_META[crmData.status] : null;
            const hasReminder = crmData.reminderAt && crmData.reminderAt > Date.now();
            const hasNotes = !!(crmData.notes && crmData.notes.trim());
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => selectChat(conv.id)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors group relative"
                style={{
                  background: isActive ? 'var(--surface-2)' : crmData.pinned ? 'rgba(245,158,11,0.04)' : 'transparent',
                  borderBottom: '1px solid var(--border-subtle)'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'var(--surface-1)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = crmData.pinned ? 'rgba(245,158,11,0.04)' : 'transparent';
                }}
              >
                {/* Barra lateral colorida do status */}
                {crmStatus && (
                  <span
                    className="absolute left-0 top-0 bottom-0 w-[3px]"
                    style={{ background: crmStatus.color }}
                    aria-hidden
                  />
                )}
                <div className="relative flex-shrink-0">
                  <img
                    src={getAvatar(conv.contactName, conv.profilePicUrl)}
                    className="w-11 h-11 rounded-full object-cover"
                    alt=""
                    style={crmStatus ? { boxShadow: `0 0 0 2px ${crmStatus.color}55` } : undefined}
                  />
                  {isGroup && (
                    <div
                      className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--surface-0)', border: '1.5px solid var(--border)' }}
                    >
                      <Users className="w-2.5 h-2.5" style={{ color: 'var(--text-2)' }} />
                    </div>
                  )}
                  {crmData.pinned && (
                    <div
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: '#f59e0b', boxShadow: '0 2px 6px rgba(245,158,11,0.5)' }}
                      title="Contato fixado"
                    >
                      <Pin className="w-2.5 h-2.5 text-white fill-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5 gap-2">
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      <span
                        className="text-[13.5px] font-semibold truncate"
                        style={{ color: 'var(--text-1)' }}
                      >
                        {conv.contactName}
                      </span>
                      {crmData.favoriteAt && (
                        <Star className="w-3 h-3 flex-shrink-0 fill-current" style={{ color: '#f59e0b' }} />
                      )}
                      {hasNotes && (
                        <StickyNote className="w-3 h-3 flex-shrink-0" style={{ color: '#10b981' }} />
                      )}
                      {hasReminder && (
                        <Bell className="w-3 h-3 flex-shrink-0" style={{ color: '#ef4444' }} />
                      )}
                    </div>
                    <span
                      className="text-[10.5px] flex-shrink-0 tabular-nums font-medium"
                      style={{ color: conv.unreadCount > 0 ? 'var(--brand-600)' : 'var(--text-3)' }}
                    >
                      {conv.lastMessageTime}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      {lastIcon}
                      <p className="text-[12.5px] truncate" style={{ color: 'var(--text-2)' }}>
                        {lastMsgPreview}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {crmStatus && (
                        <span
                          className="text-[9.5px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-0.5"
                          style={{ background: crmStatus.bg, color: crmStatus.color }}
                          title={`Status: ${crmStatus.label}`}
                        >
                          {crmStatus.emoji}
                        </span>
                      )}
                      {origin === 'system' && (
                        <span
                          className="text-[9.5px] px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 font-semibold"
                          style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
                          title="Conversa criada pelo disparo — nao existe historico no celular"
                        >
                          <Zap className="w-2.5 h-2.5" /> Disparo
                        </span>
                      )}
                      {origin === 'empty' && (
                        <span
                          className="text-[9.5px] px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                          title="Contato sincronizado, sem mensagens"
                        >
                          vazia
                        </span>
                      )}
                      {connections.length > 1 && connection && (
                        <span
                          className="text-[9.5px] px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                        >
                          {connection.name}
                        </span>
                      )}
                      {conv.unreadCount > 0 && (
                        <span
                          className="min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10.5px] font-bold px-1.5"
                          style={{ background: 'var(--brand-600)', color: '#fff' }}
                        >
                          {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Tags CRM inline */}
                  {(crmData.tags && crmData.tags.length > 0) && (
                    <div className="flex items-center gap-1 mt-1 overflow-hidden">
                      {crmData.tags.slice(0, 3).map((tag) => {
                        const color = hashTagColor(tag);
                        return (
                          <span
                            key={tag}
                            className="text-[9.5px] px-1.5 py-[1px] rounded-full font-semibold truncate"
                            style={{
                              background: `${color}1a`,
                              color,
                              border: `1px solid ${color}33`,
                              maxWidth: 80
                            }}
                          >
                            {tag}
                          </span>
                        );
                      })}
                      {crmData.tags.length > 3 && (
                        <span className="text-[9.5px]" style={{ color: 'var(--text-3)' }}>
                          +{crmData.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {/* Pin rapido no hover */}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    crm.togglePin(conv.id);
                    toast.success(crmData.pinned ? 'Desafixado' : 'Fixado no topo');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      crm.togglePin(conv.id);
                    }
                  }}
                  className={`absolute right-10 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-opacity cursor-pointer ${
                    crmData.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  style={{
                    background: crmData.pinned ? 'rgba(245,158,11,0.15)' : 'var(--surface-2)',
                    color: crmData.pinned ? '#f59e0b' : 'var(--text-3)'
                  }}
                  title={crmData.pinned ? 'Desafixar' : 'Fixar'}
                >
                  <Pin className={`w-3.5 h-3.5 ${crmData.pinned ? 'fill-current' : ''}`} />
                </span>
                {origin !== 'phone' && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSingle(conv.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        handleDeleteSingle(conv.id);
                      }
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-md transition-opacity cursor-pointer"
                    style={{ background: 'var(--surface-2)', color: 'var(--danger)' }}
                    title="Remover do painel"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </span>
                )}
              </button>
            );
          })}

          {filteredConversations.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                style={{ background: 'var(--surface-2)' }}
              >
                <MessageCircle className="w-5 h-5" style={{ color: 'var(--text-3)' }} />
              </div>
              <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                Nenhuma conversa
              </p>
              <p className="text-[12px] text-center mt-1" style={{ color: 'var(--text-3)' }}>
                {chatFilter === 'unread'
                  ? 'Voce leu todas as mensagens.'
                  : searchTerm
                  ? `Sem resultados para "${searchTerm}".`
                  : 'Nenhuma conversa disponivel.'}
              </p>
            </div>
          )}
            </>
          )}
        </div>
      </div>

      <div
        className={`${!showMobileChat && !selectedChatId ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-w-0`}
        style={{ background: 'var(--surface-1)' }}
      >
        {selectedConversation ? (
          <>
            <div
              className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
              style={{ background: 'var(--surface-0)', borderBottom: '1px solid var(--border-subtle)' }}
            >
              <button
                onClick={() => setShowMobileChat(false)}
                className="md:hidden p-1 -ml-1 mr-0.5"
                style={{ color: 'var(--text-2)' }}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
                onClick={() => setShowContactInfo(!showContactInfo)}
              >
                <div className="relative flex-shrink-0">
                  <img
                    src={getAvatar(selectedConversation.contactName, selectedConversation.profilePicUrl)}
                    className="w-9 h-9 rounded-full object-cover"
                    alt=""
                    style={
                      crm.get(selectedConversation.id).status
                        ? { boxShadow: `0 0 0 2px ${STATUS_META[crm.get(selectedConversation.id).status!].color}66` }
                        : undefined
                    }
                  />
                  {crm.get(selectedConversation.id).pinned && (
                    <div
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                      style={{ background: '#f59e0b' }}
                      title="Fixado"
                    >
                      <Pin className="w-2 h-2 text-white fill-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                      {selectedConversation.contactName}
                    </h3>
                    {(() => {
                      const s = crm.get(selectedConversation.id).status;
                      if (!s) return null;
                      const m = STATUS_META[s];
                      return (
                        <span
                          className="text-[9.5px] px-1.5 py-0.5 rounded-full font-bold inline-flex items-center gap-0.5"
                          style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}55` }}
                        >
                          <span>{m.emoji}</span>
                          {m.label}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-[11.5px] truncate" style={{ color: 'var(--text-3)' }}>
                    {selectedConversation.contactPhone}
                    {selectedConnection && <span> - {selectedConnection.name}</span>}
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    crm.togglePin(selectedConversation.id);
                    toast.success(crm.get(selectedConversation.id).pinned ? 'Desafixado' : 'Fixado no topo');
                  }}
                  title={crm.get(selectedConversation.id).pinned ? 'Desafixar' : 'Fixar'}
                >
                  <Pin
                    className={`w-4 h-4 ${crm.get(selectedConversation.id).pinned ? 'fill-current' : ''}`}
                    style={{ color: crm.get(selectedConversation.id).pinned ? '#f59e0b' : undefined }}
                  />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setShowChatSearch(!showChatSearch)} title="Buscar mensagens">
                  <Search className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowContactInfo(!showContactInfo)}
                  title="Ficha do cliente"
                >
                  <Info className="w-4 h-4" />
                </Button>
                <div className="relative" ref={chatMenuRef}>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowChatMenu((v) => !v)}
                    title="Mais opções"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                  {showChatMenu && (
                    <div
                      className="absolute right-0 top-full mt-1 z-30 min-w-[220px] rounded-xl shadow-lg py-1.5"
                      style={{
                        background: 'var(--surface-0)',
                        border: '1px solid var(--border-subtle)',
                        boxShadow: '0 14px 40px rgba(0,0,0,0.18)'
                      }}
                    >
                      <ChatMenuItem
                        icon={<CheckCheck className="w-3.5 h-3.5" />}
                        label="Marcar como lida"
                        onClick={() => {
                          markAsRead(selectedConversation.id);
                          setShowChatMenu(false);
                          toast.success('Conversa marcada como lida');
                        }}
                      />
                      <ChatMenuItem
                        icon={<Pin className="w-3.5 h-3.5" />}
                        label={crm.get(selectedConversation.id).pinned ? 'Desafixar conversa' : 'Fixar no topo'}
                        onClick={() => {
                          crm.togglePin(selectedConversation.id);
                          setShowChatMenu(false);
                          toast.success(crm.get(selectedConversation.id).pinned ? 'Desafixado' : 'Fixado no topo');
                        }}
                      />
                      <ChatMenuItem
                        icon={<Info className="w-3.5 h-3.5" />}
                        label="Ver ficha do cliente"
                        onClick={() => {
                          setShowContactInfo(true);
                          setShowChatMenu(false);
                        }}
                      />
                      <ChatMenuItem
                        icon={<Search className="w-3.5 h-3.5" />}
                        label="Buscar nesta conversa"
                        onClick={() => {
                          setShowChatSearch(true);
                          setShowChatMenu(false);
                        }}
                      />
                      <div className="h-px my-1" style={{ background: 'var(--border-subtle)' }} />
                      <ChatMenuItem
                        icon={<Copy className="w-3.5 h-3.5" />}
                        label="Copiar número"
                        onClick={() => {
                          navigator.clipboard?.writeText(selectedConversation.contactPhone || '').then(() => {
                            toast.success('Número copiado');
                          }).catch(() => toast.error('Não foi possível copiar'));
                          setShowChatMenu(false);
                        }}
                      />
                      <ChatMenuItem
                        icon={<RotateCcw className="w-3.5 h-3.5" />}
                        label="Recarregar histórico"
                        onClick={() => {
                          const limit = (historyRequestedRef.current.get(selectedConversation.id) || 100) + 100;
                          historyRequestedRef.current.set(selectedConversation.id, limit);
                          setHistoryLoading(selectedConversation.id);
                          loadChatHistory(selectedConversation.id, limit);
                          setShowChatMenu(false);
                          toast.success('Buscando mensagens…');
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {pipelineAgg && <MessagePipelineStrip agg={pipelineAgg} />}

            {showChatSearch && (
              <div
                className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
                style={{ background: 'var(--surface-0)', borderBottom: '1px solid var(--border-subtle)' }}
              >
                <Input
                  autoFocus
                  leftIcon={<Search className="w-4 h-4" />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => {
                        setShowChatSearch(false);
                        setSearchInChat('');
                      }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  }
                  value={searchInChat}
                  onChange={(e) => setSearchInChat(e.target.value)}
                  placeholder="Pesquisar mensagens..."
                />
              </div>
            )}

            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-4 lg:px-10 py-4 relative"
              style={{
                backgroundImage:
                  "radial-gradient(circle, rgba(16,185,129,0.04) 1px, transparent 1px)",
                backgroundSize: '24px 24px'
              }}
            >
              {/* Banner especial: conversa nova sem histórico (rascunho local). */}
              {isSelectedDraft && (
                <div className="flex justify-center mb-3">
                  <div
                    className="text-[12px] px-3.5 py-2 rounded-xl inline-flex items-center gap-2 shadow-sm max-w-[92%]"
                    style={{
                      background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(16,185,129,0.04))',
                      color: 'var(--text-1)',
                      border: '1px solid rgba(16,185,129,0.35)'
                    }}
                  >
                    <MessageCircle className="w-3.5 h-3.5" style={{ color: '#10b981' }} />
                    <span>
                      Nova conversa com <strong>{selectedConversation?.contactName}</strong>. Envie a primeira mensagem abaixo — ela será criada no WhatsApp ao enviar.
                    </span>
                  </div>
                </div>
              )}

              {/* Banner de historico no topo — mostra progresso ou botao manual "Carregar mensagens antigas" */}
              {!isSelectedDraft && (
              <div className="flex justify-center mb-3">
                {historyLoading === selectedChatId ? (
                  <span
                    className="text-[11.5px] px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-sm"
                    style={{
                      background: 'var(--surface-0)',
                      color: 'var(--text-2)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Sincronizando historico do celular...
                  </span>
                ) : historyExhausted.has(selectedChatId) ? (
                  <span
                    className="text-[11px] px-2.5 py-1 rounded-full"
                    style={{
                      background: 'var(--surface-0)',
                      color: 'var(--text-3)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <Check className="w-3 h-3 inline -mt-0.5 mr-1" style={{ color: '#10b981' }} />
                    Inicio da conversa — {selectedConversation.messages.length} mensagens
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => loadMoreHistoryFor(selectedChatId, true)}
                    className="text-[11.5px] px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-sm transition-all hover:scale-[1.02]"
                    style={{
                      background: 'var(--surface-0)',
                      color: 'var(--text-2)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer'
                    }}
                    title="Buscar mensagens mais antigas do celular"
                  >
                    <ArrowUp className="w-3 h-3" />
                    Carregar mensagens mais antigas
                    <History className="w-3 h-3 opacity-60" />
                  </button>
                )}
              </div>
              )}

              {!isSelectedDraft && (
              <div className="flex justify-center mb-4">
                <span
                  className="text-[11px] px-2.5 py-1 rounded-full shadow-sm"
                  style={{ background: 'var(--surface-0)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }}
                >
                  {selectedConversation.messages.length} mensagens
                </span>
              </div>
              )}

              <div className="space-y-1">
                {selectedConversation.messages.map((msg, idx) => {
                  const isMe = msg.sender === 'me';
                  const prevMsg = selectedConversation.messages[idx - 1];
                  const showTail = !prevMsg || prevMsg.sender !== msg.sender;
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${showTail ? 'mt-2' : ''}`}>
                      <div
                        className={`relative rounded-[14px] text-[13.5px] leading-[18px] shadow-sm max-w-[75%] lg:max-w-[60%] px-3 py-2 ${
                          showTail && isMe ? 'rounded-br-[4px]' : ''
                        } ${showTail && !isMe ? 'rounded-bl-[4px]' : ''}`}
                        style={{
                          background: isMe ? 'var(--brand-600)' : 'var(--surface-0)',
                          color: isMe ? '#fff' : 'var(--text-1)',
                          border: isMe ? 'none' : '1px solid var(--border-subtle)'
                        }}
                      >
                        <div>{renderMessageContent(msg)}</div>
                        <div className="flex items-center justify-end gap-1.5 mt-0.5 ml-2 float-right">
                          <span
                            className="text-[10.5px] leading-none"
                            style={{ color: isMe ? 'rgba(255,255,255,0.75)' : 'var(--text-3)' }}
                          >
                            {msg.timestamp}
                          </span>
                          {isMe && <OutboundPipelineBar status={msg.status} />}
                        </div>
                        <div className="clear-both" />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div ref={messagesEndRef} />

              {showScrollDown && (
                <button
                  onClick={scrollToBottom}
                  className="sticky bottom-4 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full shadow-xl flex items-center justify-center z-10"
                  style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >
                  <ArrowDown className="w-4 h-4" />
                  {selectedConversation.unreadCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] rounded-full flex items-center justify-center text-[9.5px] font-bold px-1"
                      style={{ background: 'var(--brand-600)', color: '#fff' }}
                    >
                      {selectedConversation.unreadCount}
                    </span>
                  )}
                </button>
              )}
            </div>

            {showQuickReplies && (
              <div
                className="flex gap-2 px-4 py-2 overflow-x-auto flex-shrink-0"
                style={{ background: 'var(--surface-0)', borderTop: '1px solid var(--border-subtle)' }}
              >
                {QUICK_REPLIES.map((qr, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInputText(qr.text);
                      setShowQuickReplies(false);
                      inputRef.current?.focus();
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg whitespace-nowrap text-[12.5px] transition-colors flex-shrink-0"
                    style={{
                      background: 'var(--surface-2)',
                      color: 'var(--text-1)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <span>{qr.emoji}</span>
                    <span>{qr.text}</span>
                  </button>
                ))}
              </div>
            )}

            {showEmojiPicker && (
              <div
                className="flex-shrink-0 overflow-hidden"
                style={{ background: 'var(--surface-0)', borderTop: '1px solid var(--border-subtle)', height: 240 }}
              >
                <div className="h-full overflow-y-auto px-3 py-2">
                  {EMOJI_GROUPS.map((group, gi) => (
                    <div key={gi} className="mb-3">
                      <p
                        className="text-[10.5px] font-semibold mb-1.5 sticky top-0 py-1 z-10 uppercase tracking-wider"
                        style={{ color: 'var(--text-3)', background: 'var(--surface-0)' }}
                      >
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {group.emojis.map((emoji, ei) => (
                          <button
                            key={ei}
                            onClick={() => insertEmoji(emoji)}
                            className="w-8 h-8 flex items-center justify-center text-[20px] rounded-md transition-colors hover:bg-[var(--surface-2)]"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
              style={{ background: 'var(--surface-0)', borderTop: '1px solid var(--border-subtle)' }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowEmojiPicker(!showEmojiPicker);
                  setShowQuickReplies(false);
                }}
                className="p-2 rounded-lg transition-colors"
                style={{
                  color: showEmojiPicker ? 'var(--brand-600)' : 'var(--text-2)',
                  background: showEmojiPicker ? 'var(--surface-2)' : 'transparent'
                }}
              >
                <Smile className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowQuickReplies(!showQuickReplies);
                  setShowEmojiPicker(false);
                }}
                className="p-2 rounded-lg transition-colors"
                style={{
                  color: showQuickReplies ? 'var(--brand-600)' : 'var(--text-2)',
                  background: showQuickReplies ? 'var(--surface-2)' : 'transparent'
                }}
                title="Respostas rapidas"
              >
                <MessageCircle className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  toast((t) => (
                    <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-1)' }}>
                      <div className="font-semibold mb-1 flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5" style={{ color: 'var(--brand-600)' }} />
                        Envio de arquivos em breve
                      </div>
                      <p style={{ color: 'var(--text-3)' }}>
                        Por enquanto, cole uma URL de imagem ou documento na mensagem — o WhatsApp gera a prévia.
                      </p>
                      <button
                        onClick={() => toast.dismiss(t.id)}
                        className="mt-1.5 text-[11.5px] font-semibold"
                        style={{ color: 'var(--brand-600)' }}
                      >
                        Entendi
                      </button>
                    </div>
                  ), { duration: 5000 });
                }}
                className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: 'var(--text-2)' }}
                title="Anexar (em breve)"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              <form onSubmit={handleSendMessage} className="flex items-center gap-2 flex-1">
                {isSelectedDraft && (
                  <select
                    value={selectedDraftChannelId}
                    onChange={(e) => {
                      const nextConnectionId = e.target.value;
                      if (!selectedChatId) return;
                      setDraftChannelById((prev) => ({
                        ...prev,
                        [selectedChatId]: nextConnectionId
                      }));
                    }}
                    className="py-2 px-2.5 rounded-lg text-[12.5px] outline-none border max-w-[170px]"
                    style={{
                      background: 'var(--surface-1)',
                      color: 'var(--text-1)',
                      borderColor: 'var(--border-subtle)'
                    }}
                    title="Escolha o canal para enviar"
                  >
                    <option value="">Escolher canal</option>
                    {connections.map((conn) => (
                      <option key={conn.id} value={conn.id}>
                        {conn.name} {conn.status === 'CONNECTED' ? '• online' : '• offline'}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  ref={inputRef}
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowEmojiPicker(false);
                      setShowQuickReplies(false);
                    }
                  }}
                  placeholder="Digite uma mensagem..."
                  className="w-full py-2 px-3 rounded-lg text-[14px] outline-none border"
                  style={{
                    background: 'var(--surface-1)',
                    color: 'var(--text-1)',
                    borderColor: 'var(--border-subtle)'
                  }}
                />
                <button
                  type="submit"
                  disabled={!canSendCurrent}
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-40"
                  style={{
                    background: canSendCurrent ? 'var(--brand-600)' : 'var(--surface-2)',
                    color: canSendCurrent ? '#fff' : 'var(--text-3)'
                  }}
                  title={isSelectedDraft && !selectedDraftChannelId ? 'Escolha um canal para enviar' : 'Enviar'}
                >
                  {inputText.trim() ? <Send className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              </form>
            </div>
          </>
        ) : (
          <ChatEmptyShowcase
            totalConversations={conversations.length}
            totalUnread={totalUnread}
            totalChannels={connections.length}
            crmStats={crm.stats}
          />
        )}
      </div>

      {showContactInfo && selectedConversation && (
        <ClientCrmPanel
          conversation={selectedConversation}
          connectionName={selectedConnection?.name}
          avatar={getAvatar(selectedConversation.contactName, selectedConversation.profilePicUrl)}
          crmData={crm.get(selectedConversation.id)}
          pipelineAgg={pipelineAgg}
          onClose={() => setShowContactInfo(false)}
          onUpdate={(patch) => crm.update(selectedConversation.id, patch)}
          onClear={() => crm.clear(selectedConversation.id)}
        />
      )}

      {/* ============================ MODAL DE AUDITORIA DE ORIGEM ============================ */}
      <Modal
        isOpen={showAudit}
        onClose={() => setShowAudit(false)}
        title="Auditar origem das conversas"
        subtitle="Verifique quais conversas vieram do celular e quais foram criadas pelo sistema."
        icon={<ShieldCheck className="w-5 h-5" />}
        size="lg"
      >
        <div className="space-y-4">
          {/* Resumo geral */}
          <div className="grid grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => { setAuditCategory('phone'); setAuditSelection(new Set()); }}
              className="text-left rounded-xl p-3 transition-all"
              style={{
                background: auditCategory === 'phone' ? 'rgba(16,185,129,0.12)' : 'var(--surface-1)',
                border: `1px solid ${auditCategory === 'phone' ? 'rgba(16,185,129,0.4)' : 'var(--border-subtle)'}`
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Smartphone className="w-3.5 h-3.5" style={{ color: '#10b981' }} />
                <span className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-3)' }}>
                  Do celular
                </span>
              </div>
              <div className="text-[22px] font-bold" style={{ color: 'var(--text-1)' }}>
                {phoneConvs.length}
              </div>
              <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                conversas reais (puxadas do chat)
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setAuditCategory('system'); setAuditSelection(new Set()); }}
              className="text-left rounded-xl p-3 transition-all"
              style={{
                background: auditCategory === 'system' ? 'rgba(245,158,11,0.12)' : 'var(--surface-1)',
                border: `1px solid ${auditCategory === 'system' ? 'rgba(245,158,11,0.4)' : 'var(--border-subtle)'}`
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} />
                <span className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-3)' }}>
                  Criadas pelo sistema
                </span>
              </div>
              <div className="text-[22px] font-bold" style={{ color: 'var(--text-1)' }}>
                {systemConvs.length}
              </div>
              <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                apenas disparos (sem historico)
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setAuditCategory('empty'); setAuditSelection(new Set()); }}
              className="text-left rounded-xl p-3 transition-all"
              style={{
                background: auditCategory === 'empty' ? 'rgba(148,163,184,0.14)' : 'var(--surface-1)',
                border: `1px solid ${auditCategory === 'empty' ? 'rgba(148,163,184,0.4)' : 'var(--border-subtle)'}`
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <MessageCircle className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
                <span className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-3)' }}>
                  Vazias
                </span>
              </div>
              <div className="text-[22px] font-bold" style={{ color: 'var(--text-1)' }}>
                {emptyConvs.length}
              </div>
              <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                contatos sem mensagens
              </div>
            </button>
          </div>

          {/* Dica contextual */}
          <div
            className="rounded-lg p-3 flex items-start gap-2 text-[12px]"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
          >
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#3b82f6' }} />
            <div>
              {auditCategory === 'phone' && (
                <span>
                  Essas conversas foram <b>puxadas diretamente do celular</b> — possuem mensagens reais recebidas do contato.
                  Nao recomendamos apagar.
                </span>
              )}
              {auditCategory === 'system' && (
                <span>
                  Essas conversas foram <b>criadas pelo disparo</b>: voce enviou mensagens via campanha mas <b>nunca recebeu
                  resposta</b> e nao havia historico anterior no celular. Apagar aqui <b>nao afeta o WhatsApp</b>,
                  apenas limpa o painel.
                </span>
              )}
              {auditCategory === 'empty' && (
                <span>
                  Conversas <b>vazias</b> vieram da sincronizacao de contatos (quando o getChats falha o sistema puxa a
                  lista de contatos). Remover aqui nao apaga nada no celular.
                </span>
              )}
            </div>
          </div>

          {/* Toolbar */}
          {auditCategory !== 'phone' && auditList.length > 0 && (
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: 'var(--text-2)' }}>
                <input
                  type="checkbox"
                  checked={auditSelection.size === auditList.length && auditList.length > 0}
                  onChange={toggleAuditAll}
                />
                Selecionar todas ({auditList.length})
              </label>
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                disabled={auditSelection.size === 0}
                onClick={handleBulkDelete}
              >
                Remover selecionadas ({auditSelection.size})
              </Button>
            </div>
          )}

          {/* Lista */}
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border-subtle)', maxHeight: 360, overflowY: 'auto' }}
          >
            {auditList.length === 0 ? (
              <div className="p-8 text-center">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  Nada a revisar nessa categoria
                </p>
                <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                  {auditCategory === 'phone'
                    ? 'Nenhuma conversa real sincronizada ainda.'
                    : 'Seu painel esta limpo nessa categoria.'}
                </p>
              </div>
            ) : (
              auditList.map((c) => {
                const selected = auditSelection.has(c.id);
                const conn = connections.find((x) => x.id === c.connectionId);
                const lastMsg = c.messages[c.messages.length - 1];
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors"
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: selected ? 'rgba(239,68,68,0.06)' : 'transparent'
                    }}
                  >
                    {auditCategory !== 'phone' && (
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleAuditRow(c.id)}
                        className="flex-shrink-0"
                      />
                    )}
                    <img
                      src={getAvatar(c.contactName, c.profilePicUrl)}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                        {c.contactName}
                      </div>
                      <div className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                        {c.contactPhone}
                        {conn && <span> • {conn.name}</span>}
                        {lastMsg && <span> • ultima: "{(lastMsg.text || '').slice(0, 40)}"</span>}
                        {!lastMsg && c.messages.length === 0 && <span> • sem mensagens</span>}
                      </div>
                    </div>
                    {auditCategory !== 'phone' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteSingle(c.id)}
                        className="p-1.5 rounded-md flex-shrink-0"
                        style={{ background: 'var(--surface-2)', color: 'var(--danger)' }}
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};

// Item de menu do dropdown do header do chat
const ChatMenuItem: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }> = ({ icon, label, onClick, danger }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] text-left transition-colors hover:bg-[var(--surface-1)]"
    style={{ color: danger ? 'var(--danger)' : 'var(--text-1)' }}
  >
    <span style={{ color: danger ? 'var(--danger)' : 'var(--text-3)' }}>{icon}</span>
    <span className="font-medium">{label}</span>
  </button>
);
