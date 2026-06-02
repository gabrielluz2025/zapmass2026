import React, { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  ChevronLeft,
  ChevronRight,
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
  Pencil,
  Image as ImageIcon,
  Film,
  FileText,
  UserRound,
  ArrowRightLeft
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getAuth } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { dedupeConversationsById } from '../utils/conversationInboxTrim';
import { formatChatListTime } from '../utils/formatChatListTime';
import { useZapMassCore, useZapMassConversations } from '../context/ZapMassContext';
import { ClientPipelineBoard } from './chat/ClientPipelineBoard';
import { ClientCrmPanel } from './chat/ClientCrmPanel';
import { ChatEmptyShowcase } from './chat/ChatEmptyShowcase';
import { apiUrl } from '../utils/apiBase';
import { useClientCrm, STATUS_META, hashTagColor } from './chat/useClientCrm';
import { WaBubble } from './chat/wa/WaBubble';
import { WaContactDrawer } from './chat/wa/WaContactDrawer';
import { Conversation, ChatMessage } from '../types';
import { prepareCampaignAttachmentForSend } from '../utils/campaignMediaCompress';
import { OPEN_CHAT_BY_CONVERSATION_ID_KEY } from '../utils/openChatByConversationIdNav';
import {
  CHAT_QUICK_REPLIES_MAX_ITEMS,
  CHAT_QUICK_REPLY_TEXT_MAX,
  cloneDefaultChatQuickReplies,
  loadChatQuickReplies,
  saveChatQuickReplies,
  type ChatQuickReply
} from '../utils/chatQuickReplies';
import { Input, Modal, Select, Button, Textarea } from './ui';
import { normPhoneKey } from '../utils/brPhoneNormalize';

// =====================================================================
// Origem de uma conversa — usada para separar o que veio do celular
// do que foi criado pelo sistema (ex: campanha para numero sem chat previo).
// =====================================================================
type ConversationOrigin = 'phone' | 'system' | 'empty';

const normalizeDigits = (raw: string): string => (raw || '').replace(/\D/g, '');

/**
 * Índices para cruzar telefone da conversa ↔ base de contactos
 * (BR: com/sem 55; últimos 10/11; celular com/sem 9 após DDD).
 */
function buildPhoneDigitLookupKeys(digits: string): string[] {
  const set = new Set<string>();
  const pushBrMobileVariants = (x: string) => {
    if (x.length < 8) return;
    set.add(x);
    if (x.startsWith('55') && x.length >= 12) {
      const nat = x.slice(2);
      if (nat.length === 10) {
        const ddd = nat.slice(0, 2);
        const sub = nat.slice(2);
        if (sub.length === 8) set.add(`55${ddd}9${sub}`);
      } else if (nat.length === 11) {
        const ddd = nat.slice(0, 2);
        const sub = nat.slice(2);
        if (sub.startsWith('9') && sub.length === 9) set.add(`55${ddd}${sub.slice(1)}`);
      }
    }
    if (!x.startsWith('55')) {
      if (x.length === 10) {
        const ddd = x.slice(0, 2);
        const sub = x.slice(2);
        if (sub.length === 8) {
          set.add(`${ddd}9${sub}`);
          set.add(`55${ddd}9${sub}`);
          set.add(`55${ddd}${sub}`);
        }
      } else if (x.length === 11) {
        const ddd = x.slice(0, 2);
        const sub = x.slice(2);
        if (sub.startsWith('9') && sub.length === 9) {
          set.add(`${ddd}${sub.slice(1)}`);
          set.add(`55${ddd}${sub.slice(1)}`);
          set.add(`55${ddd}${sub}`);
        }
      }
    }
  };
  const addCore = (raw: string) => {
    const d = normalizeDigits(raw);
    if (!d || d.length < 8) return;
    pushBrMobileVariants(d);
    if (d.length >= 10) pushBrMobileVariants(d.slice(-10));
    if (d.length >= 11) pushBrMobileVariants(d.slice(-11));
    if (d.startsWith('55') && d.length >= 12) {
      const noCc = d.slice(2);
      pushBrMobileVariants(noCc);
      if (noCc.length >= 10) pushBrMobileVariants(noCc.slice(-10));
      if (noCc.length >= 11) pushBrMobileVariants(noCc.slice(-11));
    }
    // Para números internacionais longos (> 11 dígitos): também tenta sufixos de 9–13 dígitos.
    // Isso cobre casos em que o WA entrega o número com código de país diferente do salvo no sistema.
    if (d.length > 11) {
      for (let len = 9; len <= 13 && len < d.length; len++) {
        pushBrMobileVariants(d.slice(-len));
      }
    }
  };
  const d = normalizeDigits(digits);
  if (!d) return [];
  addCore(d);
  return Array.from(set);
}

/** Mesma logica de match que ao abrir chat por contato (BR, com/sem 55, 9º digito). */
const phonesMatchDigits = (a: string, b: string): boolean => {
  const ca = a.replace(/\D/g, '');
  const cb = b.replace(/\D/g, '');
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.endsWith(cb) || cb.endsWith(ca)) return true;
  if (ca.length >= 10 && cb.length >= 10 && ca.slice(-10) === cb.slice(-10)) return true;
  const ka = normPhoneKey(a);
  const kb = normPhoneKey(b);
  if (ka && kb && ka === kb) return true;
  const keysA = buildPhoneDigitLookupKeys(ca);
  const keysB = new Set(buildPhoneDigitLookupKeys(cb));
  for (const k of keysA) {
    if (keysB.has(k)) return true;
  }
  return false;
};

/** Extrai apenas dígitos do utilizador WhatsApp em `...@c.us` (e variants `lid:` / `chip:...@c.us`). */
function extractWaUserDigitsFromConvId(convId: string): string {
  const tail = convId.includes(':') ? convId.slice(convId.lastIndexOf(':') + 1) : convId;
  const m = /^(\d+)@(?:c\.us|s\.whatsapp\.net|lid)$/i.exec(tail.trim());
  return m ? normalizeDigits(m[1]) : '';
}

/** Retorna true se o JID da conversa é @lid (número interno do WhatsApp, não um telefone real). */
function isLidConvId(convId: string): boolean {
  const tail = convId.includes(':') ? convId.slice(convId.lastIndexOf(':') + 1) : convId;
  return tail.trim().toLowerCase().endsWith('@lid');
}

/**
 * Verifica se os dígitos parecem um número de telefone válido (BR ou internacional).
 * Aceita de 8 a 15 dígitos — cobre Brasil (DDI+DDD+número), números internacionais
 * e evita LIDs excessivamente longos do WhatsApp (geralmente > 15 dígitos).
 */
function plausiblyBrazilPhoneDigits(d: string): boolean {
  const x = normalizeDigits(d);
  if (x.length < 8 || x.length > 15) return false;
  // Para dígitos com prefixo 55 (BR), exige ao menos 12 dígitos (55+DDD+8).
  if (x.startsWith('55') && x.length < 12) return false;
  return true;
}

/**
 * O WhatsApp às vezes grava em `contactPhone` o id LID (+676…) mas o JID ainda é `…@c.us` com o 55….
 * Para cruzar com a base, priorizar sempre um PN BR reconhecível.
 */
function bestPhoneDigitsForAgenda(conv: Conversation): string {
  const phoneD = normalizeDigits(conv.contactPhone || '');
  const fromId = extractWaUserDigitsFromConvId(conv.id);
  if (plausiblyBrazilPhoneDigits(phoneD)) return phoneD;
  if (plausiblyBrazilPhoneDigits(fromId)) return fromId;
  return phoneD || fromId;
}

/** Dígitos canónicos para bater na agenda: campo da conversa ou ID do chat. */
function digitsForContactMatch(conv: Conversation): string {
  return bestPhoneDigitsForAgenda(conv);
}

/** String passada ao cruzamento com contactos — prioriza PN BR (ver `bestPhoneDigitsForAgenda`). */
function phoneRawForContactLookup(conv: Conversation): string {
  const d = bestPhoneDigitsForAgenda(conv);
  return d.length >= 8 ? `+${d}` : '';
}

/** Título já veio como telefone/normalizado pelo WA — não tratar como «nome» legível para exibição. */
function looksLikeDigitsOnlyContactLabel(raw: string): boolean {
  const t = raw.trim().replace(/\u00a0/g, ' ');
  if (!t) return true;
  return /^[+()\d\s.\-]+$/.test(t) && /\d{7,}/.test(t.replace(/\D/g, ''));
}

/**
 * Formata dígitos de telefone para exibição amigável.
 * Cobre Brasil (55+DDD+número), internacionais e números curtos.
 */
function formatPhoneDisplay(digits: string): string {
  if (!digits) return '';
  const d = normalizeDigits(digits);
  if (!d) return `+${digits}`;
  // Brasil: 55 + DDD(2) + 9(1) + número(8) = 13  / 55 + DDD(2) + número(8) = 12
  if (d.startsWith('55') && (d.length === 13 || d.length === 12)) {
    const nat = d.slice(2);
    if (nat.length === 11) return `+55 (${nat.slice(0, 2)}) ${nat.slice(2, 7)}-${nat.slice(7)}`;
    if (nat.length === 10) return `+55 (${nat.slice(0, 2)}) ${nat.slice(2, 6)}-${nat.slice(6)}`;
  }
  // Formato genérico com +
  return `+${d}`;
}

/** Horário da lista — prioriza timestamp real (Ontem, dd/mm, hh:mm) como no WhatsApp. */
function formatConversationListTime(conv: Conversation): string {
  const ts = conv.lastMessageTimestamp;
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
    return formatChatListTime(ts);
  }
  const raw = String(conv.lastMessageTime || '').trim();
  if (raw && raw !== 'Invalid Date') return raw;
  return '';
}

const classifyConversation = (conv: Conversation): ConversationOrigin => {
  const msgs = conv.messages || [];
  const hasPreview = Boolean((conv.lastMessage || '').trim());
  const hasTs =
    typeof conv.lastMessageTimestamp === 'number' &&
    Number.isFinite(conv.lastMessageTimestamp) &&
    conv.lastMessageTimestamp > 0;
  if (msgs.length === 0) {
    /** findChats traz preview sem carregar messages[] — ainda é conversa real do celular. */
    if (hasPreview || hasTs) return 'phone';
    return 'empty';
  }
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

// Limite de leitura/envio pelo app (socket + RAM). Documentos até ~2 GB no WA.
// Vídeo: o WhatsApp costuma falhar acima de ~100 MB — ver WHATSAPP_VIDEO_MAX_BYTES.
// Imagens/áudio: limite menor no WA (~16 MB). Override: VITE_CHAT_UPLOAD_LIMIT_MB;
// backend: SOCKET_MAX_HTTP_BUFFER_MB (+33% base64).
const CHAT_UPLOAD_LIMIT_MB = (() => {
  const raw = Number(import.meta.env.VITE_CHAT_UPLOAD_LIMIT_MB ?? 200);
  if (!Number.isFinite(raw)) return 200;
  return Math.max(1, Math.min(2048, Math.round(raw)));
})();
const CHAT_UPLOAD_LIMIT_BYTES = CHAT_UPLOAD_LIMIT_MB * 1024 * 1024;

type MediaUploadStage = 'idle' | 'reading' | 'uploading' | 'sending';

/** Barra de envio de mídia: percentagem na leitura local quando o browser reporta; senão animação indeterminada. */
const MediaUploadProgressBar: React.FC<{
  uploadStage: MediaUploadStage;
  uploadProgress: number | null;
  uploadElapsedSec: number;
  /** Na barra do composer (estreita); no painel de pré-visualização use full width. */
  dense?: boolean;
}> = ({ uploadStage, uploadProgress, uploadElapsedSec, dense }) => {
  if (uploadStage !== 'reading' && uploadStage !== 'uploading' && uploadStage !== 'sending') return null;
  const showDeterminate =
    uploadStage === 'reading' && uploadProgress !== null && uploadProgress > 0;
  const barH = dense ? 'h-1.5' : 'h-2';
  const label =
    uploadStage === 'reading'
      ? uploadProgress !== null && uploadProgress > 0
        ? `Lendo ficheiro ${uploadProgress}%`
        : 'A ler ficheiro… (vídeos grandes podem demorar)'
      : uploadStage === 'uploading'
        ? `A enviar ao servidor… ${uploadElapsedSec}s`
        : `A enviar pelo WhatsApp… ${uploadElapsedSec}s`;
  return (
    <div className={dense ? 'min-w-[180px] max-w-[260px]' : 'w-full'}>
      <div
        className={`${barH} rounded-full overflow-hidden relative`}
        style={{ background: 'var(--wa-search)' }}
      >
        {showDeterminate ? (
          <div
            className="h-full transition-all duration-200"
            style={{ width: `${uploadProgress}%`, background: 'var(--wa-green)' }}
          />
        ) : (
          <div
            className="h-full absolute inset-y-0 wa-upload-indeterminate"
            style={{ background: 'var(--wa-green)' }}
          />
        )}
      </div>
      <p
        className="text-[10.5px] font-semibold mt-1 tabular-nums truncate"
        style={{ color: 'var(--wa-text-3)' }}
        title={label}
      >
        {label}
      </p>
    </div>
  );
};

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

type InboxTeammateRow = { uid: string; displayName: string | null; email: string | null; role: 'owner' | 'staff' };

async function inboxWorkspaceApi(path: string, init?: RequestInit): Promise<void> {
  const u = getAuth().currentUser;
  if (!u) throw new Error('Sessão expirada. Entre novamente.');
  const token = await u.getIdToken();
  const r = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {})
    }
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
}

async function inboxWorkspaceGetJson<T>(path: string): Promise<T> {
  const u = getAuth().currentUser;
  if (!u) throw new Error('Sessão expirada. Entre novamente.');
  const token = await u.getIdToken();
  const r = await fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error((j as { error?: string }).error || `Erro HTTP ${r.status}`);
  return j as T;
}

type InboxFinishResponse = {
  ok?: boolean;
  clientSurveySent?: boolean;
  clientSurveyError?: string;
  error?: string;
};

async function inboxWorkspacePostFinish(body: Record<string, unknown>): Promise<InboxFinishResponse> {
  const u = getAuth().currentUser;
  if (!u) throw new Error('Sessão expirada. Entre novamente.');
  const token = await u.getIdToken();
  const r = await fetch(apiUrl('/api/workspace/inbox-finish'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const j = (await r.json().catch(() => ({}))) as InboxFinishResponse;
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
  return j;
}

export const ChatTab: React.FC<{
  autoSelectedConversationId?: string | null;
  onClearAutoSelected?: () => void;
}> = ({ autoSelectedConversationId, onClearAutoSelected }) => {
  const conversations = useZapMassConversations();
  const {
    contacts,
    connections,
    sendMessage,
    sendMedia,
    markAsRead,
    fetchConversationPicture,
    patchConversationInboxClaim,
    deleteLocalConversations,
    loadChatHistory,
    hydrateFirestoreChatArchive,
    loadMessageMedia,
    socket
  } = useZapMassCore();
  const { user } = useAuth();
  const {
    isTeamMember,
    authUid: workspaceAuthUid,
    effectiveWorkspaceUid,
    loading: workspaceLoading
  } = useWorkspace();
  const isWorkspaceOwner = Boolean(
    workspaceAuthUid && effectiveWorkspaceUid && workspaceAuthUid === effectiveWorkspaceUid
  );
  const crm = useClientCrm(user?.uid);
  const connectionById = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections]
  );
  /** Canais online — sync e filtro usam só estes. */
  const connectedChannels = useMemo(
    () => connections.filter((c) => c.status === 'CONNECTED'),
    [connections]
  );
  const connectedChannelIdsKey = useMemo(
    () => connectedChannels.map((c) => c.id).sort().join('|'),
    [connectedChannels]
  );

  /** Ao abrir o bate-papo ou conectar novo chip: puxa conversas de TODOS os canais. */
  useEffect(() => {
    if (!socket?.connected) return;
    socket.emit('request-conversations-sync');
  }, [socket, connectedChannelIdsKey]);
  const pipelineBoardConnectionName = useCallback(
    (id: string) => connectionById.get(id)?.name,
    [connectionById]
  );
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
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | 'ALL'>('ALL');
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplies, setQuickReplies] = useState<ChatQuickReply[]>(() => loadChatQuickReplies());
  const [quickRepliesEditorOpen, setQuickRepliesEditorOpen] = useState(false);
  const [quickRepliesDraft, setQuickRepliesDraft] = useState<ChatQuickReply[]>([]);
  const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'groups' | 'system' | 'empty' | 'pinned'>('all');
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [searchInChat, setSearchInChat] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [auditSelection, setAuditSelection] = useState<Set<string>>(new Set());
  const [auditCategory, setAuditCategory] = useState<ConversationOrigin>('system');
  const [inboxActionBusy, setInboxActionBusy] = useState(false);
  const [inboxSurveyOpen, setInboxSurveyOpen] = useState(false);
  const [inboxTransferOpen, setInboxTransferOpen] = useState(false);
  const [inboxSurveyRating, setInboxSurveyRating] = useState<number | null>(null);
  const [inboxSurveyComment, setInboxSurveyComment] = useState('');
  const [inboxTeammates, setInboxTeammates] = useState<InboxTeammateRow[]>([]);
  const [inboxTeammatesLoad, setInboxTeammatesLoad] = useState(false);
  const [transferTargetUid, setTransferTargetUid] = useState('');
  const [sendClientSurveyToClient, setSendClientSurveyToClient] = useState(true);
  // Historico: rastreia por chat qual o ultimo limite solicitado + se esta carregando.
  // Isso permite carregamento progressivo tipo "WhatsApp Web" ao rolar para o topo.
  const historyRequestedRef = useRef<Map<string, number>>(new Map());
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [historyExhausted, setHistoryExhausted] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  /** Scroll apenas da lista de conversas (vista Lista) — usado pela virtualização. */
  const conversationListScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  /**
   * Etapas reais do envio de mídia:
   * - 'reading'  : FileReader convertendo o arquivo em base64 (medível, % real).
   * - 'uploading': socket emit em curso, servidor ainda não respondeu (sem %).
   * - 'sending'  : servidor passou para a whatsapp-web.js → upload p/ Meta.
   * Estados intermédios precisam de barra indeterminada porque não temos o
   * progresso do upload via socket nem o do upload da Meta.
   */
  const [uploadStage, setUploadStage] = useState<MediaUploadStage>('idle');
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [uploadElapsedSec, setUploadElapsedSec] = useState(0);

  useEffect(() => {
    if (!uploadStartedAt) return;
    setUploadElapsedSec(Math.max(0, Math.floor((Date.now() - uploadStartedAt) / 1000)));
    const id = setInterval(() => {
      setUploadElapsedSec(Math.max(0, Math.floor((Date.now() - uploadStartedAt) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [uploadStartedAt]);
  const [lastFailedFile, setLastFailedFile] = useState<File | null>(null);
  /**
   * Pre-visualizacao de midia antes do envio:
   * o usuario escolhe o arquivo, ve um preview, opcionalmente adiciona uma
   * legenda, e so entao confirma o envio. Igual ao WhatsApp Web.
   */
  const [pendingMediaFile, setPendingMediaFile] = useState<File | null>(null);
  const [pendingMediaPreviewUrl, setPendingMediaPreviewUrl] = useState<string | null>(null);
  const [pendingMediaCaption, setPendingMediaCaption] = useState('');
  const pendingCaptionRef = useRef<HTMLInputElement>(null);

  /** Libera a URL temporaria do preview ao fechar/trocar (evita vazamento). */
  useEffect(() => {
    return () => {
      if (pendingMediaPreviewUrl) URL.revokeObjectURL(pendingMediaPreviewUrl);
    };
  }, [pendingMediaPreviewUrl]);

  useEffect(() => {
    if (!inboxTransferOpen || !workspaceAuthUid) return;
    let cancelled = false;
    void (async () => {
      setInboxTeammatesLoad(true);
      try {
        const j = await inboxWorkspaceGetJson<{ ok?: boolean; items?: InboxTeammateRow[] }>('/api/workspace/teammates');
        if (!cancelled) setInboxTeammates(Array.isArray(j.items) ? j.items : []);
      } catch {
        toast.error('Não foi possível carregar a equipa.');
        if (!cancelled) setInboxTeammates([]);
      } finally {
        if (!cancelled) setInboxTeammatesLoad(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inboxTransferOpen, workspaceAuthUid]);

  // Evita flood ao backend: controla quando cada avatar foi requisitado.
  const avatarFetchAtRef = useRef<Map<string, number>>(new Map());

  const getAvatar = (name: string, pic?: string) =>
    pic || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=059669&color=fff&size=200`;

  /**
   * Index reverso de fotos de perfil por chave de telefone — evita O(C) por conversa
   * em `resolveProfilePic`. Recriado só quando `contacts` muda.
   */
  const profilePicByPhoneKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const ct of contacts) {
      const pic = ct.profilePicUrl;
      if (!pic) continue;
      const rawPhone = ct.phone || '';
      const nk = normPhoneKey(rawPhone);
      if (nk && !map.has(nk)) map.set(nk, pic);
      const digits = normalizeDigits(rawPhone);
      if (!digits) continue;
      for (const key of buildPhoneDigitLookupKeys(digits)) {
        if (!map.has(key)) map.set(key, pic);
      }
    }
    return map;
  }, [contacts]);

  /** Foto do WhatsApp (quando veio) ou `profilePicUrl` da agenda em Contatos — agora O(1). */
  const resolveProfilePic = useCallback(
    (conv: Conversation): string | undefined => {
      if (conv.profilePicUrl) return conv.profilePicUrl;
      const dConv = digitsForContactMatch(conv);
      if (!dConv || dConv.length < 8) return undefined;
      const nk = normPhoneKey(dConv);
      if (nk) {
        const a = profilePicByPhoneKey.get(nk);
        if (a) return a;
      }
      for (const key of buildPhoneDigitLookupKeys(dConv)) {
        const hit = profilePicByPhoneKey.get(key);
        if (hit) return hit;
      }
      return undefined;
    },
    [profilePicByPhoneKey]
  );

  const openQuickRepliesEditor = useCallback(() => {
    setQuickRepliesDraft(quickReplies.map((r) => ({ ...r })));
    setQuickRepliesEditorOpen(true);
  }, [quickReplies]);

  const saveQuickRepliesFromDraft = useCallback(() => {
    const sanitized = quickRepliesDraft
      .map((r) => ({
        text: r.text.trim().slice(0, CHAT_QUICK_REPLY_TEXT_MAX),
        emoji: (r.emoji.trim().slice(0, 16) || '💬')
      }))
      .filter((r) => r.text.length > 0)
      .slice(0, CHAT_QUICK_REPLIES_MAX_ITEMS);
    if (sanitized.length === 0) {
      toast.error('Adicione pelo menos uma mensagem com texto.');
      return;
    }
    setQuickReplies(sanitized);
    saveChatQuickReplies(sanitized);
    setQuickRepliesEditorOpen(false);
    toast.success('Mensagens rápidas guardadas.');
  }, [quickRepliesDraft]);

  // De/para de contatos do sistema por telefone:
  // prioridade sempre para nome cadastrado no sistema.
  const systemContactNameByDigits = useMemo(() => {
    const map = new Map<string, string>();
    for (const ct of contacts) {
      const name = (ct.name || '').trim();
      const rawPhone = ct.phone || '';
      const digits = normalizeDigits(rawPhone);
      if (!name || !digits) continue;
      const nk = normPhoneKey(rawPhone);
      if (nk && !map.has(nk)) map.set(nk, name);
      for (const key of buildPhoneDigitLookupKeys(digits)) {
        if (!map.has(key)) map.set(key, name);
      }
    }
    return map;
  }, [contacts]);

  /**
   * Lookup do nome cadastrado por telefone usando apenas o map precomputado (`buildPhoneDigitLookupKeys` já cobre BR
   * com/sem 55 e 9º dígito). O fallback antigo sobre `contacts` era O(C) por conversa e travava o `effectiveConversations.map`
   * em bases grandes — agora é lookup direto.
   */
  const getSystemNameForPhone = useCallback(
    (phoneRaw: string): string | undefined => {
      const trimmed = (phoneRaw || '').trim();
      if (!trimmed) return undefined;
      const nkHit = normPhoneKey(trimmed);
      if (nkHit) {
        const a = systemContactNameByDigits.get(nkHit);
        if (a) return a;
      }
      const digits = normalizeDigits(phoneRaw);
      if (!digits) return undefined;
      for (const key of buildPhoneDigitLookupKeys(digits)) {
        const hit = systemContactNameByDigits.get(key);
        if (hit) return hit;
      }
      return undefined;
    },
    [systemContactNameByDigits]
  );

  /**
   * Resolve nome cadastrado tentando múltiplas fontes de telefone da conversa:
   * 1) `phoneRawForContactLookup` — melhor PN BR detectado em `contactPhone` ou no `id` do chat;
   * 2) Quando o WhatsApp guarda o número formatado em `contactName` (sem agenda local) — extrai dígitos dali;
   * 3) `contactPhone` cru, mesmo que tenha falhado no `plausiblyBrazilPhoneDigits` (alguns dispositivos usam DDI estrangeiro / formato sem 9º dígito);
   * 4) Dígitos extraídos do próprio `id` do chat.
   *
   * Isso resolve o caso em que o `contactPhone` do socket vem como LID do WhatsApp (ex.: `+676587…`),
   * mas o número real (que existe na aba Contatos) aparece formatado no `contactName`.
   */
  const resolveSystemNameForConv = useCallback(
    (conv: Conversation): string | undefined => {
      const tryName = (raw: string): string | undefined => {
        const t = (raw || '').trim();
        if (!t) return undefined;
        return getSystemNameForPhone(t);
      };

      const candidates: string[] = [];
      const seen = new Set<string>();
      const push = (raw: string) => {
        const t = (raw || '').trim();
        if (!t || seen.has(t)) return;
        seen.add(t);
        candidates.push(t);
      };

      push(phoneRawForContactLookup(conv));

      const storedName = (conv.contactName || '').trim();
      if (storedName && looksLikeDigitsOnlyContactLabel(storedName)) {
        const d = normalizeDigits(storedName);
        if (d.length >= 10 && d.length <= 13) push(`+${d}`);
      }

      const cp = (conv.contactPhone || '').trim();
      if (cp) {
        const d = normalizeDigits(cp);
        if (d.length >= 10 && d.length <= 13) push(`+${d}`);
      }

      const fromId = extractWaUserDigitsFromConvId(conv.id);
      if (fromId && fromId.length >= 10 && fromId.length <= 13) push(`+${fromId}`);

      for (const cand of candidates) {
        const hit = tryName(cand);
        if (hit) return hit.trim();
      }
      return undefined;
    },
    [getSystemNameForPhone]
  );

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

  const quadroPaneCollapsedKey = useMemo(
    () => `zapmass-quadro-right-pane-collapsed:v1:${user?.uid || 'anon'}`,
    [user?.uid]
  );
  const [quadroRightPaneCollapsed, setQuadroRightPaneCollapsed] = useState(false);

  useEffect(() => {
    try {
      setQuadroRightPaneCollapsed(localStorage.getItem(quadroPaneCollapsedKey) === '1');
    } catch {
      /* ignore */
    }
  }, [quadroPaneCollapsedKey]);

  useEffect(() => {
    try {
      if (quadroRightPaneCollapsed) localStorage.setItem(quadroPaneCollapsedKey, '1');
      else localStorage.removeItem(quadroPaneCollapsedKey);
    } catch {
      /* ignore */
    }
  }, [quadroRightPaneCollapsed, quadroPaneCollapsedKey]);

  const quadroHidesRightPane =
    pipelineView === 'quadro' && !selectedChatId && quadroRightPaneCollapsed;

  // Handshake vindo da aba Contatos: abrir conversa por telefone.
  // Evita prop drilling — Contatos grava sessionStorage + navega, aqui resolvemos.
  // Se não existir conversa real com esse número, criamos um rascunho local
  // para que o usuário possa iniciar o chat direto (sem precisar de campanha).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('zapmass.openChatByPhone');
      if (!raw) return;
      // Antes consumiamos o payload na primeira execucao do effect,
      // mesmo se o socket ainda nao tivesse sincronizado conversations.
      // Isso fazia o "Abrir no Chat" (vindo de Contatos) falhar
      // intermitentemente. Agora so consumimos quando ha dados minimos
      // para resolver a conversa (ou criar o rascunho).
      if (conversations.length === 0 && connections.length === 0) return;
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
      const displayName = getSystemNameForPhone(digits) || contactName || `+${digits}`;
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
    const base =
      draftConversations.length === 0
        ? conversations
        : (() => {
            const realIds = new Set(conversations.map((c) => c.id));
            const validDrafts = draftConversations.filter((d) => !realIds.has(d.id));
            if (validDrafts.length === 0) return conversations;
            return [...conversations, ...validDrafts];
          })();
    return dedupeConversationsById(base);
  }, [conversations, draftConversations]);

  // Prioriza nome do sistema para exibicao de conversa.
  // Se nao houver cadastro interno, mantem nome vindo do celular/WhatsApp.
  const effectiveConversations = useMemo(
    () =>
      mergedConversations.map((conv) => {
        const preferredName = resolveSystemNameForConv(conv);
        if (!preferredName || preferredName === conv.contactName) return conv;
        return { ...conv, contactName: preferredName };
      }),
    [mergedConversations, resolveSystemNameForConv]
  );

  // Relatórios / outras abas: abrir conversa por id (ex.: avaliação do cliente).
  useEffect(() => {
    let id = '';
    try {
      id = sessionStorage.getItem(OPEN_CHAT_BY_CONVERSATION_ID_KEY)?.trim() || '';
    } catch {
      /* ignore */
    }
    if (!id) return;
    if (effectiveConversations.some((c) => c.id === id)) {
      try {
        sessionStorage.removeItem(OPEN_CHAT_BY_CONVERSATION_ID_KEY);
      } catch {
        /* ignore */
      }
      setSelectedChatId(id);
      setShowMobileChat(true);
    }
  }, [effectiveConversations]);

  /** Pushname/original antes do override pela agenda (lista efetiva). */
  const waPushNameByConvId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of mergedConversations) {
      const nm = (c.contactName || '').trim();
      if (nm) m.set(c.id, nm);
    }
    return m;
  }, [mergedConversations]);

  /**
   * Cache de exibição por conversa.
   *
   * MOTIVO: o virtualizer (lista do Chat e colunas do Kanban) chama `getConversationDisplay` e
   * `getConvAvatar` para CADA card visível a cada frame de scroll (60Hz). Sem cache, cada chamada
   * percorre `phoneRawForContactLookup`, `normalizeDigits`, `buildPhoneDigitLookupKeys` e cria
   * Set/Map novos — durante o scroll a CPU bate 100% e a UI trava ("não consigo mexer em mais nada").
   *
   * Pré-computamos tudo uma única vez quando muda `mergedConversations` ou `systemContactNameByDigits`.
   * Os callbacks abaixo viram lookups O(1) no Map.
   */
  const displayInfoByConvId = useMemo(() => {
    const map = new Map<string, { primary: string; whatsappSubtitle?: string; phoneSecondary?: string }>();
    const same = (a: string, b: string) =>
      a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ');
    // Nomes genéricos que o Evolution API retorna quando não tem o nome real do contato
    const GENERIC_WA_NAMES = new Set(['contato', 'contact', 'unknown', 'desconhecido']);
    const isGenericName = (n: string) => GENERIC_WA_NAMES.has(n.toLowerCase());

    for (const conv of mergedConversations) {
      const waNameRaw = (conv.contactName || '').trim();
      // Dígitos longos (>14) = LID interno do WhatsApp, não é telefone nem nome legível.
      const waNameIsLidDigits = /^\d{14,}$/.test(normalizeDigits(waNameRaw)) && looksLikeDigitsOnlyContactLabel(waNameRaw);
      // Tratar nomes genéricos da Evolution API ("Contato", "Contact" etc.) e LIDs como vazio,
      // para cair para phoneLabel ou nome do CRM.
      const waName = isGenericName(waNameRaw) || waNameIsLidDigits ? '' : waNameRaw;
      const systemName = resolveSystemNameForConv(conv);
      const friendlyStored =
        waName &&
        !looksLikeDigitsOnlyContactLabel(waName)
          ? waName
          : '';
      // Para JIDs @lid, os dígitos do ID são IDs internos do WhatsApp — não são telefones reais.
      // Porém o servidor pode ter resolvido o telefone real em contactPhone (campo alternativo da Evolution).
      const convIsLid = isLidConvId(conv.id);
      const rawDigits = normalizeDigits(phoneRawForContactLookup(conv) || digitsForContactMatch(conv));
      // Para @lid: só aceita dígitos vindos de contactPhone (telefone real resolvido), nunca do ID (LID interno).
      const lidPhoneDigits = (() => {
        if (!convIsLid) return '';
        const d = normalizeDigits(conv.contactPhone || '');
        return d.length >= 10 && d.length <= 13 ? d : '';
      })();
      const digits = convIsLid ? lidPhoneDigits : rawDigits;
      // Formata o número para exibição amigável (ex.: +55 (11) 9 4955-0446)
      const phoneLabel = digits ? formatPhoneDisplay(digits) : '';
      // Quando só há número (sem nome amigável), usar phoneLabel como principal para exibir formatado
      const rawNumberOnly = !systemName && !friendlyStored && looksLikeDigitsOnlyContactLabel(waName);
      // Prioridade: 1) CRM (Firestore) 2) Nome do WhatsApp 3) Número formatado.
      // Último recurso: waNameRaw só se não for LID interno; senão "Contato".
      const lastResort = waNameIsLidDigits ? '' : waNameRaw;
      const primary = systemName || friendlyStored || (rawNumberOnly ? phoneLabel : waName) || phoneLabel || lastResort || 'Contato';

      let whatsappSubtitle: string | undefined;
      // Mostrar o nome do WA como subtítulo apenas se for diferente do nome do sistema
      if (systemName && waName && !looksLikeDigitsOnlyContactLabel(waName) && !same(systemName, waName)) {
        whatsappSubtitle = waName;
      }

      let phoneSecondary: string | undefined;
      // Mostrar telefone formatado como info secundária (nunca mostrar LID longo como está)
      const phoneFmt = formatPhoneDisplay(digits);
      if (phoneFmt && primary !== phoneFmt && !looksLikeDigitsOnlyContactLabel(primary)) {
        phoneSecondary = phoneFmt;
      }

      map.set(conv.id, { primary, whatsappSubtitle, phoneSecondary });
    }
    return map;
  }, [mergedConversations, resolveSystemNameForConv]);

  /** Título forte = nome na base CRM; subtítulo menor = WhatsApp/celular/telefone. */
  const getConversationDisplay = useCallback(
    (
      conv: Conversation
    ): { primary: string; whatsappSubtitle?: string; phoneSecondary?: string } => {
      const cached = displayInfoByConvId.get(conv.id);
      if (cached) return cached;
      // Fallback raríssimo (conversa veio de fora de mergedConversations, ex.: id sintético).
      const waNameRaw = (conv.contactName || '').trim();
      const GENERIC = new Set(['contato', 'contact', 'unknown', 'desconhecido']);
      const waName = GENERIC.has(waNameRaw.toLowerCase()) ? '' : waNameRaw;
      const phoneLabel = (() => {
        const d = normalizeDigits(phoneRawForContactLookup(conv) || digitsForContactMatch(conv));
        return d ? formatPhoneDisplay(d) : '';
      })();
      const primary = waName || phoneLabel || waNameRaw || 'Contato';
      return { primary };
    },
    [displayInfoByConvId]
  );

  /** Cache de avatar por id — usa diretamente o `primary` já calculado em `displayInfoByConvId`. */
  const avatarByConvId = useMemo(() => {
    const map = new Map<string, string>();
    for (const conv of mergedConversations) {
      const primary = displayInfoByConvId.get(conv.id)?.primary ?? (conv.contactName || 'Contato');
      map.set(conv.id, getAvatar(primary, resolveProfilePic(conv)));
    }
    return map;
  }, [mergedConversations, displayInfoByConvId, resolveProfilePic]);

  const getConvAvatar = useCallback(
    (conv: Conversation) => {
      const cached = avatarByConvId.get(conv.id);
      if (cached) return cached;
      const { primary } = getConversationDisplay(conv);
      return getAvatar(primary, resolveProfilePic(conv));
    },
    [avatarByConvId, getConversationDisplay, resolveProfilePic]
  );

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

  const selectedConversation = useMemo(
    () => effectiveConversations.find((c) => c.id === selectedChatId),
    [effectiveConversations, selectedChatId]
  );
  const selectedConnection = useMemo(() => {
    const cid = selectedConversation?.connectionId;
    if (!cid) return undefined;
    return connectionById.get(cid);
  }, [connectionById, selectedConversation?.connectionId]);
  const pipelineAgg = useMemo(() => getConversationPipelineAgg(selectedConversation), [selectedConversation]);
  const selectedDisplay = useMemo(
    () => (selectedConversation ? getConversationDisplay(selectedConversation) : null),
    [selectedConversation, getConversationDisplay]
  );
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

  const filteredByConnection = useMemo(() => {
    if (selectedConnectionId === 'ALL') return effectiveConversations;
    return effectiveConversations.filter((c) => c.connectionId === selectedConnectionId);
  }, [effectiveConversations, selectedConnectionId]);

  // Classifica uma unica vez e reusa em filtros + contadores
  const originByConv = useMemo(() => {
    const map = new Map<string, ConversationOrigin>();
    for (const c of effectiveConversations) map.set(c.id, classifyConversation(c));
    return map;
  }, [effectiveConversations]);

  const filteredConversations = useMemo(() => {
    let list = filteredByConnection;
    // Aba "Todas" = experiência WhatsApp Web: só conversas reais. Contatos da agenda sem
    // mensagem (origem 'empty') ficam apenas na aba "Vazias". 'phone' exige preview/timestamp,
    // então conversas reais nunca são escondidas por engano.
    if (chatFilter === 'all') list = list.filter((c) => originByConv.get(c.id) !== 'empty');
    if (chatFilter === 'unread') list = list.filter((c) => c.unreadCount > 0);
    if (chatFilter === 'groups') list = list.filter((c) => c.id.endsWith('@g.us'));
    if (chatFilter === 'system') list = list.filter((c) => originByConv.get(c.id) === 'system');
    if (chatFilter === 'empty') list = list.filter((c) => originByConv.get(c.id) === 'empty');
    if (chatFilter === 'pinned') list = list.filter((c) => Boolean(crm.data[c.id]?.pinned));
    const q = deferredSearchTerm.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, '');
    return list
      .filter((c) => {
        if (!q) return true;
        const { primary, whatsappSubtitle } = getConversationDisplay(c);
        return (
          primary.toLowerCase().includes(q) ||
          !!whatsappSubtitle?.toLowerCase().includes(q) ||
          c.contactName.toLowerCase().includes(q) ||
          (c.contactPhone || '').includes(deferredSearchTerm) ||
          (qDigits.length >= 3 && digitsForContactMatch(c).includes(qDigits))
        );
      })
      .sort((a, b) => {
        const pa = crm.data[a.id]?.pinned ? 1 : 0;
        const pb = crm.data[b.id]?.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
      });
    // dedupeConversationsById já foi removido — deduplicação ocorre no servidor.
  }, [
    filteredByConnection,
    chatFilter,
    deferredSearchTerm,
    originByConv,
    crm.data,
    getConversationDisplay
  ]);

  /** Contagens por canal (evita `.filter` em O(canais × conversas) no `<Select>`). */
  const conversationCountByConnectionId = useMemo(() => {
    const m = new Map<string, number>();
    for (const cv of conversations) {
      const id = cv.connectionId || '__none__';
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [conversations]);

  const filteredByConnTotals = useMemo(() => {
    let unread = 0;
    let groups = 0;
    let system = 0;
    let empty = 0;
    for (const c of filteredByConnection) {
      unread += c.unreadCount;
      if (c.id.endsWith('@g.us')) groups++;
      const o = originByConv.get(c.id);
      if (o === 'system') system++;
      else if (o === 'empty') empty++;
    }
    return { unread, groups, system, empty };
  }, [filteredByConnection, originByConv]);

  const totalUnread = filteredByConnTotals.unread;
  const totalGroups = filteredByConnTotals.groups;
  const totalSystem = filteredByConnTotals.system;
  const totalEmpty = filteredByConnTotals.empty;

  const convListVirtualizer = useVirtualizer({
    count: pipelineView === 'lista' ? filteredConversations.length : 0,
    getScrollElement: () => conversationListScrollRef.current,
    estimateSize: () => 76,
    overscan: 8,
    getItemKey: (index) => filteredConversations[index]?.id ?? index
  });

  const [avatarFetchTick, setAvatarFetchTick] = useState(0);
  useEffect(() => {
    const el = conversationListScrollRef.current;
    if (!el || pipelineView !== 'lista') return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAvatarFetchTick((n) => n + 1), 250);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
    };
  }, [pipelineView, filteredConversations.length]);

  const listaScrollAnchorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedChatId) {
      listaScrollAnchorRef.current = null;
      return;
    }
    if (pipelineView !== 'lista') return;
    const idx = filteredConversations.findIndex((c) => c.id === selectedChatId);
    if (idx < 0) return;
    const key = `${selectedChatId}:${idx}`;
    if (listaScrollAnchorRef.current === key) return;
    listaScrollAnchorRef.current = key;
    requestAnimationFrame(() => {
      convListVirtualizer.scrollToIndex(idx, { align: 'auto' });
    });
  }, [pipelineView, selectedChatId, filteredConversations, convListVirtualizer]);

  // Traz foto do WhatsApp para conversas visíveis na lista (scroll + overscan).
  useEffect(() => {
    if (pipelineView !== 'lista') return;
    const now = Date.now();
    const cooldownMs = 120_000;
    const visible = convListVirtualizer.getVirtualItems();
    const indices = new Set<number>();
    for (const row of visible) {
      for (let i = row.index - 4; i <= row.index + 10; i++) {
        if (i >= 0 && i < filteredConversations.length) indices.add(i);
      }
    }
    for (let i = 0; i < Math.min(40, filteredConversations.length); i++) indices.add(i);
    let requested = 0;
    for (const idx of indices) {
      if (requested >= 35) break;
      const conv = filteredConversations[idx];
      if (!conv?.id || conv.id.endsWith('@g.us')) continue;
      const pic = conv.profilePicUrl || resolveProfilePic(conv);
      if (pic?.startsWith('data:')) continue;
      const lastFetch = avatarFetchAtRef.current.get(conv.id) || 0;
      if (now - lastFetch < cooldownMs) continue;
      avatarFetchAtRef.current.set(conv.id, now);
      requested++;
      fetchConversationPicture(conv.id);
    }
  }, [
    filteredConversations,
    fetchConversationPicture,
    resolveProfilePic,
    convListVirtualizer,
    pipelineView,
    avatarFetchTick
  ]);

  /** Ao selecionar conversa real: hidratar arquivo Firestore já (antes do scroll / load-chat-history pesado). */
  useEffect(() => {
    if (!selectedChatId || isSelectedDraft) return;
    const t = window.setTimeout(() => {
      void hydrateFirestoreChatArchive(selectedChatId, 500);
    }, 70);
    return () => window.clearTimeout(t);
  }, [selectedChatId, isSelectedDraft, hydrateFirestoreChatArchive]);

  // Listas usadas no modal de auditoria
  const systemConvs = useMemo(
    () => effectiveConversations.filter((c) => originByConv.get(c.id) === 'system'),
    [effectiveConversations, originByConv]
  );
  const emptyConvs = useMemo(
    () => effectiveConversations.filter((c) => originByConv.get(c.id) === 'empty'),
    [effectiveConversations, originByConv]
  );
  const phoneConvs = useMemo(
    () => effectiveConversations.filter((c) => originByConv.get(c.id) === 'phone'),
    [effectiveConversations, originByConv]
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
      const res = await loadChatHistory(
        conversationId,
        Math.max(nextLevel, prevCount + 50),
        false
      );
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
      // Só marca fim quando o total não cresceu após pedir o máximo de histórico.
      const grew = res.total > prevCount;
      if (!grew && nextLevel >= HISTORY_LEVELS[HISTORY_LEVELS.length - 1]) {
        setHistoryExhausted((prev) => new Set(prev).add(conversationId));
      } else if (grew) {
        setHistoryExhausted((prev) => {
          if (!prev.has(conversationId)) return prev;
          const next = new Set(prev);
          next.delete(conversationId);
          return next;
        });
      }
    },
    [historyExhausted, loadChatHistory, conversations]
  );

  // Auto-carrega histórico ao abrir chat com pouco cache (socket manda só um tail).
  useEffect(() => {
    if (!selectedChatId) return;
    if (isSelectedDraft) return;
    const conv = conversations.find((c) => c.id === selectedChatId);
    if (!conv) return;
    const already = historyRequestedRef.current.get(selectedChatId) || 0;
    const msgCount = conv.messages.length;
    if (msgCount >= 200) return;
    // Re-tenta se ainda temos quase nada após um fetch anterior curto.
    if (already > 0 && msgCount > 40) return;
    loadMoreHistoryFor(selectedChatId, true, true);
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
    if (!selectedChatId || !selectedConversation || isSelectedDraft) return;
    if (selectedConversation.profilePicUrl) return;
    if (resolveProfilePic(selectedConversation)) return;
    fetchConversationPicture(selectedChatId);
  }, [selectedChatId, selectedConversation, isSelectedDraft, resolveProfilePic, fetchConversationPicture]);

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

  const selectChat = useCallback((id: string) => {
    setSelectedChatId(id);
    setShowMobileChat(true);
    setShowContactInfo(false);
    setShowEmojiPicker(false);
    setShowChatSearch(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

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

  /**
   * Selecao de arquivo: NAO envia mais direto. Apenas valida tamanho e abre
   * o painel de pre-visualizacao para o usuario revisar e (opcionalmente)
   * digitar uma legenda antes de confirmar o envio.
   */
  const handleFileSelected = (file?: File | null) => {
    if (!file || !selectedChatId) return;
    if (isSelectedDraft && !selectedDraftChannelId) {
      toast.error('Escolha um canal para enviar o arquivo.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > CHAT_UPLOAD_LIMIT_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      toast.error(
        `Arquivo de ${sizeMb} MB excede o limite de ${CHAT_UPLOAD_LIMIT_MB} MB por envio. ` +
          'Envie pelo celular ou comprima antes.',
        { duration: 7000 }
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (pendingMediaPreviewUrl) URL.revokeObjectURL(pendingMediaPreviewUrl);
    setPendingMediaFile(file);
    setPendingMediaPreviewUrl(URL.createObjectURL(file));
    setPendingMediaCaption(inputText);
    setShowEmojiPicker(false);
    setShowQuickReplies(false);
    setTimeout(() => pendingCaptionRef.current?.focus(), 60);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** Cancela o preview e limpa o arquivo pendente. */
  const cancelPendingMedia = () => {
    if (pendingMediaPreviewUrl) URL.revokeObjectURL(pendingMediaPreviewUrl);
    setPendingMediaFile(null);
    setPendingMediaPreviewUrl(null);
    setPendingMediaCaption('');
  };

  /** Faz o envio efetivo (lendo o arquivo, emitindo via socket, etc.). */
  const confirmAndSendPendingMedia = async () => {
    const file = pendingMediaFile;
    if (!file || !selectedChatId) return;
    if (isSelectedDraft && !selectedDraftChannelId) {
      toast.error('Escolha um canal para enviar o arquivo.');
      return;
    }
    const targetConversationId = isSelectedDraft
      ? `${selectedDraftChannelId}:${(selectedConversation?.contactPhone || '').replace(/\D/g, '')}@c.us`
      : selectedChatId;
    if (!targetConversationId) return;

    const caption = pendingMediaCaption.trim();

    setSendingMedia(true);
    setUploadProgress(null);
    setUploadStatus('idle');
    setUploadStage('reading');
    setUploadStartedAt(Date.now());
    let sentOk = false;
    try {
      const prep = await prepareCampaignAttachmentForSend(file);
      for (const h of prep.hints) {
        toast(h, { duration: 6000 });
      }
      const fileToSend = prep.file;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
        reader.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const pct = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
          setUploadProgress(pct);
        };
        reader.readAsDataURL(fileToSend);
      });
      const commaIdx = dataUrl.indexOf(',');
      const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
      const mimeType = fileToSend.type || 'application/octet-stream';
      if (!dataBase64) throw new Error('Nao foi possivel processar o arquivo.');
      // Leitura local concluída → começa o upload pelo socket. A barra com %
      // não pode mais subir (não há progresso real do socket emit).
      setUploadProgress(null);
      setUploadStage('uploading');
      // Após ~3s de "Enviando ao servidor" sem resposta, assumimos que o
      // servidor já recebeu e está encaminhando ao WhatsApp. É só feedback
      // visual: o socket pode resolver antes ou depois sem mudar nada lógico.
      const transitionTimer = setTimeout(() => setUploadStage('sending'), 3000);
      const sendMediaAsDocument = prep.sendMediaAsDocument;
      const resp = await sendMedia(targetConversationId, {
        dataBase64,
        mimeType,
        fileName: fileToSend.name || 'arquivo',
        caption: caption || undefined,
        sendMediaAsDocument
      });
      clearTimeout(transitionTimer);
      if (!resp.ok) {
        throw new Error(resp.error || 'Falha ao enviar arquivo.');
      }
      setUploadStage('idle');
      setUploadStatus('success');
      setLastFailedFile(null);
      sentOk = true;
      // Limpa preview + a caixa de mensagem (se a legenda usou o texto digitado)
      cancelPendingMedia();
      if (caption && caption === inputText.trim()) {
        setInputText('');
      }
      if (isSelectedDraft && targetConversationId !== selectedChatId) {
        setSelectedChatId(targetConversationId);
      }
    } catch (e: any) {
      setUploadStage('idle');
      setUploadStatus('error');
      setLastFailedFile(file);
      toast.error(e?.message || 'Falha ao enviar arquivo.', { duration: 8000 });
    } finally {
      setSendingMedia(false);
      setUploadStartedAt(null);
      setTimeout(() => setUploadProgress(null), 500);
      if (sentOk) {
        setTimeout(() => setUploadStatus('idle'), 2200);
      }
    }
  };

  const insertEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const getLastMsgPreview = useCallback((conv: Conversation) => {
    const last = conv.messages[conv.messages.length - 1];
    if (last) {
      if (last.type === 'image') return 'Foto';
      if (last.type === 'video') return 'Vídeo';
      if (last.type === 'audio') return 'Áudio';
      if (last.type === 'sticker') return 'Figurinha';
      if (last.type === 'document') return 'Documento';
      const text = (last.text || conv.lastMessage || '').trim();
      if (text) return text;
    }
    const preview = (conv.lastMessage || '').trim();
    if (preview && preview !== '[Mídia]') return preview;
    return '';
  }, []);

  const getLastMsgIcon = useCallback((conv: Conversation) => {
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.sender !== 'me') return null;
    if (last.status === 'read')
      return <CheckCheck className="w-[14px] h-[14px] flex-shrink-0 text-blue-400" />;
    if (last.status === 'delivered')
      return <CheckCheck className="w-[14px] h-[14px] flex-shrink-0" style={{ color: 'var(--text-3)' }} />;
    return <Check className="w-[14px] h-[14px] flex-shrink-0" style={{ color: 'var(--text-3)' }} />;
  }, []);

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
      className="wa-pipeline-root flex h-[calc(100vh-5.5rem)] overflow-hidden rounded-2xl relative"
      style={{
        border: '1px solid var(--wa-divider)',
        boxShadow: 'var(--wa-shadow-md)'
      }}
    >
      <div
        className={`wa-side ${showMobileChat ? 'hidden md:flex' : 'flex'} relative w-full flex-col flex-shrink-0 ${
          pipelineView === 'quadro'
            ? quadroHidesRightPane
              ? 'md:flex-1 md:min-w-0'
              : 'md:flex-1 md:min-w-0 md:max-w-[min(1100px,72vw)]'
            : 'md:w-[400px]'
        }`}
      >
        {/* Header WA Web — avatar/branding minimalista + ícones */}
        <div className="wa-side-header flex items-center justify-between px-3 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--wa-green) 0%, var(--wa-green-strong) 100%)',
                color: '#fff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.12)'
              }}
              aria-hidden
              title="ZapMass · CRM"
            >
              <Workflow className="w-[18px] h-[18px]" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-medium leading-tight truncate" style={{ color: 'var(--wa-text)' }}>
                Pipeline
              </p>
              <p className="text-[11.5px] leading-tight truncate mt-0.5" style={{ color: 'var(--wa-text-3)' }}>
                ZapMass · CRM
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              className="wa-icon-btn"
              onClick={() => setPipelineView(pipelineView === 'lista' ? 'quadro' : 'lista')}
              title={pipelineView === 'lista' ? 'Visualizar como Quadro (Kanban)' : 'Voltar para a Lista'}
              aria-label="Alternar Lista/Quadro"
            >
              {pipelineView === 'lista' ? (
                <LayoutGrid className="w-[22px] h-[22px]" strokeWidth={1.75} />
              ) : (
                <List className="w-[22px] h-[22px]" strokeWidth={1.75} />
              )}
            </button>
            <button
              type="button"
              className="wa-icon-btn"
              onClick={() => {
                setAuditCategory(totalSystem > 0 ? 'system' : totalEmpty > 0 ? 'empty' : 'phone');
                setAuditSelection(new Set());
                setShowAudit(true);
              }}
              title="Auditar origem das conversas"
              aria-label="Auditar origem das conversas"
            >
              <ShieldCheck className="w-[22px] h-[22px]" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Aviso compacto de origem (só quando há disparos de campanha sem resposta para revisar) */}
        {totalSystem > 0 && (
          <button
            type="button"
            onClick={() => {
              setAuditCategory('system');
              setAuditSelection(new Set());
              setShowAudit(true);
            }}
            className="flex items-center gap-2 px-3 py-2 text-left flex-shrink-0"
            style={{
              background: 'color-mix(in srgb, #f59e0b 10%, var(--wa-panel))',
              borderBottom: '1px solid var(--wa-divider)',
              color: 'var(--wa-text-2)'
            }}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#f59e0b' }} />
            <span className="text-[12.5px] truncate flex-1">
              {totalSystem} conversa{totalSystem === 1 ? '' : 's'} de campanha sem resposta · revisar
            </span>
          </button>
        )}

        {/* Busca estilo WA Web */}
        <div className="wa-search-wrap flex-shrink-0">
          <div className="wa-search">
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--wa-text-3)' }} aria-hidden />
            <input
              type="text"
              placeholder="Pesquisar"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Pesquisar conversas"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="flex-shrink-0"
                aria-label="Limpar busca"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <X className="w-4 h-4" style={{ color: 'var(--wa-text-3)' }} />
              </button>
            )}
          </div>
        </div>

        {/* Pills de filtros estilo WA */}
        <div className="wa-filter-row flex-shrink-0">
          <button
            type="button"
            className="wa-filter-pill"
            data-active={chatFilter === 'all' ? 'true' : 'false'}
            onClick={() => setChatFilter('all')}
          >
            Todas
          </button>
          <button
            type="button"
            className="wa-filter-pill"
            data-active={chatFilter === 'unread' ? 'true' : 'false'}
            onClick={() => setChatFilter('unread')}
          >
            Não lidas{totalUnread > 0 ? ` ${totalUnread}` : ''}
          </button>
          {crm.stats.pinned > 0 && (
            <button
              type="button"
              className="wa-filter-pill"
              data-active={chatFilter === 'pinned' ? 'true' : 'false'}
              onClick={() => setChatFilter('pinned')}
            >
              Favoritos {crm.stats.pinned}
            </button>
          )}
          <button
            type="button"
            className="wa-filter-pill"
            data-active={chatFilter === 'groups' ? 'true' : 'false'}
            onClick={() => setChatFilter('groups')}
          >
            Grupos{totalGroups > 0 ? ` ${totalGroups}` : ''}
          </button>
          {totalSystem > 0 && (
            <button
              type="button"
              className="wa-filter-pill"
              data-active={chatFilter === 'system' ? 'true' : 'false'}
              onClick={() => setChatFilter('system')}
            >
              Disparo {totalSystem}
            </button>
          )}
          {totalEmpty > 0 && (
            <button
              type="button"
              className="wa-filter-pill"
              data-active={chatFilter === 'empty' ? 'true' : 'false'}
              onClick={() => setChatFilter('empty')}
            >
              Vazias {totalEmpty}
            </button>
          )}
        </div>

        {/* Seletor de canal (só com >1 chip ativo) */}
        {connectedChannels.length > 1 && (
          <div
            className="px-3 py-2 flex-shrink-0"
            style={{ background: 'var(--wa-panel)', borderBottom: '1px solid var(--wa-divider)' }}
          >
            <Select
              value={selectedConnectionId}
              onChange={(e) => setSelectedConnectionId(e.target.value as string | 'ALL')}
            >
              <option value="ALL">
                Todos os canais ({filteredByConnection.length})
              </option>
              {connectedChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({conversationCountByConnectionId.get(c.id) ?? 0})
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {pipelineView === 'quadro' ? (
            <ClientPipelineBoard
              userUid={user?.uid}
              conversations={filteredConversations}
              selectedChatId={selectedChatId}
              onSelectChat={selectChat}
              getConvAvatar={getConvAvatar}
              formatConversationTitles={getConversationDisplay}
              connectionName={pipelineBoardConnectionName}
            />
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16 px-6 min-h-0 overflow-y-auto">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                style={{ background: 'var(--wa-search)' }}
              >
                <MessageCircle className="w-5 h-5" style={{ color: 'var(--wa-text-3)' }} />
              </div>
              <p className="text-[14px] font-medium" style={{ color: 'var(--wa-text)' }}>
                Nenhuma conversa
              </p>
              <p className="text-[12.5px] text-center mt-1" style={{ color: 'var(--wa-text-3)' }}>
                {chatFilter === 'unread'
                  ? 'Você leu todas as mensagens.'
                  : searchTerm
                    ? `Sem resultados para "${searchTerm}".`
                    : 'Nenhuma conversa disponível.'}
              </p>
            </div>
          ) : (
            <div
              ref={conversationListScrollRef}
              className="flex-1 min-h-0 overflow-y-auto"
            >
              <div
                style={{
                  height: convListVirtualizer.getTotalSize(),
                  width: '100%',
                  position: 'relative'
                }}
              >
                {convListVirtualizer.getVirtualItems().map((vRow) => {
                  const conv = filteredConversations[vRow.index];
                  if (!conv) return null;
                  const isActive = selectedChatId === conv.id;
                  const isGroup = conv.id.endsWith('@g.us');
                  const origin = originByConv.get(conv.id) || 'phone';
                  const lastMsgPreview = getLastMsgPreview(conv);
                  const lastIcon = getLastMsgIcon(conv);
                  const connection =
                    connections.length > 1 && conv.connectionId
                      ? connectionById.get(conv.connectionId)
                      : undefined;
                  const crmData = crm.get(conv.id);
                  const crmStatus = crmData.status ? STATUS_META[crmData.status] : null;
                  const hasReminder = crmData.reminderAt && crmData.reminderAt > Date.now();
                  const hasNotes = !!(crmData.notes && crmData.notes.trim());
                  const disp = getConversationDisplay(conv);
                  const avatarSrc = getConvAvatar(conv);
                  return (
                    <div
                      key={`${conv.id}:${vRow.index}`}
                      data-index={vRow.index}
                      ref={convListVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vRow.start}px)`
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => selectChat(conv.id)}
                        className="wa-conv-row group"
                        data-active={isActive ? 'true' : 'false'}
                      >
                        <div className="relative flex-shrink-0">
                          <img
                            src={avatarSrc}
                            loading="lazy"
                            decoding="async"
                            className="wa-conv-avatar"
                            alt=""
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              const img = e.currentTarget;
                              if (img.dataset.fallback === '1') return;
                              img.dataset.fallback = '1';
                              const { primary } = disp;
                              img.src = getAvatar(primary);
                              if (conv.profilePicUrl?.startsWith('http')) {
                                fetchConversationPicture(conv.id);
                              }
                            }}
                          />
                          {isGroup && (
                            <div
                              className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                              style={{
                                background: 'var(--wa-panel)',
                                border: '1.5px solid var(--wa-divider)'
                              }}
                            >
                              <Users className="w-2.5 h-2.5" style={{ color: 'var(--wa-text-2)' }} />
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
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1 min-w-0 flex-1">
                              <span className="wa-conv-name truncate" title={disp.primary}>
                                {disp.primary}
                              </span>
                              {crmData.favoriteAt && (
                                <Star className="w-3 h-3 flex-shrink-0 fill-current" style={{ color: '#f59e0b' }} />
                              )}
                              {hasNotes && (
                                <StickyNote className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--wa-green-strong)' }} />
                              )}
                              {hasReminder && (
                                <Bell className="w-3 h-3 flex-shrink-0" style={{ color: '#ef4444' }} />
                              )}
                            </div>
                            <span className="wa-conv-time tabular-nums" data-unread={conv.unreadCount > 0 ? 'true' : 'false'}>
                              {formatConversationListTime(conv)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5 min-h-[20px]">
                            <div className="flex items-center gap-1 min-w-0 flex-1">
                              {lastIcon}
                              <p className="wa-conv-preview truncate">{lastMsgPreview || '\u00A0'}</p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {crmStatus && (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-0.5"
                                  style={{ background: crmStatus.bg, color: crmStatus.color }}
                                  title={`Status: ${crmStatus.label}`}
                                >
                                  {crmStatus.emoji}
                                </span>
                              )}
                              {origin === 'system' && (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 font-semibold"
                                  style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
                                  title="Conversa criada pelo disparo"
                                >
                                  <Zap className="w-2.5 h-2.5" /> Disparo
                                </span>
                              )}
                              {origin === 'empty' && (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center"
                                  style={{ background: 'var(--wa-search)', color: 'var(--wa-text-3)' }}
                                  title="Contato sincronizado, sem mensagens"
                                >
                                  vazia
                                </span>
                              )}
                              {connections.length > 1 && connection && (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded truncate max-w-[80px]"
                                  style={{ background: 'var(--wa-search)', color: 'var(--wa-text-3)' }}
                                >
                                  {connection.name}
                                </span>
                              )}
                              {conv.unreadCount > 0 && (
                                <span className="wa-unread-badge">
                                  {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                          {crmData.tags && crmData.tags.length > 0 && (
                            <div className="flex items-center gap-1 mt-1 overflow-hidden">
                              {crmData.tags.slice(0, 3).map((tag) => {
                                const color = hashTagColor(tag);
                                return (
                                  <span
                                    key={tag}
                                    className="text-[10px] px-1.5 py-[1px] rounded-full font-semibold truncate"
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
                                <span className="text-[10px]" style={{ color: 'var(--wa-text-3)' }}>
                                  +{crmData.tags.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
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
                          className={`absolute right-9 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-opacity cursor-pointer ${
                            crmData.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                          style={{
                            background: crmData.pinned ? 'rgba(245,158,11,0.15)' : 'var(--wa-search)',
                            color: crmData.pinned ? '#f59e0b' : 'var(--wa-text-3)'
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
                            style={{ background: 'var(--wa-search)', color: '#ef4444' }}
                            title="Remover do painel"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {pipelineView === 'quadro' && !selectedChatId && (
          <div className="pointer-events-none absolute inset-y-8 right-0 z-[8] hidden md:flex items-center pr-1">
            <button
              type="button"
              onClick={() => setQuadroRightPaneCollapsed((v) => !v)}
              className="pointer-events-auto flex flex-col items-center justify-center gap-1 rounded-l-xl py-3 px-1.5 min-w-[2.25rem] shadow-lg transition-opacity hover:opacity-95 active:opacity-90"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border-subtle)',
                borderRight: 'none',
                color: 'var(--text-2)',
                boxShadow: '-4px 0 18px -6px rgba(0,0,0,0.35)'
              }}
              title={
                quadroRightPaneCollapsed
                  ? 'Mostrar painel direito (introdução / conversa)'
                  : 'Esconder painel direito e ampliar o quadro'
              }
              aria-label={
                quadroRightPaneCollapsed
                  ? 'Mostrar painel direito'
                  : 'Esconder painel direito para ampliar o quadro'
              }
            >
              {quadroRightPaneCollapsed ? (
                <ChevronLeft className="w-5 h-5 shrink-0" strokeWidth={2} aria-hidden />
              ) : (
                <ChevronRight className="w-5 h-5 shrink-0" strokeWidth={2} aria-hidden />
              )}
              <span
                className="text-[9px] font-bold uppercase tracking-wider leading-tight text-center max-w-[2.75rem]"
                style={{ color: 'var(--text-3)' }}
              >
                {quadroRightPaneCollapsed ? 'Painel' : 'Ampliar'}
              </span>
            </button>
          </div>
        )}
      </div>

      <div
        className={`${
          quadroHidesRightPane
            ? 'hidden'
            : !showMobileChat && !selectedChatId
              ? 'hidden md:flex'
              : 'flex'
        } flex-1 flex-col min-w-0 relative`}
        style={{ background: 'var(--wa-bg)' }}
      >
        {selectedConversation ? (
          <>
            <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm z-10">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setShowMobileChat(false)}
                  className="md:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                  aria-label="Voltar"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex flex-col flex-1 min-w-0 gap-1.5">
                  <button
                    type="button"
                    className="flex items-center gap-3 w-full min-w-0 text-left rounded-xl -mx-1 px-1 py-0.5 transition-colors group"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                    onClick={() => setShowContactInfo(!showContactInfo)}
                  >
                    <div className="relative flex-shrink-0">
                      <img
                        src={getConvAvatar(selectedConversation)}
                        loading="eager"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-full object-cover ring-2 ring-transparent group-hover:ring-[var(--brand-500)]/30 transition-all"
                        alt=""
                      />
                      {crm.get(selectedConversation.id).pinned && (
                        <div
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900"
                          style={{ background: '#f59e0b' }}
                          title="Fixado"
                        >
                          <Pin className="w-2.5 h-2.5 text-white fill-white" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3
                          className="text-base font-bold truncate tracking-tight text-slate-900 dark:text-white group-hover:text-[var(--brand-600)] dark:group-hover:text-[var(--brand-400)] transition-colors"
                          title={
                            selectedDisplay?.primary ??
                            selectedConversation.contactName ??
                            ''
                          }
                        >
                          {selectedDisplay?.primary ?? selectedConversation.contactName}
                        </h3>
                        {(() => {
                          const s = crm.get(selectedConversation.id).status;
                          if (!s) return null;
                          const m = STATUS_META[s];
                          return (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider inline-flex items-center gap-1 shadow-sm"
                              style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}30` }}
                            >
                              <span>{m.emoji}</span>
                              {m.label}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-[11px] font-medium truncate mt-0.5 text-slate-500 dark:text-slate-400">
                        {selectedDisplay?.whatsappSubtitle && (
                          <span title="Nome salvo no WhatsApp / celular" className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded mr-1.5 text-slate-600 dark:text-slate-300">~ {selectedDisplay.whatsappSubtitle}</span>
                        )}
                        {(selectedDisplay?.phoneSecondary || selectedConversation.contactPhone) && (
                          <span className="font-mono tabular-nums">
                            {selectedDisplay?.phoneSecondary || selectedConversation.contactPhone}
                          </span>
                        )}
                        {selectedConnection && (
                          <span className="opacity-70 ml-1.5 before:content-['•'] before:mr-1.5">{selectedConnection.name}</span>
                        )}
                      </p>
                    </div>
                  </button>
                {!workspaceLoading &&
                  workspaceAuthUid &&
                  effectiveWorkspaceUid &&
                  !isSelectedDraft &&
                  selectedConversation?.id &&
                  (isTeamMember || isWorkspaceOwner) && (
                    <div className="flex flex-wrap items-center gap-2 pl-[3px] md:pl-0" role="toolbar" aria-label="Inbox e transferência">
                      {(() => {
                        const claimedBy = selectedConversation.inboxClaimedByAuthUid;
                        const shortClaim = claimedBy
                          ? claimedBy.length > 10
                            ? `${claimedBy.slice(0, 6)}…${claimedBy.slice(-4)}`
                            : claimedBy
                          : '';
                        const isMineClaim = Boolean(claimedBy && claimedBy === workspaceAuthUid);
                        const canClaim = !claimedBy;
                        const ownerCanPull =
                          Boolean(claimedBy) && isWorkspaceOwner && claimedBy !== workspaceAuthUid;
                        const canManageClaim =
                          Boolean(claimedBy) && (isWorkspaceOwner || isMineClaim);

                        return (
                          <>
                            {claimedBy && (
                              <span
                                className="text-[10px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1"
                                style={{ background: 'var(--wa-search)', color: 'var(--wa-text-2)' }}
                                title={`Atribuída a UID: ${claimedBy}`}
                              >
                                <UserRound className="w-3 h-3 flex-shrink-0" aria-hidden />
                                {isMineClaim
                                  ? isWorkspaceOwner
                                    ? 'Você (responsável)'
                                    : 'Com você'
                                  : `Atribuída (${shortClaim})`}
                              </span>
                            )}
                            {canClaim && (
                              <button
                                type="button"
                                disabled={inboxActionBusy}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-opacity disabled:opacity-50"
                                style={{
                                  background: 'color-mix(in srgb, #10b981 16%, transparent)',
                                  color: 'var(--wa-green-strong)',
                                  border: '1px solid color-mix(in srgb, #10b981 38%, transparent)'
                                }}
                                onClick={() => {
                                  void (async () => {
                                    const id = selectedConversation.id;
                                    setInboxActionBusy(true);
                                    try {
                                      await inboxWorkspaceApi('/api/workspace/inbox-claim', {
                                        method: 'POST',
                                        body: JSON.stringify({ conversationId: id })
                                      });
                                      if (workspaceAuthUid) patchConversationInboxClaim(id, workspaceAuthUid);
                                      socket?.emit('request-conversations-sync');
                                      toast.success('Atendimento assumido por você.');
                                    } catch (err) {
                                      toast.error(err instanceof Error ? err.message : 'Falha ao assumir.');
                                    } finally {
                                      setInboxActionBusy(false);
                                    }
                                  })();
                                }}
                              >
                                <UserRound className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                                Assumir atendimento
                              </button>
                            )}
                            {ownerCanPull && (
                              <button
                                type="button"
                                disabled={inboxActionBusy}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-opacity disabled:opacity-50"
                                style={{
                                  background: 'color-mix(in srgb, #10b981 16%, transparent)',
                                  color: 'var(--wa-green-strong)',
                                  border: '1px solid color-mix(in srgb, #10b981 38%, transparent)'
                                }}
                                title="Passa a conversa para o seu atendimento (substitui quem a tinha assumido)."
                                onClick={() => {
                                  void (async () => {
                                    const id = selectedConversation.id;
                                    setInboxActionBusy(true);
                                    try {
                                      await inboxWorkspaceApi('/api/workspace/inbox-claim', {
                                        method: 'POST',
                                        body: JSON.stringify({ conversationId: id })
                                      });
                                      if (workspaceAuthUid) patchConversationInboxClaim(id, workspaceAuthUid);
                                      socket?.emit('request-conversations-sync');
                                      toast.success('Atendimento assumido por você.');
                                    } catch (err) {
                                      toast.error(err instanceof Error ? err.message : 'Falha ao assumir.');
                                    } finally {
                                      setInboxActionBusy(false);
                                    }
                                  })();
                                }}
                              >
                                <UserRound className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                                Assumir para mim
                              </button>
                            )}
                            {canManageClaim && (
                              <>
                                <button
                                  type="button"
                                  disabled={inboxActionBusy}
                                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-opacity disabled:opacity-50"
                                  style={{
                                    background: 'color-mix(in srgb, #6366f1 14%, transparent)',
                                    color: '#4f46e5',
                                    border: '1px solid color-mix(in srgb, #6366f1 38%, transparent)'
                                  }}
                                  title="Envia esta conversa para outro utilizador ligado ao mesmo workspace."
                                  onClick={() => {
                                    setTransferTargetUid('');
                                    setInboxTransferOpen(true);
                                  }}
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" aria-hidden />
                                  Transferir
                                </button>
                                <button
                                  type="button"
                                  disabled={inboxActionBusy}
                                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-opacity disabled:opacity-50"
                                  style={{
                                    background: 'color-mix(in srgb, #64748b 14%, transparent)',
                                    color: 'var(--wa-text-2)',
                                    border: '1px solid var(--wa-divider)'
                                  }}
                                  title="Opcionalmente preencher uma rápida pesquisa de satisfação antes de libertar para a equipa."
                                  onClick={() => {
                                    setInboxSurveyRating(null);
                                    setInboxSurveyComment('');
                                    setSendClientSurveyToClient(true);
                                    setInboxSurveyOpen(true);
                                  }}
                                >
                                  Finalizar libertação…
                                </button>
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-3 relative" ref={chatMenuRef}>
                <button
                  type="button"
                  className="p-2.5 rounded-xl text-slate-500 hover:text-[var(--brand-600)] dark:text-slate-400 dark:hover:text-[var(--brand-400)] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => setShowChatSearch(!showChatSearch)}
                  title="Buscar mensagens"
                  aria-label="Buscar mensagens"
                >
                  <Search className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  className="p-2.5 rounded-xl text-slate-500 hover:text-[var(--brand-600)] dark:text-slate-400 dark:hover:text-[var(--brand-400)] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => setShowChatMenu((v) => !v)}
                  title="Mais opções"
                  aria-label="Mais opções"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
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
                      {(isTeamMember || isWorkspaceOwner) && !isSelectedDraft && selectedConversation?.id && (
                        <ChatMenuItem
                          icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
                          label="Transferir para outro funcionário"
                          onClick={() => {
                            const claimed = selectedConversation.inboxClaimedByAuthUid;
                            if (!claimed) {
                              toast.error('Assuma o atendimento primeiro; depois use Transferir.', { duration: 5000 });
                              setShowChatMenu(false);
                              return;
                            }
                            if (!isWorkspaceOwner && claimed !== workspaceAuthUid) {
                              toast.error('Só quem assumiu ou o responsável pode transferir.');
                              setShowChatMenu(false);
                              return;
                            }
                            setTransferTargetUid('');
                            setInboxTransferOpen(true);
                            setShowChatMenu(false);
                          }}
                        />
                      )}
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
                          const cur = historyRequestedRef.current.get(selectedConversation.id) || 100;
                          const n = selectedConversation.messages?.length || 0;
                          const limit = Math.min(10000, Math.max(cur + 200, n + 100));
                          historyRequestedRef.current.set(selectedConversation.id, limit);
                          setHistoryLoading(selectedConversation.id);
                          void loadChatHistory(selectedConversation.id, limit, false).then(() =>
                            setHistoryLoading((prev) => (prev === selectedConversation.id ? null : prev))
                          );
                          setShowChatMenu(false);
                          toast.success('Buscando mensagens…');
                        }}
                      />
                    </div>
                  )}
              </div>
            </div>

            {showChatSearch && (
              <div
                className="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 z-10"
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
              className="wa-chat-wallpaper flex-1 overflow-y-auto px-4 lg:px-10 py-4 relative"
            >
              {/* Banner especial: conversa nova sem histórico (rascunho local). */}
              {isSelectedDraft && (
                <div className="flex justify-center mb-4">
                  <div
                    className="text-[12.5px] px-4 py-3 rounded-2xl inline-flex items-center gap-3 shadow-md max-w-[92%]"
                    style={{
                      background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))',
                      color: 'var(--text-1)',
                      border: '1px solid rgba(16,185,129,0.4)',
                      backdropFilter: 'blur(8px)'
                    }}
                  >
                    <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                      <MessageCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span>
                      Nova conversa com <strong className="font-black text-slate-900 dark:text-white">{selectedDisplay?.primary ?? selectedConversation?.contactName}</strong>. Envie a primeira mensagem abaixo — ela será criada no WhatsApp ao enviar.
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

              <div className="space-y-0">
                {selectedConversation.messages.map((msg, idx) => {
                  const isMe = msg.sender === 'me';
                  const prevMsg = selectedConversation.messages[idx - 1];
                  const showTail = !prevMsg || prevMsg.sender !== msg.sender;

                  // Horário sempre hh:mm na bolha (nunca "Ontem" ou "dd/mm")
                  const bubbleTime = msg.timestampMs && msg.timestampMs > 0
                    ? new Date(msg.timestampMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    : msg.timestamp || '';

                  // Separador de data: "Hoje", "Ontem" ou "dd/mm/aaaa"
                  const msgDate = msg.timestampMs ? new Date(msg.timestampMs) : null;
                  const prevDate = prevMsg?.timestampMs ? new Date(prevMsg.timestampMs) : null;
                  const showDateSep = msgDate && (!prevDate || msgDate.toDateString() !== prevDate.toDateString());
                  const today = new Date();
                  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                  const dateSepLabel = showDateSep
                    ? msgDate.toDateString() === today.toDateString()
                      ? 'Hoje'
                      : msgDate.toDateString() === yesterday.toDateString()
                        ? 'Ontem'
                        : msgDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : null;

                  return (
                    <div key={msg.id}>
                      {dateSepLabel && (
                        <div className="flex justify-center my-3">
                          <span
                            className="text-[11px] px-3 py-1 rounded-full shadow-sm select-none"
                            style={{ background: 'var(--surface-1)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }}
                          >
                            {dateSepLabel}
                          </span>
                        </div>
                      )}
                      <div className={showTail ? 'mt-2' : ''}>
                        <WaBubble
                          side={isMe ? 'out' : 'in'}
                          showTail={showTail}
                          status={isMe ? msg.status : undefined}
                          time={bubbleTime}
                        >
                          {renderMessageContent(msg)}
                        </WaBubble>
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
                className="flex items-stretch flex-shrink-0 min-h-[48px]"
                style={{ background: 'var(--surface-0)', borderTop: '1px solid var(--border-subtle)' }}
              >
                <div className="flex gap-2 px-4 py-2 overflow-x-auto flex-1 min-w-0 items-center">
                  {quickReplies.map((qr, i) => (
                    <button
                      key={`${i}-${qr.text.slice(0, 24)}`}
                      type="button"
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
                      <span aria-hidden>{qr.emoji}</span>
                      <span>{qr.text}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={openQuickRepliesEditor}
                  className="shrink-0 px-3 flex items-center justify-center transition-colors hover:opacity-90"
                  style={{
                    borderLeft: '1px solid var(--border-subtle)',
                    color: 'var(--text-2)',
                    background: 'var(--surface-1)'
                  }}
                  title="Editar mensagens rápidas"
                  aria-label="Editar mensagens rápidas"
                >
                  <Pencil className="w-[18px] h-[18px]" />
                </button>
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

            {/*
              ============================ PREVIEW DE MIDIA ============================
              Aparece quando o usuario seleciona um arquivo. Mostra a previa,
              campo de legenda opcional e botoes Cancelar / Enviar. So depois
              do clique em Enviar e que a midia vai pelo socket.
            */}
            {pendingMediaFile && (
              <div
                className="flex-shrink-0 px-3 py-3 border-t"
                style={{
                  background: 'var(--wa-panel)',
                  borderColor: 'var(--wa-divider)'
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="rounded-lg overflow-hidden flex items-center justify-center shrink-0"
                    style={{
                      width: 96,
                      height: 96,
                      background: 'var(--wa-search)',
                      border: '1px solid var(--wa-divider)'
                    }}
                  >
                    {pendingMediaFile.type.startsWith('image/') && pendingMediaPreviewUrl ? (
                      <img
                        src={pendingMediaPreviewUrl}
                        alt="Pre-visualizacao"
                        className="w-full h-full object-cover"
                      />
                    ) : pendingMediaFile.type.startsWith('video/') && pendingMediaPreviewUrl ? (
                      <video
                        src={pendingMediaPreviewUrl}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                      />
                    ) : pendingMediaFile.type.startsWith('image/') ? (
                      <ImageIcon className="w-10 h-10" style={{ color: 'var(--wa-text-3)' }} />
                    ) : pendingMediaFile.type.startsWith('video/') ? (
                      <Film className="w-10 h-10" style={{ color: 'var(--wa-text-3)' }} />
                    ) : (
                      <FileText className="w-10 h-10" style={{ color: 'var(--wa-text-3)' }} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <p
                          className="text-[13px] font-semibold truncate"
                          style={{ color: 'var(--wa-text)' }}
                          title={pendingMediaFile.name}
                        >
                          {pendingMediaFile.name}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--wa-text-3)' }}>
                          {(pendingMediaFile.size / (1024 * 1024)).toFixed(2)} MB ·{' '}
                          {pendingMediaFile.type || 'arquivo'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={cancelPendingMedia}
                        disabled={sendingMedia}
                        className="wa-icon-btn shrink-0"
                        title="Cancelar envio"
                        aria-label="Cancelar"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <input
                      ref={pendingCaptionRef}
                      type="text"
                      value={pendingMediaCaption}
                      onChange={(e) => setPendingMediaCaption(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') cancelPendingMedia();
                        if (e.key === 'Enter' && !e.shiftKey && !sendingMedia) {
                          e.preventDefault();
                          void confirmAndSendPendingMedia();
                        }
                      }}
                      placeholder="Adicione uma legenda (opcional)"
                      disabled={sendingMedia}
                      className="wa-composer-input"
                      aria-label="Legenda da midia"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void confirmAndSendPendingMedia()}
                    disabled={sendingMedia}
                    className="wa-composer-send shrink-0 self-end"
                    data-mode="send"
                    title="Enviar arquivo"
                    aria-label="Enviar"
                    style={{
                      opacity: sendingMedia ? 0.6 : 1,
                      cursor: sendingMedia ? 'wait' : 'pointer'
                    }}
                  >
                    {sendingMedia ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </button>
                </div>
                {sendingMedia && (
                  <MediaUploadProgressBar
                    uploadStage={uploadStage}
                    uploadProgress={uploadProgress}
                    uploadElapsedSec={uploadElapsedSec}
                  />
                )}
              </div>
            )}

            <div className="flex items-center gap-1.5 sm:gap-2 px-3 py-3 flex-shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 z-10">
              <button
                type="button"
                onClick={() => {
                  setShowEmojiPicker(!showEmojiPicker);
                  setShowQuickReplies(false);
                }}
                className={`p-2.5 rounded-xl transition-colors ${showEmojiPicker ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[var(--brand-600)] dark:hover:text-[var(--brand-400)]'}`}
                title="Emojis"
                aria-label="Inserir emoji"
              >
                <Smile className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowQuickReplies(!showQuickReplies);
                  setShowEmojiPicker(false);
                }}
                className={`p-2.5 rounded-xl transition-colors ${showQuickReplies ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[var(--brand-600)] dark:hover:text-[var(--brand-400)]'}`}
                title="Respostas rápidas"
                aria-label="Respostas rápidas"
              >
                <MessageCircle className="w-6 h-6" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,application/*"
                onChange={(e) => handleFileSelected(e.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[var(--brand-600)] dark:hover:text-[var(--brand-400)] transition-colors"
                title="Anexar arquivo"
                aria-label="Anexar arquivo"
              >
                {sendingMedia ? <Loader2 className="w-6 h-6 animate-spin" /> : <Paperclip className="w-6 h-6" />}
              </button>
              {(uploadStage === 'reading' || uploadStage === 'uploading' || uploadStage === 'sending') && (
                <MediaUploadProgressBar
                  dense
                  uploadStage={uploadStage}
                  uploadProgress={uploadProgress}
                  uploadElapsedSec={uploadElapsedSec}
                />
              )}
              {uploadProgress === null && uploadStatus === 'success' && (
                <span
                  className="text-[10.5px] font-semibold px-2 py-1 rounded-md"
                  style={{ background: 'rgba(0,168,132,0.16)', color: 'var(--wa-green-strong)' }}
                >
                  Enviado
                </span>
              )}
              {uploadProgress === null && uploadStatus === 'error' && (
                <button
                  type="button"
                  onClick={() => {
                    if (!lastFailedFile) return;
                    // Reabre o preview para revisar e tentar de novo
                    if (pendingMediaPreviewUrl) URL.revokeObjectURL(pendingMediaPreviewUrl);
                    setPendingMediaFile(lastFailedFile);
                    setPendingMediaPreviewUrl(URL.createObjectURL(lastFailedFile));
                    setPendingMediaCaption('');
                    setUploadStatus('idle');
                  }}
                  className="text-[10.5px] font-semibold px-2 py-1 rounded-md transition-colors"
                  style={{ background: 'rgba(239,68,68,0.14)', color: '#dc2626' }}
                  title="Tentar enviar novamente"
                >
                  Falha no envio • Tentar novamente
                </button>
              )}

              <form onSubmit={handleSendMessage} className="flex items-center gap-3 flex-1 min-w-0">
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
                    className="py-2.5 px-3 rounded-xl text-sm font-semibold outline-none border transition-colors shadow-sm min-w-[140px]"
                    style={{
                      background: 'var(--surface-0)',
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
                <div className="relative flex-1 min-w-0 flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-[var(--brand-500)]/30 focus-within:border-[var(--brand-500)]/50 transition-all px-1">
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
                    placeholder="Digite uma mensagem"
                    className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-slate-100 text-[15px] px-4 py-3 placeholder:text-slate-400"
                    aria-label="Mensagem"
                  />
                  <div className="flex items-center pr-2 gap-1">
                    {/* Add extra action buttons inside the input container for a modern look */}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!canSendCurrent}
                  className={`flex items-center justify-center w-12 h-12 rounded-2xl transition-all shadow-md shrink-0 ${
                    inputText.trim() 
                      ? 'bg-[var(--brand-500)] text-white hover:brightness-110 active:scale-95 hover:shadow-[var(--brand-500)]/30' 
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                  data-mode={inputText.trim() ? 'send' : 'mic'}
                  title={isSelectedDraft && !selectedDraftChannelId ? 'Escolha um canal para enviar' : inputText.trim() ? 'Enviar' : 'Microfone'}
                  style={!canSendCurrent ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                >
                  {inputText.trim() ? <Send className="w-5 h-5 ml-1" /> : <Mic className="w-[22px] h-[22px]" />}
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

      {selectedConversation && (
        <WaContactDrawer
          open={showContactInfo}
          title="Ficha do cliente"
          subtitle={selectedDisplay?.primary ?? selectedConversation.contactName}
          onClose={() => setShowContactInfo(false)}
        >
          <ClientCrmPanel
            conversation={selectedConversation}
            connectionName={selectedConnection?.name}
            avatar={getConvAvatar(selectedConversation)}
            crmData={crm.get(selectedConversation.id)}
            pipelineAgg={pipelineAgg}
            onClose={() => setShowContactInfo(false)}
            onUpdate={(patch) => crm.update(selectedConversation.id, patch)}
            onClear={() => crm.clear(selectedConversation.id)}
          />
        </WaContactDrawer>
      )}

      <Modal
        isOpen={quickRepliesEditorOpen}
        onClose={() => setQuickRepliesEditorOpen(false)}
        title="Mensagens rápidas"
        subtitle={`Edite os atalhos do chat (até ${CHAT_QUICK_REPLIES_MAX_ITEMS} mensagens). São guardadas neste navegador.`}
        icon={<Pencil className="w-5 h-5" />}
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2 w-full">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setQuickRepliesDraft(cloneDefaultChatQuickReplies())}
            >
              Restaurar padrões
            </Button>
            <Button type="button" variant="ghost" onClick={() => setQuickRepliesEditorOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" onClick={saveQuickRepliesFromDraft}>
              Guardar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
            Emoji à esquerda (opcional) e texto da mensagem. Ao tocar num botão rápido, o texto vai para o campo de envio.
          </p>
          <div className="space-y-2">
            {quickRepliesDraft.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  size="sm"
                  maxLength={16}
                  value={row.emoji}
                  onChange={(e) =>
                    setQuickRepliesDraft((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, emoji: e.target.value } : r))
                    )
                  }
                  placeholder="👋"
                  className="w-[4.5rem] shrink-0 text-center"
                  aria-label={`Emoji da mensagem ${i + 1}`}
                />
                <Input
                  size="sm"
                  maxLength={CHAT_QUICK_REPLY_TEXT_MAX}
                  value={row.text}
                  onChange={(e) =>
                    setQuickRepliesDraft((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, text: e.target.value } : r))
                    )
                  }
                  placeholder="Texto da mensagem"
                  className="flex-1 min-w-[160px]"
                  aria-label={`Texto da mensagem ${i + 1}`}
                />
                <button
                  type="button"
                  disabled={quickRepliesDraft.length <= 1}
                  onClick={() =>
                    setQuickRepliesDraft((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))
                  }
                  className="p-2 rounded-lg transition-colors disabled:opacity-35 shrink-0"
                  style={{ color: 'var(--text-2)' }}
                  title={quickRepliesDraft.length <= 1 ? 'Mantenha pelo menos uma mensagem' : 'Remover linha'}
                  aria-label={`Remover mensagem rápida ${i + 1}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          {quickRepliesDraft.length < CHAT_QUICK_REPLIES_MAX_ITEMS && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setQuickRepliesDraft((prev) =>
                  prev.length >= CHAT_QUICK_REPLIES_MAX_ITEMS
                    ? prev
                    : [...prev, { emoji: '💬', text: '' }]
                )
              }
            >
              + Adicionar mensagem
            </Button>
          )}
        </div>
      </Modal>

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
                const auditTitles = getConversationDisplay(c);
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
                      src={getConvAvatar(c)}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                        {auditTitles.primary}
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

      <Modal
        isOpen={inboxSurveyOpen}
        onClose={() => {
          if (!inboxActionBusy) setInboxSurveyOpen(false);
        }}
        title="Finalizar libertação"
        subtitle="Opcional: nota interna para a sua conta. Pode enviar ao mesmo tempo um link ao cliente no WhatsApp (caixa abaixo)."
        icon={<Star className="w-5 h-5" />}
        size="sm"
        footer={
          <div className="flex flex-wrap gap-2 justify-end w-full">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={inboxActionBusy}
              onClick={() => setInboxSurveyOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={inboxActionBusy}
              onClick={() => {
                void (async () => {
                  if (!selectedChatId) return;
                  setInboxActionBusy(true);
                  try {
                    const res = await inboxWorkspacePostFinish({
                      conversationId: selectedChatId,
                      skipSurvey: true,
                      sendClientSurvey: sendClientSurveyToClient
                    });
                    setInboxSurveyOpen(false);
                    toast.success('Conversa libertada para a equipa.');
                    if (selectedChatId) patchConversationInboxClaim(selectedChatId, undefined);
                    socket?.emit('request-conversations-sync');
                    if (sendClientSurveyToClient) {
                      if (res.clientSurveySent) toast.success('Mensagem com link de avaliação enviada ao cliente.');
                      else if (res.clientSurveyError) toast(res.clientSurveyError, { icon: '⚠️', duration: 6000 });
                    }
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Falha ao libertar.');
                  } finally {
                    setInboxActionBusy(false);
                  }
                })();
              }}
            >
              Libertar sem pesquisa
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={inboxActionBusy}
              onClick={() => {
                void (async () => {
                  if (!selectedChatId) return;
                  setInboxActionBusy(true);
                  try {
                    const res = await inboxWorkspacePostFinish({
                      conversationId: selectedChatId,
                      skipSurvey: false,
                      rating: inboxSurveyRating ?? undefined,
                      comment: inboxSurveyComment.trim() || undefined,
                      sendClientSurvey: sendClientSurveyToClient
                    });
                    setInboxSurveyOpen(false);
                    toast.success('Avaliação guardada e conversa libertada.');
                    if (selectedChatId) patchConversationInboxClaim(selectedChatId, undefined);
                    socket?.emit('request-conversations-sync');
                    if (sendClientSurveyToClient) {
                      if (res.clientSurveySent) toast.success('Mensagem com link de avaliação enviada ao cliente.');
                      else if (res.clientSurveyError) toast(res.clientSurveyError, { icon: '⚠️', duration: 6000 });
                    }
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Falha ao finalizar.');
                  } finally {
                    setInboxActionBusy(false);
                  }
                })();
              }}
            >
              Guardar e libertar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="text-[11.5px] font-medium mb-2" style={{ color: 'var(--text-2)' }}>
              Nota de 1 a 5 (opcional)
            </p>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="p-1.5 rounded-lg transition-opacity"
                  style={{
                    background:
                      inboxSurveyRating != null && n <= inboxSurveyRating
                        ? 'rgba(245,158,11,0.25)'
                        : 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)',
                    color: inboxSurveyRating != null && n <= inboxSurveyRating ? '#d97706' : 'var(--text-3)'
                  }}
                  title={`${n} estrelas`}
                  onClick={() => setInboxSurveyRating(n)}
                >
                  <Star
                    className={`w-5 h-5 ${inboxSurveyRating != null && n <= inboxSurveyRating ? 'fill-current' : ''}`}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11.5px] font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
              Comentário (opcional)
            </label>
            <Textarea
              value={inboxSurveyComment}
              onChange={(e) => setInboxSurveyComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Ex.: cliente satisfeito, pediu orçamento…"
              className="w-full text-[13px]"
            />
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer select-none text-[12.5px] leading-snug" style={{ color: 'var(--text-2)' }}>
            <input
              type="checkbox"
              className="mt-0.5 rounded border flex-shrink-0"
              style={{ borderColor: 'var(--border)' }}
              checked={sendClientSurveyToClient}
              onChange={(e) => setSendClientSurveyToClient(e.target.checked)}
              disabled={inboxActionBusy}
            />
            <span>Enviar ao cliente no WhatsApp um link para avaliar este atendimento (página rápida, sem login).</span>
          </label>
        </div>
      </Modal>

      <Modal
        isOpen={inboxTransferOpen}
        onClose={() => {
          if (!inboxActionBusy) setInboxTransferOpen(false);
        }}
        title="Transferir atendimento"
        subtitle="A conversa fica assumida pelo utilizador escolhido (mesmo workspace)."
        icon={<ArrowRightLeft className="w-5 h-5" />}
        size="sm"
        footer={
          <div className="flex flex-wrap gap-2 justify-end w-full">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={inboxActionBusy}
              onClick={() => setInboxTransferOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={inboxActionBusy || !transferTargetUid.trim()}
              onClick={() => {
                void (async () => {
                  const id = selectedChatId;
                  const tgt = transferTargetUid.trim();
                  if (!id || !tgt) return;
                  setInboxActionBusy(true);
                  try {
                    await inboxWorkspaceApi('/api/workspace/inbox-transfer', {
                      method: 'POST',
                      body: JSON.stringify({ conversationId: id, targetAuthUid: tgt })
                    });
                    setInboxTransferOpen(false);
                    if (isWorkspaceOwner) patchConversationInboxClaim(id, tgt);
                    else patchConversationInboxClaim(id, undefined);
                    socket?.emit('request-conversations-sync');
                    toast.success('Atendimento transferido.');
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Falha ao transferir.');
                  } finally {
                    setInboxActionBusy(false);
                  }
                })();
              }}
            >
              Transferir
            </Button>
          </div>
        }
      >
        {inboxTeammatesLoad ? (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            A carregar equipa…
          </div>
        ) : inboxTeammates.filter((t) => t.uid !== workspaceAuthUid).length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
            Não há outros membros ligados ao workspace para receber esta conversa (convite em Definições).
          </p>
        ) : (
          <Select
            value={transferTargetUid}
            onChange={(e) => setTransferTargetUid(e.target.value)}
            className="w-full text-[13px]"
            aria-label="Destinatário da transferência"
          >
            <option value="">Escolha quem recebe…</option>
            {inboxTeammates
              .filter((t) => t.uid !== workspaceAuthUid)
              .map((t) => (
                <option key={t.uid} value={t.uid}>
                  {t.role === 'owner' ? 'Responsável · ' : ''}
                  {t.displayName || t.email || `${t.uid.slice(0, 6)}…${t.uid.slice(-4)}`}
                </option>
              ))}
          </Select>
        )}
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
