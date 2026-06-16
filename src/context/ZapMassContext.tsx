import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
  useRef,
  startTransition
} from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import {
  WhatsAppConnection, 
  ConnectionStatus, 
  CampaignStatus,
  Campaign, 
  CampaignReplyFlow,
  CampaignScheduleSlot,
  DashboardMetrics, 
  ZapMassContextType,
  BirthdayContact,
  Conversation,
  ContactList,
  Contact,
  ReligiousMemberProfile,
  SystemLog,
  WarmupItem,
  SystemMetrics,
  FunnelStats,
  WarmupChipStats,
  CampaignGeoState,
  CampaignGeoUfStats
} from '../types';
import { useAuth } from './AuthContext';
import type { SessionUser } from '../types/sessionUser';
import {
  apiBulkCreateContacts,
  apiBulkUpdateContacts,
  apiClearTenantContactsData,
  apiCreateContact,
  apiCreateContactList,
  apiDeleteContact,
  apiDeleteContactList,
  apiUpdateContact,
  apiAppendContactIdsToList,
  apiUpdateContactList,
  fetchContactLists,
  fetchContacts,
  fetchContactsCount
} from '../services/contactsApi';
import { applyAddressNormalizationToContact } from '../utils/contactAddressNormalize';
import {
  apiCreateCampaign,
  apiBulkDeleteCampaigns,
  apiDeleteAllCampaigns,
  apiDeleteCampaign,
  apiUpdateCampaign,
  fetchCampaigns
} from '../services/campaignsApi';
import { getSessionIdToken } from '../utils/sessionAuth';
import { useWorkspace } from './WorkspaceContext';
import { filterByConnectionScope, ownsConnectionForUid } from '../utils/connectionScope';
import {
  mergeConnectionStatus,
  mergeWhatsAppConnectionLists
} from '../utils/connectionStateMerge';
import { apiUrl, getSocketIoOrigin, isLikelySplitStaticFrontend } from '../utils/apiBase';
import { MAX_CHANNELS_TOTAL } from '../utils/connectionLimitPolicy';
import { openChannelExtraPurchaseFlow } from '../utils/openChannelExtraFlow';
import {
  getCampaignPlannedSendTotal,
  getCampaignProgressMetrics,
  healStuckRunningCampaignsList,
  isCampaignLikelyStartedOnServer,
  isRunningStatusButWorkComplete
} from '../utils/campaignMetrics';
import { isConversationalMultiStepCampaign } from '../utils/campaignStageCount';
import { computeNextRunIso, localDateTimeToUtcIso } from '../utils/campaignSchedule';
import { parseFirestoreDateToIso } from '../utils/followUp';
import {
  resetCampaignRecipientErrorBurst,
  scheduleCampaignRecipientErrorDigest,
  type CampaignErrorBurstState
} from '../utils/campaignIssueToast';
import { normPhoneKey } from '../utils/brPhoneNormalize';
import { getCampaignStageTotal } from '../utils/campaignStageCount';
import {
  dedupeConversationsById,
  mergeConversationDelta,
  mergeConversationsFromSocketUpdate
} from '../utils/conversationInboxTrim';
import { devLog, devWarn, warnProd } from '../utils/logger';

async function yieldToUiThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/** Mensagem quando o ACK da campanha ultrapassa o tempo — o servidor pode já ter iniciado mesmo assim. */
const START_CAMPAIGN_ACK_TIMEOUT_MESSAGE =
  'Demoramos a confirmar no servidor; a campanha pode já ter iniciado — veja a lista de campanhas antes de repetir o disparo.';

const START_CAMPAIGN_SERVER_POLL_MS = 2_000;
const START_CAMPAIGN_SERVER_POLL_MAX_MS = 30_000;

async function sleepMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function confirmCampaignStartedViaApi(
  campaignId: string,
  maxMs: number = START_CAMPAIGN_SERVER_POLL_MAX_MS
): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const list = await fetchCampaigns();
      const hit = list.find((c) => c.id === campaignId);
      if (isCampaignLikelyStartedOnServer(hit)) return true;
    } catch {
      /* próxima tentativa */
    }
    await sleepMs(START_CAMPAIGN_SERVER_POLL_MS);
  }
  return false;
}

/**
 * Tempo máximo até ack da campanha (campaign-started / campaign-error / callback).
 * O servidor agora só responde DEPOIS de checar conexões, pingar Redis e enfileirar.
 * Isso é mais robusto mas exige timeout maior que o antigo "callback imediato".
 * Estimativa: 5s (chip check) + 2s (Redis ping) + 3s (enfileirar) = ~10s base.
 */
function startCampaignAckTimeoutMs(
  media?: { dataBase64?: string },
  connectionIdsCount: number = 1
): number {
  const b64 = media?.dataBase64;
  if (b64) {
    const approxBytes = (b64.length * 3) / 4;
    if (approxBytes < 50_000) return 60_000;
    const ms = 50_000 + (approxBytes / 100_000) * 1_000;
    return Math.min(900_000, Math.max(120_000, Math.ceil(ms)));
  }
  // Base 30s + 3s por chip (verificação de conexão pode demorar por chip)
  const n = Math.max(1, Math.min(24, Number(connectionIdsCount) || 1));
  return Math.min(75_000, 30_000 + n * 3_000);
}

const INITIAL_METRICS: DashboardMetrics = {
  totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0
};

const INITIAL_FUNNEL: FunnelStats = {
  totalSent: 0,
  totalDelivered: 0,
  totalRead: 0,
  totalReplied: 0,
  updatedAt: 0,
  sentByDay: {},
  deliveredByDay: {},
  readByDay: {},
  repliedByDay: {},
  sentByDayByCampaign: {}
};

const INITIAL_CAMPAIGN_GEO: CampaignGeoState = {
  campaignId: null,
  byUf: {},
  updatedAt: 0
};

// Extender o tipo para incluir o socket e métricas de sistema
interface ZapMassContextWithSocket extends ZapMassContextType {
  socket: Socket | null;
  warmupActive: boolean;
  startWarmupTimer: (intervalMinutes: number, runRound: () => void) => void;
  stopWarmupTimer: () => void;
  startAutoWarmup: (connectionIds: string[], intervalMinutes: number) => void;
  stopAutoWarmup: () => void;
}

const INITIAL_SYS_METRICS: SystemMetrics = { cpu: 0, ram: 0, uptime: '0m', latency: 0 };

/** Estado visual do link com o servidor — evita piscar Offline/Online em quedas curtas. */
export type BackendLinkState = 'online' | 'reconnecting' | 'offline';

/** Tempo sem socket antes de mostrar “Offline” na UI (quedas < isto ficam em “Reconectando”). */
const BACKEND_OFFLINE_UI_GRACE_MS = 12_000;

/** Snapshot enxuto para shell (TopBar, Sidebar, banners): não herda atualizações de `conversations`. */
export type ZapMassUiSnapshot = {
  isBackendConnected: boolean;
  backendLinkState: BackendLinkState;
  systemMetrics: SystemMetrics;
  sessionLiveStats: {
    workersAlive: number;
    inFlight: number;
    waiting: number;
    maxConcurrent: number;
    pendingAssignments: number;
    busRemote: boolean;
  } | null;
};

function sessionLiveStatsEqual(
  a: NonNullable<ZapMassUiSnapshot['sessionLiveStats']>,
  b: NonNullable<ZapMassUiSnapshot['sessionLiveStats']>
): boolean {
  return (
    a.workersAlive === b.workersAlive &&
    a.pendingAssignments === b.pendingAssignments &&
    a.inFlight === b.inFlight &&
    a.waiting === b.waiting &&
    a.maxConcurrent === b.maxConcurrent &&
    a.busRemote === b.busRemote
  );
}

function mergedSystemMetricsUnchanged(prev: SystemMetrics, patch: Partial<SystemMetrics>): boolean {
  const next = { ...prev, ...patch };
  return (
    prev.cpu === next.cpu &&
    prev.ram === next.ram &&
    prev.uptime === next.uptime &&
    (prev.latency ?? 0) === (next.latency ?? 0) &&
    (prev.ramTotalGb ?? 0) === (next.ramTotalGb ?? 0) &&
    (prev.ramFreeGb ?? 0) === (next.ramFreeGb ?? 0) &&
    (prev.ramUsedGb ?? 0) === (next.ramUsedGb ?? 0) &&
    (prev.platform || '') === (next.platform || '')
  );
}

function connectionListHasStaleConnecting(list: WhatsAppConnection[]): boolean {
  return list.some(
    (c) =>
      (c.status === ConnectionStatus.CONNECTING || c.status === ConnectionStatus.QR_READY) &&
      !c.qrCode
  );
}

const CONTACTS_PAGE_SIZE = 10_000;

/** Postgres já retorna ORDER BY sort_name — só anexa sem reordenar (evita O(n log n) a cada página). */
function appendContactsPage(prev: Contact[], batch: Contact[]): Contact[] {
  if (batch.length === 0) return prev;
  const seen = new Set(prev.map((c) => c.id));
  const out = prev.slice();
  for (const c of batch) {
    if (!seen.has(c.id)) {
      out.push(c);
      seen.add(c.id);
    }
  }
  return out;
}

const ZapMassUiSnapshotContext = createContext<ZapMassUiSnapshot | null>(null);

const ZapMassConnectionsSliceContext = createContext<{ connections: WhatsAppConnection[] } | null>(
  null
);

const EMPTY_CONTEXT: ZapMassContextWithSocket = {
  socket: null,
  connections: [],
  contacts: [],
  contactsHasMore: false,
  contactsLoadingMore: false,
  loadMoreContacts: async () => {},
  loadAllContacts: async () => {},
  contactsSavedTotal: null,
  contactsSavedTotalLoading: false,
  refreshContactsSavedTotal: async () => {},
  refreshContacts: async () => {},
  contactLists: [],
  campaigns: [],
  metrics: INITIAL_METRICS,
  birthdays: [],
  conversations: [],
  inboxHasMore: false,
  inboxLoadingMore: false,
  inboxTotal: 0,
  loadMoreInbox: async () => {},
  systemLogs: [],
  warmupQueue: [],
  warmedCount: 0,
  isBackendConnected: false,
  sessionLiveStats: null,
  campaignStatus: { isRunning: false, total: 0, processed: 0, success: 0, failed: 0 },
  addConnection: async () => {},
  setConnectionProxy: async () => {},
  removeConnection: () => {},
  updateConnectionStatus: () => {},
  reconnectConnection: async () => {},
  forceQr: async () => {},
  renameConnection: async () => {},
  updateConnectionSettings: async () => {},
  addContact: async () => {},
  bulkAddContacts: async () => [],
  removeContact: async () => {},
  updateContact: async () => {},
  bulkUpdateContacts: async () => {},
  createContactList: async () => '',
  appendContactIdsToContactList: async () => {},
  deleteContactList: async () => {},
  updateContactList: async () => {},
  sendMessage: () => {},
  sendMedia: async () => ({ ok: false, error: 'Sem conexao com servidor.' }),
  markAsRead: () => {},
  fetchConversationPicture: () => {},
  deleteLocalConversations: async () => 0,
  loadChatHistory: async () => ({ ok: false, total: 0 }),
  hydrateFirestoreChatArchive: async () => ({ ok: false, total: 0 }),
  loadMessageMedia: async () => ({ ok: false }),
  markWarmupReady: () => {},
  pauseCampaign: () => {},
  resumeCampaign: () => {},
  deleteCampaign: async () => {},
  deleteCampaigns: async () => {},
  startCampaign: async () => '',
  scheduleCampaign: async () => '',
  funnelStats: INITIAL_FUNNEL,
  clearFunnelStats: () => {},
  campaignGeo: INITIAL_CAMPAIGN_GEO,
  warmupChipStats: {},
  clearWarmupChipStats: () => {},
  clearAllUserData: async () => ({ contacts: 0, contactLists: 0, campaigns: 0, campaignLogs: 0, errors: 0 }),
  warmupActive: false,
  startWarmupTimer: () => {},
  stopWarmupTimer: () => {},
  startAutoWarmup: () => {},
  stopAutoWarmup: () => {},
  patchConversationInboxClaim: () => {},
  circuitBreakerOpenConnectionIds: []
};

export type ZapMassCoreContextValue = Omit<ZapMassContextWithSocket, 'conversations'>;

const EMPTY_CORE: ZapMassCoreContextValue = (() => {
  const { conversations: _omitConv, ...core } = EMPTY_CONTEXT;
  return core;
})();

export type ZapMassConversationsSlice = {
  conversations: Conversation[];
  inboxHasMore: boolean;
  inboxLoadingMore: boolean;
  inboxTotal: number;
  loadMoreInbox: () => void;
};

const ZAP_MASS_CONVERSATIONS_DEFAULT: ZapMassConversationsSlice = {
  conversations: [],
  inboxHasMore: false,
  inboxLoadingMore: false,
  inboxTotal: 0,
  loadMoreInbox: () => {},
};
const ZapMassConversationsContext = createContext(ZAP_MASS_CONVERSATIONS_DEFAULT);

const ZapMassCoreContext = createContext<ZapMassCoreContextValue>(EMPTY_CORE);
/** Socket isolado — AppShell/banners não re-renderizam quando `contacts` muda. */
const ZapMassSocketContext = createContext<Socket | null>(null);
function isCampaignApiDeleteRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /404|não encontrada|not found|inválido/i.test(msg);
}

async function purgeCampaignForUser(_uid: string, campaignId: string): Promise<void> {
  try {
    await apiDeleteCampaign(campaignId);
  } catch (apiErr) {
    if (!isCampaignApiDeleteRetryable(apiErr)) throw apiErr;
  }
}

/** Referência estável: o corpo da função actualiza-se a cada render sem invalidar `useMemo` do Provider. */
function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const r = useRef(fn);
  r.current = fn;
  return useCallback(((...a: Parameters<T>) => r.current(...a)) as T, []);
}

export const ZapMassProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user: sessionUser } = useAuth();
  const { effectiveWorkspaceUid, loading: workspaceLoading } = useWorkspace();
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>(INITIAL_METRICS);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsHasMore, setContactsHasMore] = useState(false);
  const [contactsLoadingMore, setContactsLoadingMore] = useState(false);
  const [contactsSavedTotal, setContactsSavedTotal] = useState<number | null>(null);
  const [contactsSavedTotalLoading, setContactsSavedTotalLoading] = useState(false);
  const contactsVpsOffsetRef = useRef(0);
  const loadAllContactsInFlightRef = useRef(false);
  const reloadVpsContactsRef = useRef<() => Promise<void>>(async () => {});
  const reloadVpsContactListsRef = useRef<() => Promise<void>>(async () => {});
  const reloadVpsCampaignsRef = useRef<() => Promise<void>>(async () => {});

  const patchCampaignPersist = useCallback((_uid: string, campaignId: string, patch: Record<string, unknown>) => {
    void apiUpdateCampaign(campaignId, patch);
  }, []);

  reloadVpsCampaignsRef.current = async () => {
    const uid = currentUidRef.current;
    if (!uid) return;
    try {
      const list = await fetchCampaigns();
      if (currentUidRef.current !== uid) return;
      setCampaigns(healStuckRunningCampaignsList(list));
    } catch (err) {
      warnProd('[VPS] reload campaigns:', (err as Error)?.message || err);
    }
  };
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const campaignsRef = useRef<Campaign[]>([]);
  /**
   * Buffer de previews de campanha por telefone. Durante um disparo, o evento
   * "Mensagem enviada" chega centenas de vezes; aplicar cada um direto em
   * `contacts` copiava o array de 10k e re-renderizava tudo a cada mensagem.
   * Acumulamos aqui e damos flush agrupado (timer) numa única atualização.
   */
  const campaignPreviewBufferRef = useRef<
    Map<string, { campaignId: string; campaignName: string; totalStages: number; inc: number }>
  >(new Map());
  const campaignPreviewFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushCampaignPreviewBuffer = useCallback(() => {
    if (campaignPreviewFlushTimerRef.current) {
      clearTimeout(campaignPreviewFlushTimerRef.current);
      campaignPreviewFlushTimerRef.current = null;
    }
    const buffer = campaignPreviewBufferRef.current;
    if (buffer.size === 0) return;
    const pending = new Map(buffer);
    buffer.clear();

    setContacts((prev) => {
      // Um único índice telefone→posição por flush, em vez de findIndex por mensagem.
      const idxByPhone = new Map<string, number>();
      for (let i = 0; i < prev.length; i++) {
        const k = normPhoneKey(prev[i].phone);
        if (k && !idxByPhone.has(k)) idxByPhone.set(k, i);
      }
      let next: Contact[] | null = null;
      const at = new Date().toISOString();
      pending.forEach((entry, pkey) => {
        const idx = idxByPhone.get(pkey);
        if (idx == null) return;
        const base = next || prev;
        const row = base[idx];
        const prevP = row.campaignTablePreview;
        const same = prevP?.campaignId === entry.campaignId;
        const sent = (same ? (prevP?.sent ?? 0) : 0) + entry.inc;
        const preview = {
          campaignId: entry.campaignId,
          campaignName: entry.campaignName,
          sent,
          totalStages: entry.totalStages,
          pending: Math.max(0, entry.totalStages - sent),
          updatedAt: at
        };
        void apiUpdateContact(row.id, {
          campaignMessagesReceived: (row.campaignMessagesReceived || 0) + entry.inc,
          campaignTablePreview: preview
        }).catch(() => {});
        if (!next) next = [...prev];
        next[idx] = {
          ...row,
          campaignMessagesReceived: (row.campaignMessagesReceived || 0) + entry.inc,
          campaignTablePreview: preview
        };
      });
      return next || prev;
    });
  }, []);

  const queueCampaignPreview = useCallback(
    (pkey: string, campaignId: string, campaignName: string, totalStages: number) => {
      const buffer = campaignPreviewBufferRef.current;
      const cur = buffer.get(pkey);
      if (cur && cur.campaignId === campaignId) {
        cur.inc += 1;
        cur.totalStages = totalStages;
      } else {
        buffer.set(pkey, { campaignId, campaignName, totalStages, inc: 1 });
      }
      if (!campaignPreviewFlushTimerRef.current) {
        campaignPreviewFlushTimerRef.current = setTimeout(() => {
          flushCampaignPreviewBuffer();
        }, 1200);
      }
    },
    [flushCampaignPreviewBuffer]
  );
  const [birthdays, setBirthdays] = useState<BirthdayContact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [inboxHasMore, setInboxHasMore] = useState(false);
  const [inboxLoadingMore, setInboxLoadingMore] = useState(false);
  const [inboxTotal, setInboxTotal] = useState(0);
  const inboxNextCursorRef = useRef<number | null>(null);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [warmupQueue, setWarmupQueue] = useState<WarmupItem[]>([]);
  const [warmedCount, setWarmedCount] = useState(0);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [backendLinkState, setBackendLinkState] = useState<BackendLinkState>('offline');
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>(INITIAL_SYS_METRICS);
  const [funnelStats, setFunnelStats] = useState<FunnelStats>(INITIAL_FUNNEL);
  const [campaignGeo, setCampaignGeo] = useState<CampaignGeoState>(INITIAL_CAMPAIGN_GEO);
  const [warmupChipStats, setWarmupChipStats] = useState<Record<string, WarmupChipStats>>({});
  const [circuitBreakerOpenIds, setCircuitBreakerOpenIds] = useState<Set<string>>(new Set());
  const [sessionLiveStats, setSessionLiveStats] = useState<{
    workersAlive: number;
    inFlight: number;
    waiting: number;
    maxConcurrent: number;
    pendingAssignments: number;
    busRemote: boolean;
  } | null>(null);
  
  // Warmup: estado mínimo no context — o countdown visual fica só na WarmupTab (evita rerender global 1/s).
  const [warmupActive, setWarmupActive] = useState(false);
  const warmupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startWarmupTimer = (intervalMinutes: number, runRound: () => void) => {
    stopWarmupTimer();
    setWarmupActive(true);
    runRound();
    warmupTimerRef.current = setInterval(runRound, intervalMinutes * 60 * 1000);
  };

  const stopWarmupTimer = () => {
    setWarmupActive(false);
    if (warmupTimerRef.current) clearInterval(warmupTimerRef.current);
    warmupTimerRef.current = null;
  };

  const startAutoWarmup = (connectionIds: string[], intervalMinutes: number) => {
    socketRef.current?.emit('start-auto-warmup', { connectionIds, intervalMinutes });
  };

  const stopAutoWarmup = () => {
    socketRef.current?.emit('stop-auto-warmup');
  };

  // Campaign State
  const [campaignStatus, setCampaignStatus] = useState({
    isRunning: false,
    total: 0,
    processed: 0,
    success: 0,
    failed: 0
  });

  const socketRef = useRef<Socket | null>(null);
  const [socketForShell, setSocketForShell] = useState<Socket | null>(null);
  /** Último payload completo de `conversations-update` pendente até o próximo paint (vários emits no mesmo frame = só o último). */
  const conversationsSocketPendingRef = useRef<Conversation[] | null>(null);
  const conversationsSocketRafRef = useRef<number | null>(null);
  /** Vários `campaign-progress` no mesmo intervalo: um `setCampaigns` por frame (evita travar a aba Campanhas). */
  const campaignProgressSocketPendingRef = useRef<
    Record<string, { processedCount: number; successCount: number; failedCount: number }>
  >({});
  const campaignProgressBarPendingRef = useRef<{
    total: number;
    processed: number;
    successCount: number;
    failCount: number;
  } | null>(null);
  const campaignProgressSocketRafRef = useRef<number | null>(null);
  /** Último flush definido no `useEffect` do socket (desmontagem aplica pendentes sem duplicar lógica). */
  const flushCampaignProgressSocketFromRefsRef = useRef<() => void>(() => {});
  const qrCodeByConnectionId = useRef<Record<string, string>>({});
  const pendingConnectionToastIdRef = useRef<string | null>(null);
  const connectionsRef = useRef<WhatsAppConnection[]>([]);
  const syncConnectionsFromApiRef = useRef<() => Promise<void>>(async () => {});
  const disconnectToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Atraso antes de marcar UI como offline — evita OFFLINE a piscar em quedas < ~3s (sleep da CPU / troca de aba). */
  const offlineBadgeDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasConnectedOnceRef = useRef(false);
  const currentUidRef = useRef<string | null>(sessionUser?.uid ?? null);
  const prevAuthUserRef = useRef<string | null>(sessionUser?.uid ?? null);
  const prevBoundDataUidRef = useRef<string | null>(null);
  const bindUserRef = useRef<(uid: string) => void>(() => {});
  const campaignProgressPersistRef = useRef<Record<string, {
    timer: ReturnType<typeof setTimeout> | null;
    lastWriteAt: number;
    payload: { processedCount: number; successCount: number; failedCount: number };
  }>>({});

  /** Falhas ERROR por número na campanha: digest em vez de toast por entrada. */
  const campaignRecipientErrorBurstRef = useRef<CampaignErrorBurstState>({ count: 0, timer: null });
  /** Evita Rajada de toast em erros repetidos socket / envio único (throttle tempo). */
  const socketOperationErrorToastAtRef = useRef<number>(0);
  const sendMessageErrorToastAtRef = useRef<number>(0);

  const flushCampaignProgressToFirestore = (campaignId: string, force = false) => {
    const entry = campaignProgressPersistRef.current[campaignId];
    const uid = currentUidRef.current;
    if (!entry || !uid) return;
    const now = Date.now();
    const minIntervalMs = 15000;
    const elapsed = now - entry.lastWriteAt;

    if (!force && elapsed < minIntervalMs) {
      if (!entry.timer) {
        entry.timer = setTimeout(() => {
          entry.timer = null;
          flushCampaignProgressToFirestore(campaignId, true);
        }, minIntervalMs - elapsed);
      }
      return;
    }

    entry.lastWriteAt = now;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    patchCampaignPersist(uid, campaignId, {
      processedCount: entry.payload.processedCount,
      successCount: entry.payload.successCount,
      failedCount: entry.payload.failedCount
    });
  };

  const queueCampaignProgressPersist = (
    campaignId: string,
    payload: { processedCount: number; successCount: number; failedCount: number }
  ) => {
    const existing = campaignProgressPersistRef.current[campaignId];
    if (existing) {
      existing.payload = payload;
      flushCampaignProgressToFirestore(campaignId, false);
      return;
    }
    campaignProgressPersistRef.current[campaignId] = {
      timer: null,
      lastWriteAt: 0,
      payload
    };
    flushCampaignProgressToFirestore(campaignId, false);
  };

  const clearCampaignProgressPersist = (campaignId: string) => {
    const entry = campaignProgressPersistRef.current[campaignId];
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }
    delete campaignProgressPersistRef.current[campaignId];
  };

  /** Evita `updateDoc` duplicado ao corrigir o mesmo documento com fila ja concluida. */
  const campaignFirestoreHealRef = useRef<Set<string>>(new Set());

  const syncStuckCampaignsToFirestore = useCallback((raw: Campaign[], uid: string) => {
    for (const c of raw) {
      if (c.status !== CampaignStatus.RUNNING) continue;
      if (!isRunningStatusButWorkComplete(c)) continue;
      if (campaignFirestoreHealRef.current.has(c.id)) continue;
      campaignFirestoreHealRef.current.add(c.id);
      const m = getCampaignProgressMetrics(c);
      patchCampaignPersist(uid, c.id, {
        status: CampaignStatus.COMPLETED,
        processedCount: m.effectiveProcessed,
        successCount: m.ok,
        failedCount: m.fail
      });
    }
  }, [patchCampaignPersist]);

  /** `campaign-progress` / Firestore defasados: ninguem a correr, mas ainda isRunning; limpa a barra de estado. */
  useEffect(() => {
    if (campaigns.some((c) => c.status === CampaignStatus.RUNNING)) return;
    setCampaignStatus((s) => (s.isRunning ? { ...s, isRunning: false } : s));
  }, [campaigns]);

  useEffect(() => {
    campaignsRef.current = campaigns;
  }, [campaigns]);

  // Mantem `metrics` alinhado ao funil acumulado do servidor.
  // Nao usamos mais `campaigns` para recalcular funil, pois isso apagava leitura/resposta
  // e criava divergencia na home/relatorios quando havia historico persistido.
  useEffect(() => {
    setMetrics({
      totalSent: Number(funnelStats.totalSent) || 0,
      totalDelivered: Number(funnelStats.totalDelivered) || 0,
      totalRead: Number(funnelStats.totalRead) || 0,
      totalReplied: Number(funnelStats.totalReplied) || 0
    });
  }, [funnelStats]);

  const normalizeContactDoc = useCallback((id: string, raw: Record<string, any>): Contact => {
    const birthday =
      raw.birthday ||
      raw.aniversario ||
      raw.dataNascimento ||
      raw.data_nascimento ||
      raw.dataAniversario ||
      raw.dob ||
      raw.birthdate ||
      raw.birthDate ||
      '';
    const email = raw.email || raw.e_mail || '';
    const notes = raw.notes || raw.observacoes || raw.obs || '';
    const followUpAt =
      parseFirestoreDateToIso(raw.followUpAt) ||
      parseFirestoreDateToIso(raw.follow_up_at) ||
      parseFirestoreDateToIso(raw.retornoEm);
    const followUpRaw = raw.followUpNote ?? raw.follow_up_note ?? raw.retornoNota;
    const followUpNote =
      typeof followUpRaw === 'string' && followUpRaw.trim() ? followUpRaw.trim().slice(0, 500) : undefined;
    const aliasRaw = raw.aliasContactIds;
    const aliasContactIds = Array.isArray(aliasRaw)
      ? aliasRaw.map((x: unknown) => String(x || '')).filter(Boolean)
      : [];
    const rmpRaw = raw.religiousMemberProfile;
    const religiousMemberProfile: ReligiousMemberProfile | undefined =
      rmpRaw && typeof rmpRaw === 'object' && !Array.isArray(rmpRaw)
        ? (rmpRaw as ReligiousMemberProfile)
        : undefined;
    const rawCtp = raw.campaignTablePreview;
    const campaignTablePreview =
      rawCtp &&
      typeof rawCtp === 'object' &&
      !Array.isArray(rawCtp) &&
      String((rawCtp as Record<string, unknown>).campaignId || '').trim()
        ? (() => {
            const o = rawCtp as Record<string, unknown>;
            const cid = String(o.campaignId || '').trim().slice(0, 64);
            return {
              campaignId: cid,
              campaignName: String(o.campaignName || '').slice(0, 120),
              sent: Math.max(0, Math.floor(Number(o.sent) || 0)),
              totalStages: Math.max(1, Math.floor(Number(o.totalStages) || 1)),
              pending: Math.max(0, Math.floor(Number(o.pending) || 0)),
              updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : ''
            };
          })()
        : undefined;
    const base = applyAddressNormalizationToContact({
      name: raw.name || raw.nome || 'Sem Nome',
      phone:
        raw.phone ||
        raw.telefone ||
        raw.celular ||
        raw.mobile ||
        raw.whatsapp ||
        raw.numero ||
        raw.Numero ||
        '',
      city: raw.city || raw.cidade || '',
      state: raw.state || raw.uf || raw.estado || '',
      street: raw.street || raw.rua || raw.logradouro || raw.endereco || '',
      number: raw.number || raw.numero || raw.num || '',
      neighborhood: raw.neighborhood || raw.bairro || '',
      zipCode: raw.zipCode || raw.cep || raw.zip || '',
      church: raw.church || raw.igreja || '',
      role: raw.role || raw.cargo || raw.funcao || '',
      profession: raw.profession || raw.profissao || raw.cargoProfissional || raw.cargo_profissional || '',
      birthday,
      email,
      notes,
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      status: raw.status || 'VALID',
      lastMsg: raw.lastMsg || raw.ultimaMsg,
      ...(followUpAt ? { followUpAt } : {}),
      ...(followUpNote ? { followUpNote } : {}),
      ...(aliasContactIds.length > 0 ? { aliasContactIds } : {}),
      ...(religiousMemberProfile && Object.keys(religiousMemberProfile).length > 0 ? { religiousMemberProfile } : {}),
      ...(raw.marketingOptOut === true ? { marketingOptOut: true } : {}),
      ...(raw.marketingOptIn === true ? { marketingOptIn: true } : {}),
      ...(typeof raw.marketingConsentAt === 'string' && raw.marketingConsentAt.trim()
        ? { marketingConsentAt: raw.marketingConsentAt.trim() }
        : {}),
      ...(typeof raw.marketingConsentText === 'string' && raw.marketingConsentText.trim()
        ? { marketingConsentText: raw.marketingConsentText.trim().slice(0, 500) }
        : {}),
      ...(raw.campaignMessagesReceived != null && raw.campaignMessagesReceived !== ''
        ? { campaignMessagesReceived: Math.max(0, Math.floor(Number(raw.campaignMessagesReceived) || 0)) }
        : {}),
      ...(campaignTablePreview ? { campaignTablePreview } : {})
    });
    return { ...base, id };
  }, []);

  const refreshContactsSavedTotal = useCallback(async (): Promise<void> => {
    const uid = currentUidRef.current;
    if (!uid) {
      setContactsSavedTotal(null);
      setContactsSavedTotalLoading(false);
      return;
    }
    const requestUid = uid;
    setContactsSavedTotalLoading(true);
    try {
      const total = await fetchContactsCount();
      if (currentUidRef.current !== requestUid) return;
      setContactsSavedTotal(total);
    } catch (err) {
      warnProd('[VPS] contagem contacts:', (err as Error)?.message || err);
      if (currentUidRef.current === requestUid) setContactsSavedTotal(null);
    } finally {
      if (currentUidRef.current === requestUid) setContactsSavedTotalLoading(false);
    }
  }, []);

  const syncContactPages = async (
    requestUid: string,
    startOffset: number,
    opts: { reset?: boolean } = {}
  ): Promise<void> => {
    if (loadAllContactsInFlightRef.current) return;
    loadAllContactsInFlightRef.current = true;
    if (opts.reset) {
      contactsVpsOffsetRef.current = 0;
      setContacts([]);
      setContactsHasMore(false);
    }
    setContactsLoadingMore(true);
    try {
      let offset = startOffset;
      let hasMore = true;
      let firstBatch = offset === 0;
      while (hasMore && currentUidRef.current === requestUid) {
        const { contacts: batch, hasMore: more, total } = await fetchContacts({
          limit: CONTACTS_PAGE_SIZE,
          offset,
          skipCount: offset > 0
        });
        if (currentUidRef.current !== requestUid) return;
        offset += batch.length;
        contactsVpsOffsetRef.current = offset;
        hasMore = more;
        setContactsHasMore(more);
        if (total != null) setContactsSavedTotal(total);
        if (batch.length === 0) break;
        if (firstBatch) {
          startTransition(() => setContacts(batch));
          firstBatch = false;
        } else {
          startTransition(() => {
            setContacts((prev) => appendContactsPage(prev, batch));
          });
        }
        if (!more) break;
        await new Promise((r) => setTimeout(r, 16));
      }
    } catch (err) {
      warnProd('[VPS] sync contacts:', (err as Error)?.message || err);
    } finally {
      if (currentUidRef.current === requestUid) setContactsLoadingMore(false);
      loadAllContactsInFlightRef.current = false;
    }
  };

  reloadVpsContactsRef.current = async () => {
    const uid = currentUidRef.current;
    if (!uid) return;
    await syncContactPages(uid, 0, { reset: true });
  };

  reloadVpsContactListsRef.current = async () => {
    const uid = currentUidRef.current;
    if (!uid) return;
    try {
      const lists = await fetchContactLists();
      if (currentUidRef.current !== uid) return;
      setContactLists(lists);
    } catch (err) {
      warnProd('[VPS] reload contact lists:', (err as Error)?.message || err);
    }
  };

  const refreshContactsSavedTotalRef = useRef(refreshContactsSavedTotal);
  refreshContactsSavedTotalRef.current = refreshContactsSavedTotal;

  // --- Dados do tenant (API Postgres) ---
  useEffect(() => {
    const bindUser = (uid: string) => {
      setCircuitBreakerOpenIds(new Set());
      contactsVpsOffsetRef.current = 0;
      setContactsHasMore(false);
      void reloadVpsContactsRef.current();
      void refreshContactsSavedTotalRef.current();
      void reloadVpsContactListsRef.current();
      void reloadVpsCampaignsRef.current();
    };

    bindUserRef.current = bindUser;

    // Limpa TODOS os estados sensiveis antes de carregar dados de outro usuario.
    // Antes, conversas/metricas/funil/etc do usuario anterior persistiam por
    // alguns segundos apos troca de conta — vazamento entre sessoes em
    // browser compartilhado.
    const resetSessionState = () => {
      inboxNextCursorRef.current = null;
      setInboxHasMore(false);
      setInboxLoadingMore(false);
      setInboxTotal(0);
      setContacts([]);
      setContactLists([]);
      setCampaigns([]);
      setConnections([]);
      setConversations([]);
      setBirthdays([]);
      setSystemLogs([]);
      setMetrics(INITIAL_METRICS);
      setFunnelStats(INITIAL_FUNNEL);
      setCampaignGeo(INITIAL_CAMPAIGN_GEO);
      setSystemMetrics(INITIAL_SYS_METRICS);
      setWarmupQueue([]);
      setWarmedCount(0);
      setWarmupChipStats({});
      setCircuitBreakerOpenIds(new Set());
      setCampaignStatus({ isRunning: false, total: 0, processed: 0, success: 0, failed: 0 });
      setContactsSavedTotal(null);
      campaignFirestoreHealRef.current.clear();
      conversationsSocketPendingRef.current = null;
    };

    const handleAuthUser = async (user: SessionUser | null) => {
      const newAuthUid = user?.uid ?? null;
      const uidChanged = prevAuthUserRef.current !== newAuthUid;
      if (uidChanged) {
        prevAuthUserRef.current = newAuthUid;
        prevBoundDataUidRef.current = null;
        resetSessionState();
      }

      const sock = socketRef.current;
      if (sock) {
        if (!user) {
          (sock as Socket & { auth: { token?: string } }).auth = {};
          if (sock.connected) sock.disconnect();
          return;
        }
        try {
          const t = await user.getIdToken();
          sock.auth = { token: t };
        } catch {
          (sock as Socket & { auth: { token?: string } }).auth = {};
        }
        // Só reconecta ao trocar de conta — atualizar perfil/nome não deve derrubar o socket.
        if (uidChanged) {
          if (sock.connected) sock.disconnect();
          sock.connect();
        } else if (!sock.connected) {
          sock.connect();
        }
      }

      if (!user?.uid) {
        resetSessionState();
        return;
      }
      if (workspaceLoading) return;

      const dataUid = effectiveWorkspaceUid ?? user.uid;
      currentUidRef.current = dataUid;
      if (prevBoundDataUidRef.current !== dataUid) {
        prevBoundDataUidRef.current = dataUid;
        bindUser(dataUid);
      }
    };

    void handleAuthUser(sessionUser);

    return () => {};
  }, [syncStuckCampaignsToFirestore, effectiveWorkspaceUid, workspaceLoading, sessionUser?.uid]);

  const loadAllContacts = useCallback(async (): Promise<void> => {
    const uid = currentUidRef.current;
    if (!uid || loadAllContactsInFlightRef.current || !contactsHasMore) return;
    await syncContactPages(uid, contactsVpsOffsetRef.current);
  }, [contactsHasMore]);

  const loadMoreContacts = useCallback(async (): Promise<void> => {
    await loadAllContacts();
  }, [loadAllContacts]);

  useEffect(() => {
    const u = sessionUser;
    if (!u?.uid || workspaceLoading) return;
    const dataUid = effectiveWorkspaceUid ?? u.uid;
    if (currentUidRef.current !== dataUid) {
      inboxNextCursorRef.current = null;
      setInboxHasMore(false);
      setInboxLoadingMore(false);
      setInboxTotal(0);
      setContacts([]);
      setContactLists([]);
      setCampaigns([]);
      setConnections([]);
      setConversations([]);
      setContactsSavedTotal(null);
      campaignFirestoreHealRef.current.clear();
    }
    currentUidRef.current = dataUid;
    bindUserRef.current(dataUid);
  }, [effectiveWorkspaceUid, workspaceLoading]);

  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  // --- SOCKET.IO REAL-TIME CONNECTION ---
  useEffect(() => {
    /** Workspace (userWorkspaceLinks) tem de resolver antes do socket — senão o filtro usa authUid e bloqueia canais/conversas do tenant. */
    if (workspaceLoading) return undefined;
    const resolvedWorkspaceUid = effectiveWorkspaceUid ?? sessionUser?.uid ?? null;
    if (!resolvedWorkspaceUid) return undefined;
    currentUidRef.current = resolvedWorkspaceUid;

    const BACKEND_URL = getSocketIoOrigin();
    /** Evita corrida Firebase vs ref: o primeiro connections-update vinha antes do ref estar alinhado e esvaziava a lista (modo estrito uid__). */
    const getOwnerUidForConnectionScope = (): string =>
      currentUidRef.current ?? resolvedWorkspaceUid ?? 'anonymous';
    const ownsConnectionId = (connectionId: string, connectionOwnerUid?: string) => {
      const tenantUid = getOwnerUidForConnectionScope();
      const idx = connectionId.indexOf('__');
      const ownerFromId = idx > 0 ? connectionId.slice(0, idx) : undefined;
      const meta =
        connectionOwnerUid ??
        connectionsRef.current.find((c) => c.id === connectionId)?.ownerUid ??
        ownerFromId;
      if (ownsConnectionForUid(tenantUid, connectionId, meta)) return true;
      const authUid = sessionUser?.uid;
      if (
        authUid &&
        meta === authUid &&
        tenantUid &&
        tenantUid !== authUid &&
        resolvedWorkspaceUid === tenantUid
      ) {
        return true;
      }
      return false;
    };

    devLog(`Iniciando conexão Socket.IO com: ${BACKEND_URL || 'origem relativa'}`);

    /** Firebase só serve HTML/JS — sem Node na mesma URL; ligar Socket à mesma origem falha sempre. */
    if (isLikelySplitStaticFrontend()) {
      const hint =
        'O site em Firebase precisa saber onde está a API Node. Nas próximas vezes uses `scripts/deploy-hosting.ps1 -ApiOrigin "https://…"` ou defina `VITE_API_ORIGIN` antes do build (`env.production.template`). Na VPS, acrescente este domínio a `ALLOWED_ORIGINS`.';
      console.error(`[ZapMass] ${hint}`);
      toast.error(`${hint}`, { duration: 22_000, icon: '🔗' });
      setBackendLinkState('offline');
      setIsBackendConnected(false);
      return () => {
        resetCampaignRecipientErrorBurst(campaignRecipientErrorBurstRef);
      };
    }

    const sock = io(BACKEND_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 15000,
      /** Handshake inicial: redes lentas / TLS; não confundir com ping do motor (servidor). */
      timeout: 45000,
      autoConnect: false,
      auth: {},
      extraHeaders: {
        "ngrok-skip-browser-warning": "true"
      }
    });
    socketRef.current = sock;
    setSocketForShell(sock);
    const socket = sock;

    const markBackendOnline = () => {
      if (offlineBadgeDelayRef.current) {
        clearTimeout(offlineBadgeDelayRef.current);
        offlineBadgeDelayRef.current = null;
      }
      setBackendLinkState('online');
      setIsBackendConnected(true);
    };

    const scheduleBackendOffline = (opts?: { immediate?: boolean }) => {
      if (offlineBadgeDelayRef.current) {
        clearTimeout(offlineBadgeDelayRef.current);
        offlineBadgeDelayRef.current = null;
      }
      if (socket.connected) return;
      const immediate = opts?.immediate === true;
      if (immediate) {
        setBackendLinkState('offline');
        setIsBackendConnected(false);
        return;
      }
      setBackendLinkState('reconnecting');
      offlineBadgeDelayRef.current = setTimeout(() => {
        offlineBadgeDelayRef.current = null;
        if (!socket.connected) {
          setBackendLinkState('offline');
          setIsBackendConnected(false);
        }
      }, BACKEND_OFFLINE_UI_GRACE_MS);
    };

    const syncBackendConnected = () => {
      if (socket.connected) markBackendOnline();
      else scheduleBackendOffline();
    };
    void getSessionIdToken().then((token) => {
      if (token) {
        socket.auth = { token };
        if (!socket.connected) socket.connect();
      }
    }).catch(() => {
      setBackendLinkState('offline');
      setIsBackendConnected(false);
    });

    const syncConnectionsFromApi = async () => {
      const ownerUid = getOwnerUidForConnectionScope();
      if (!ownerUid || ownerUid === 'anonymous') return;
      try {
        const token = await getSessionIdToken();
        if (!token) return;
        const res = await fetch(apiUrl('/api/connections/sync'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          connections?: WhatsAppConnection[];
          conversations?: Conversation[];
          conversationsCount?: number;
        };
        const list = (Array.isArray(data.connections) ? data.connections : []).filter((conn) =>
          ownsConnectionForUid(ownerUid, conn.id, conn.ownerUid)
        );
        setConnections((prev) => {
          const scopedPrev = prev.filter((conn) =>
            ownsConnectionForUid(ownerUid, conn.id, conn.ownerUid)
          );
          if (list.length === 0) {
            if (scopedPrev.length === 0) return prev;
            connectionsRef.current = [];
            return [];
          }
          const result = mergeWhatsAppConnectionLists(list, scopedPrev, qrCodeByConnectionId.current);
          for (const conn of result) {
            if (conn.status === ConnectionStatus.CONNECTED) {
              delete qrCodeByConnectionId.current[conn.id];
            }
          }
          connectionsRef.current = result;
          return result;
        });
        if (Array.isArray(data.conversations) && data.conversations.length > 0) {
          setConversations((prev) =>
            mergeConversationsFromSocketUpdate(prev, data.conversations!, ownsConnectionId)
          );
        }
        devLog('[sync] Canais sincronizados da Evolution', {
          count: list.length,
          conversations: data.conversationsCount ?? data.conversations?.length ?? 0
        });
        if (socket.connected) {
          socket.emit('request-conversations-sync');
        }
      } catch (e) {
        console.warn('[sync] /api/connections/sync falhou:', e);
      }
    };
    syncConnectionsFromApiRef.current = syncConnectionsFromApi;

    socket.on('connect', () => {
      if (offlineBadgeDelayRef.current) {
        clearTimeout(offlineBadgeDelayRef.current);
        offlineBadgeDelayRef.current = null;
      }
      if (disconnectToastTimerRef.current) {
        clearTimeout(disconnectToastTimerRef.current);
        disconnectToastTimerRef.current = null;
      }
      markBackendOnline();
      if (!hasConnectedOnceRef.current) {
        hasConnectedOnceRef.current = true;
        toast.success('Servidor conectado!', {
          icon: '🟢',
          style: { borderRadius: '10px', background: '#333', color: '#fff' }
        });
      }
      // Sem toast em reconexao: troca de aba / retorno do fundo gera muito ruido; o painel
      // usa isBackendConnected; toast so na primeira carga (acima) e se ficar 6s+ off (disconnect).
      devLog('🔌 Conectado ao servidor Socket.io');
      void syncConnectionsFromApi();
      scheduleBootstrapConnectionSync();
    });

    socket.on('disconnect', (reason) => {
      if (offlineBadgeDelayRef.current) {
        clearTimeout(offlineBadgeDelayRef.current);
        offlineBadgeDelayRef.current = null;
      }
      if (disconnectToastTimerRef.current) {
        clearTimeout(disconnectToastTimerRef.current);
        disconnectToastTimerRef.current = null;
      }
      if (reason === 'io client disconnect') {
        scheduleBackendOffline({ immediate: true });
        return; // logout / socket.disconnect() intencional — sem aviso de falha
      }
      scheduleBackendOffline();
      // Evita falso positivo em quedas rapidas: so avisa erro apos 6s offline continuo
      // (reconexao comum nao dispara: connect() limpa este timer).
      disconnectToastTimerRef.current = setTimeout(() => {
        if (!socket.connected) {
          toast.error('Conexão perdida com o servidor.', {
            icon: '🔴',
            style: { borderRadius: '10px', background: '#333', color: '#fff' }
          });
        }
        disconnectToastTimerRef.current = null;
      }, 6000);
    });

    socket.on('connect_error', (err) => {
      scheduleBackendOffline();
      console.error('❌ Erro na conexão Socket.IO:', err.message);
      const msg = String(err?.message || '').toLowerCase();
      const authRelated =
        msg === 'unauthorized' || msg.includes('jwt') || msg.includes('token') || msg.includes('expired');
      if (authRelated) {
        void getSessionIdToken(true)
          .then((token) => {
            socket.auth = token ? { token } : {};
            if (!socket.connected) socket.connect();
          })
          .catch(() => {
            /* sem token valido, mantem desconectado */
          });
      }
    });

    // Reconexao completa do manager (cobre casos em que o handler de `connect` nao dispara
    // na ordem esperada apos retoken / reload).
    const onManagerReconnect = () => {
      syncBackendConnected();
      void syncConnectionsFromApi();
    };
    socket.io.on('reconnect', onManagerReconnect);
    // Estado inicial: se o socket ja estiver conectado (ou reconectar muito rapido), reflete no badge.
    syncBackendConnected();
    queueMicrotask(() => syncBackendConnected());

    socket.on('connections-update', (updatedConnections: WhatsAppConnection[]) => {
      const ownerUid = getOwnerUidForConnectionScope();
      const mine = (Array.isArray(updatedConnections) ? updatedConnections : []).filter((conn) =>
        ownsConnectionForUid(ownerUid, conn.id, conn.ownerUid)
      );
      setConnections((prev) => {
        const scopedPrev = prev.filter((conn) =>
          ownsConnectionForUid(ownerUid, conn.id, conn.ownerUid)
        );
        if (mine.length === 0) {
          if (scopedPrev.length === 0) return prev;
          connectionsRef.current = [];
          return [];
        }
        const result = mergeWhatsAppConnectionLists(mine, scopedPrev, qrCodeByConnectionId.current);
        for (const conn of result) {
          if (conn.status === ConnectionStatus.CONNECTED) {
            delete qrCodeByConnectionId.current[conn.id];
          }
        }
        /** Ignorar update sem mudanças relevantes — evita rerender em cascata pela referência nova. */
        if (
          prev.length === result.length &&
          prev.every((p, i) => {
            const r = result[i];
            return (
              p.id === r.id &&
              p.status === r.status &&
              p.qrCode === r.qrCode &&
              p.name === r.name &&
              p.phoneNumber === r.phoneNumber &&
              (p.ownerUid ?? '') === (r.ownerUid ?? '') &&
              (p.healthScore ?? 100) === (r.healthScore ?? 100)
            );
          })
        ) {
          return prev;
        }
        // ── Detecta chip offline (open → não-open) e notifica com toast ──────
        const prevMap = new Map(scopedPrev.map((c) => [c.id, c.status]));
        for (const conn of result) {
            const prevStatus = prevMap.get(conn.id);
            const isNowOffline =
                prevStatus === ConnectionStatus.CONNECTED &&
                conn.status !== ConnectionStatus.CONNECTED;
            if (isNowOffline) {
                const label = conn.name || conn.phoneNumber || conn.id;
                toast.error(`Chip desconectado: ${label}`, {
                    icon: '📵',
                    duration: 7000,
                    id: `chip-offline-${conn.id}`,
                });
            }
        }
        // ────────────────────────────────────────────────────────────────────

        connectionsRef.current = result;
        return result;
      });
    });

    socket.on('subscription-required', (p: { message?: string }) => {
      const msg =
        typeof p?.message === 'string' && p.message.trim()
          ? p.message
          : 'Plano ativo ou teste valido e necessario. Abra Minha assinatura.';
      toast.error(msg, { duration: 9000, icon: '💳' });
    });

    socket.on('connection-limit-reached', (p: { current?: number; max?: number; message?: string }) => {
      const maxN = Number(p?.max);
      if (Number.isFinite(maxN) && maxN < MAX_CHANNELS_TOTAL) {
        openChannelExtraPurchaseFlow();
      }
      const msg =
        typeof p?.message === 'string' && p.message.trim()
          ? p.message
          : `Limite de canais: ${p?.current ?? '?'}/${p?.max ?? '?'}. Acesse Minha assinatura para o pacote de canais extras.`;
      toast.error(msg);
    });

    socket.on('session-worker-missing', (p: { message?: string }) => {
      const msg =
        typeof p?.message === 'string' && p.message.trim()
          ? p.message
          : 'Nenhum wa-worker (processo de sessao WhatsApp). Com modo API+Redis, inicie `npm run worker:dev` ou use modo classico (um processo) no .env.';
      toast.error(msg, { duration: 14_000, icon: '🔧' });
    });

    socket.on('metrics-update', (newMetrics: DashboardMetrics) => {
      setMetrics((prev) => {
        if (
          prev &&
          prev.totalSent === newMetrics.totalSent &&
          prev.totalDelivered === newMetrics.totalDelivered &&
          prev.totalRead === newMetrics.totalRead &&
          prev.totalReplied === newMetrics.totalReplied
        ) {
          return prev;
        }
        return newMetrics;
      });
    });

    socket.on('funnel-stats-update', (newFunnel: FunnelStats) => {
      setFunnelStats((prev) => {
        const next: FunnelStats = {
          totalSent: Number(newFunnel?.totalSent) || 0,
          totalDelivered: Number(newFunnel?.totalDelivered) || 0,
          totalRead: Number(newFunnel?.totalRead) || 0,
          totalReplied: Number(newFunnel?.totalReplied) || 0,
          updatedAt: Number(newFunnel?.updatedAt) || Date.now(),
          clearedAt: newFunnel?.clearedAt,
          sentByDay:
            newFunnel?.sentByDay && typeof newFunnel.sentByDay === 'object' ? { ...newFunnel.sentByDay } : {},
          deliveredByDay:
            newFunnel?.deliveredByDay && typeof newFunnel.deliveredByDay === 'object'
              ? { ...newFunnel.deliveredByDay }
              : {},
          readByDay:
            newFunnel?.readByDay && typeof newFunnel.readByDay === 'object' ? { ...newFunnel.readByDay } : {},
          repliedByDay:
            newFunnel?.repliedByDay && typeof newFunnel.repliedByDay === 'object'
              ? { ...newFunnel.repliedByDay }
              : {},
          sentByDayByCampaign:
            newFunnel?.sentByDayByCampaign && typeof newFunnel.sentByDayByCampaign === 'object'
              ? Object.fromEntries(
                  Object.entries(newFunnel.sentByDayByCampaign).map(([dk, row]) => [dk, { ...row }])
                )
              : {}
        };
        if (
          prev &&
          prev.totalSent === next.totalSent &&
          prev.totalDelivered === next.totalDelivered &&
          prev.totalRead === next.totalRead &&
          prev.totalReplied === next.totalReplied &&
          prev.clearedAt === next.clearedAt &&
          prev.updatedAt === next.updatedAt
        ) {
          return prev;
        }
        return next;
      });
    });

    socket.on('warmup-chip-stats-update', (list: WarmupChipStats[]) => {
      if (!Array.isArray(list)) return;
      const dict: Record<string, WarmupChipStats> = {};
      list.forEach((s) => {
        if (s && s.connectionId && ownsConnectionId(s.connectionId)) dict[s.connectionId] = s;
      });
      setWarmupChipStats(dict);
    });

    socket.on('conversations-update', (updatedConversations: Conversation[]) => {
      if (!Array.isArray(updatedConversations)) return;
      /** Lista completa do servidor por evento; substituir preserva último estado no frame (concatenar quebraria o merge). */
      conversationsSocketPendingRef.current = updatedConversations;
      if (conversationsSocketRafRef.current != null) return;
      conversationsSocketRafRef.current = requestAnimationFrame(() => {
        conversationsSocketRafRef.current = null;
        const pending = conversationsSocketPendingRef.current;
        conversationsSocketPendingRef.current = null;
        if (!pending) return;
        if (pending.length === 0) {
          /** Payload vazio com canal CONNECTED = escopo/sync atrasado no servidor — não esvaziar o pipeline. */
          const hasConnected = connectionsRef.current.some(
            (c) => c.status === ConnectionStatus.CONNECTED
          );
          if (hasConnected && socket.connected) {
            socket.emit('request-conversations-sync', { full: false });
          }
          return;
        }
        setConversations((prev) => mergeConversationsFromSocketUpdate(prev, pending, ownsConnectionId));
      });
    });

    socket.on('conversation-delta', (delta: Conversation) => {
      if (!delta?.id) return;
      setConversations((prev) => mergeConversationDelta(prev, delta, ownsConnectionId));
    });

    socket.on('conversations-removed', ({ conversationIds }: { conversationIds?: string[] }) => {
      const ids = Array.isArray(conversationIds) ? conversationIds.filter(Boolean) : [];
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setConversations((prev) => prev.filter((c) => !idSet.has(c.id)));
    });

    socket.on(
      'inbox-page',
      (data: {
        conversations?: Conversation[];
        nextCursor?: number | null;
        hasMore?: boolean;
        total?: number;
        reset?: boolean;
      }) => {
        const list = Array.isArray(data?.conversations) ? data.conversations : [];
        inboxNextCursorRef.current =
          data?.hasMore && data.nextCursor != null ? Number(data.nextCursor) : null;
        setInboxHasMore(!!data?.hasMore);
        setInboxTotal(Number(data?.total) || 0);
        setConversations((prev) =>
          data?.reset
            ? mergeConversationsFromSocketUpdate([], list, ownsConnectionId)
            : mergeConversationsFromSocketUpdate(prev, list, ownsConnectionId)
        );
      }
    );

    socket.on('conversation-picture', ({ conversationId, profilePicUrl }: { conversationId: string; profilePicUrl?: string | null }) => {
      if (!conversationId || !profilePicUrl) return;
      const pic = String(profilePicUrl);
      if (!pic.startsWith('http') && !pic.startsWith('data:')) return;
      setConversations((prev) => {
        const c = prev.find((x) => x.id === conversationId);
        if (!c || !ownsConnectionId(c.connectionId)) return prev;
        return prev.map((x) => (x.id === conversationId ? { ...x, profilePicUrl: pic } : x));
      });
    });

    // Real system metrics
    socket.on('system-metrics', (data: Partial<SystemMetrics>) => {
      setSystemMetrics((prev) => {
        if (mergedSystemMetricsUnchanged(prev, data)) return prev;
        return { ...prev, ...data };
      });
    });

    socket.on('session-live-stats', (data: {
      router?: { aliveWorkers?: number; pendingAssignments?: number };
      concurrency?: { inFlight?: number; waiting?: number; max?: number };
      bus?: { remote?: boolean };
    }) => {
      const next = {
        workersAlive: Number(data?.router?.aliveWorkers || 0),
        pendingAssignments: Number(data?.router?.pendingAssignments || 0),
        inFlight: Number(data?.concurrency?.inFlight || 0),
        waiting: Number(data?.concurrency?.waiting || 0),
        maxConcurrent: Number(data?.concurrency?.max || 0),
        busRemote: Boolean(data?.bus?.remote)
      };
      setSessionLiveStats((prev) =>
        prev && sessionLiveStatsEqual(prev, next) ? prev : next
      );
    });

    // Real latency via ping/pong (a cada 5s)
    const pingInterval = setInterval(() => {
      if (!socket.connected) return;
      const t0 = Date.now();
      socket.emit('ping-latency', t0);
    }, 5000);
    socket.on('pong-latency', (t0: unknown) => {
      const sent =
        typeof t0 === 'number' && Number.isFinite(t0)
          ? t0
          : typeof t0 === 'string'
            ? Number(t0)
            : NaN;
      if (!Number.isFinite(sent) || sent <= 0) return;
      const lat = Math.max(0, Date.now() - sent);
      setSystemMetrics((prev) => {
        const prevLat = Number(prev.latency) || 0;
        if (prevLat > 0 && Math.abs(prevLat - lat) < 25) return prev;
        return { ...prev, latency: lat };
      });
    });

    socket.on('warmup-update', (data: { pending: WarmupItem[]; warmedCount: number }) => {
      setWarmupQueue(Array.isArray(data?.pending) ? data.pending : []);
      setWarmedCount(Number.isFinite(data?.warmedCount) ? data.warmedCount : 0);
    });

    socket.on('auto-warmup-state', (data: { active: boolean; connectionIds?: string[]; intervalMinutes?: number }) => {
      setWarmupActive(!!data?.active);
    });

    socket.on('initial-data', (data: { contacts?: Contact[]; birthdays?: BirthdayContact[] }) => {
      if (Array.isArray(data?.birthdays)) setBirthdays(data.birthdays);
      // Contactos vêm do Firestore (`onSnapshot`); não substituir por [] se algum payload legado vier vazio.
      if (Array.isArray(data?.contacts) && data.contacts.length > 0) {
        startTransition(() => {
          setContacts((prev) => {
            const byId = new Map(prev.map((c) => [c.id, c]));
            for (const c of data.contacts!) {
              if (c?.id) byId.set(c.id, { ...(byId.get(c.id) || ({} as Contact)), ...c });
            }
            // Postgres já entrega ordenado — evita localeCompare em 10k no main thread.
            return Array.from(byId.values());
          });
        });
      }
    });

    socket.on('qr-code', (data: { connectionId: string; qrCode: string }) => {
      const qr = typeof data?.qrCode === 'string' ? data.qrCode.trim() : '';
      if (!data?.connectionId || !qr) return;
      qrCodeByConnectionId.current[data.connectionId] = qr;
      setConnections((prev) => {
        const updated = prev.map((conn) =>
          conn.id === data.connectionId
            ? {
                ...conn,
                qrCode: qr,
                status: ConnectionStatus.QR_READY,
                lastActivity: 'Aguardando leitura do QR...'
              }
            : conn
        );
        connectionsRef.current = updated;
        return updated;
      });
    });

    socket.on('connection-init-failure', ({ connectionId, message }: { connectionId: string; message?: string }) => {
      toast.error(message || 'Falha ao iniciar o canal. Tente "Forçar QR" novamente.', { duration: 10_000 });
      setConnections((prev) =>
        prev.map((c) =>
          c.id === connectionId
            ? { ...c, status: ConnectionStatus.DISCONNECTED, qrCode: undefined, lastActivity: message || 'Falha ao conectar' }
            : c
        )
      );
    });

    socket.on('connection-authenticated', ({ connectionId }: { connectionId: string }) => {
      toast('QR escaneado! Aguardando conexão...', { icon: '🔐' });
      setConnections(prev => prev.map(c =>
        c.id === connectionId ? { ...c, qrCode: undefined } : c
      ));
    });

    socket.on('connection-ready', ({ connectionId }: { connectionId: string }) => {
      const conn = connectionsRef.current.find(c => c.id === connectionId);
      toast.success(`Conexão "${conn?.name || connectionId}" estabelecida! ✅`);
      void syncConnectionsFromApi().then(() => {
        if (socket.connected) socket.emit('request-conversations-sync');
      });
    });

    /** Evolution: ONLINE/CONNECTING/OFFLINE — evita UI presa em "Inicializando" sem connections-update completo. */
    socket.on(
      'connection-update',
      (payload: { id?: string; status?: string; phoneNumber?: string | null }) => {
        const id = payload?.id;
        if (!id) return;
        const raw = String(payload.status || '').toUpperCase();
        const nextStatus =
          raw === 'ONLINE'
            ? ConnectionStatus.CONNECTED
            : raw === 'CONNECTING'
              ? ConnectionStatus.CONNECTING
              : raw === 'OFFLINE'
                ? ConnectionStatus.DISCONNECTED
                : null;
        if (!nextStatus) return;
        setConnections((prev) => {
          const current = prev.find((c) => c.id === id);
          if (!current) return prev;
          const mergedStatus = mergeConnectionStatus(nextStatus, current.status);
          if (mergedStatus === current.status && payload.phoneNumber == null) return prev;
          const updated = prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: mergedStatus,
                  phoneNumber: payload.phoneNumber ?? c.phoneNumber,
                  qrCode: mergedStatus === ConnectionStatus.CONNECTED ? undefined : c.qrCode
                }
              : c
          );
          connectionsRef.current = updated;
          return updated;
        });
        if (nextStatus === ConnectionStatus.CONNECTED && socket.connected) {
          socket.emit('request-conversations-sync');
        }
      }
    );

    /** Boot: Evolution/API pode ainda estar a hidratar quando o 1.º connections-update chega. */
    const bootstrapSyncTimers: ReturnType<typeof setTimeout>[] = [];
    const scheduleBootstrapConnectionSync = () => {
      for (const t of bootstrapSyncTimers) clearTimeout(t);
      bootstrapSyncTimers.length = 0;
      for (const delayMs of [2500, 8000, 20_000]) {
        bootstrapSyncTimers.push(
          setTimeout(() => {
            if (!socket.connected) return;
            if (connectionListHasStaleConnecting(connectionsRef.current)) {
              void syncConnectionsFromApi();
            }
          }, delayMs)
        );
      }
    };

    /** Canal em CONNECTING sem QR — reconcilia com Evolution via HTTP (boot + pairing preso). */
    const stuckConnectingSyncInterval = setInterval(() => {
      if (connectionListHasStaleConnecting(connectionsRef.current)) {
        void syncConnectionsFromApi();
      }
    }, 15_000);

    /** Polling HTTP do QR quando o socket não atualiza o status para QR_READY. */
    const pollStuckConnectionQr = async () => {
      if (!connectionListHasStaleConnecting(connectionsRef.current)) return;
      try {
        const token = await getSessionIdToken();
        if (!token) return;
        const stuck = connectionsRef.current.filter(
          (c) =>
            (c.status === ConnectionStatus.CONNECTING || c.status === ConnectionStatus.QR_READY) &&
            !c.qrCode
        );
        for (const conn of stuck) {
          const res = await fetch(apiUrl(`/api/connections/${encodeURIComponent(conn.id)}/qr`), {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = (await res.json()) as { ok?: boolean; qrCode?: string };
          const qr = typeof data?.qrCode === 'string' ? data.qrCode.trim() : '';
          if (!data?.ok || !qr) continue;
          qrCodeByConnectionId.current[conn.id] = qr;
          setConnections((prev) => {
            const updated = prev.map((c) =>
              c.id === conn.id
                ? {
                    ...c,
                    qrCode: qr,
                    status: ConnectionStatus.QR_READY,
                    lastActivity: 'Aguardando leitura do QR...'
                  }
                : c
            );
            connectionsRef.current = updated;
            return updated;
          });
        }
      } catch {
        /* próxima tentativa */
      }
    };
    const stuckQrPollInterval = setInterval(() => {
      void pollStuckConnectionQr();
    }, 4000);

    socket.on('auth-failure', ({ connectionId, message }: { connectionId: string; message: string }) => {
      toast.error(`Falha de autenticação: ${message || 'Tente escanear novamente.'}`);
    });

    // Campaign Events
    socket.on('campaign-started', ({ total, campaignId }) => {
      setCampaignStatus({ isRunning: true, total, processed: 0, success: 0, failed: 0 });
      if (campaignId) {
        setCampaignGeo({ campaignId, byUf: {}, updatedAt: Date.now() });
        const uid = currentUidRef.current;
        setCampaigns((prev) => {
          const next = prev.map((c) =>
            c.id === campaignId
              ? { ...c, status: CampaignStatus.RUNNING, processedCount: 0, successCount: 0, failedCount: 0 }
              : c
          );
          if (uid) syncStuckCampaignsToFirestore(next, uid);
          return healStuckRunningCampaignsList(next);
        });
        if (uid) {
          patchCampaignPersist(uid, campaignId, {
            status: CampaignStatus.RUNNING,
            processedCount: 0,
            successCount: 0,
            failedCount: 0
          });
        }
      }
    });

    socket.on('campaign-waiting-reply', ({ campaignId }: { campaignId?: string }) => {
      if (!campaignId) return;
      setCampaignStatus((prev) => ({ ...prev, isRunning: false }));
      const uid = currentUidRef.current;
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId ? { ...c, status: CampaignStatus.WAITING_REPLY } : c
        )
      );
      if (uid) {
        patchCampaignPersist(uid, campaignId, { status: CampaignStatus.WAITING_REPLY });
      }
    });

    socket.on(
      'campaign-geo-update',
      (data: { campaignId?: string; byUf?: Record<string, CampaignGeoUfStats>; updatedAt?: number }) => {
        setCampaignGeo({
          campaignId: typeof data?.campaignId === 'string' ? data.campaignId : null,
          byUf: data?.byUf && typeof data.byUf === 'object' ? data.byUf : {},
          updatedAt: Number(data?.updatedAt) || Date.now()
        });
      }
    );

    const flushCampaignProgressSocketFromRefs = () => {
      const pendingMap = campaignProgressSocketPendingRef.current;
      campaignProgressSocketPendingRef.current = {};
      const bar = campaignProgressBarPendingRef.current;
      campaignProgressBarPendingRef.current = null;

      const ids = Object.keys(pendingMap);
      if (ids.length > 0) {
        setCampaigns((prev) => {
          const merged = prev.map((c) => {
            const d = pendingMap[c.id];
            if (!d) return c;
            return {
              ...c,
              processedCount: d.processedCount,
              successCount: d.successCount,
              failedCount: d.failedCount,
              status: CampaignStatus.RUNNING
            };
          });
          const u = currentUidRef.current;
          if (u) syncStuckCampaignsToFirestore(merged, u);
          return healStuckRunningCampaignsList(merged);
        });
        for (const campaignId of ids) {
          const payload = pendingMap[campaignId];
          queueCampaignProgressPersist(campaignId, {
            processedCount: payload.processedCount,
            successCount: payload.successCount,
            failedCount: payload.failedCount
          });
        }
      }

      if (bar) {
        setCampaignStatus({
          isRunning: true,
          total: bar.total,
          processed: bar.processed,
          success: bar.successCount,
          failed: bar.failCount
        });
      }
    };

    const scheduleCampaignProgressSocketFlush = () => {
      if (campaignProgressSocketRafRef.current != null) return;
      campaignProgressSocketRafRef.current = setTimeout(() => {
        campaignProgressSocketRafRef.current = null;
        flushCampaignProgressSocketFromRefs();
        if (
          Object.keys(campaignProgressSocketPendingRef.current).length > 0 ||
          campaignProgressBarPendingRef.current != null
        ) {
          scheduleCampaignProgressSocketFlush();
        }
      }, 100) as unknown as number;
    };

    flushCampaignProgressSocketFromRefsRef.current = flushCampaignProgressSocketFromRefs;

    socket.on('campaign-progress', (data) => {
      // Normalizar: Evolution emite 'failCount', legado pode emitir 'failedCount'.
      const failNorm = Number(data?.failCount ?? data?.failedCount) || 0;
      campaignProgressBarPendingRef.current = {
        total: Number(data?.total) || 0,
        processed: Number(data?.processed) || 0,
        successCount: Number(data?.successCount) || 0,
        failCount: failNorm
      };
      const cid = typeof data?.campaignId === 'string' ? data.campaignId : '';
      if (cid) {
        campaignProgressSocketPendingRef.current[cid] = {
          processedCount: Number(data?.processed) || 0,
          successCount: Number(data?.successCount) || 0,
          failedCount: failNorm
        };
      }
      scheduleCampaignProgressSocketFlush();
    });

    socket.on(
      'campaign-complete',
      (payload: {
        successCount: number;
        failCount: number;
        campaignId?: string;
        processed?: number;
        total?: number;
      }) => {
        resetCampaignRecipientErrorBurst(campaignRecipientErrorBurstRef);
        const { successCount, failCount, campaignId } = payload;
        const processedCount =
          typeof payload.processed === 'number' && !Number.isNaN(payload.processed)
            ? payload.processed
            : Math.max(0, (Number(successCount) || 0) + (Number(failCount) || 0));
        setCampaignStatus(prev => ({ ...prev, isRunning: false }));
        if (campaignId) {
          flushCampaignProgressToFirestore(campaignId, true);
          const uid = currentUidRef.current;
          setCampaigns((prev) => {
            const cur = prev.find((c) => c.id === campaignId);
            const slots = cur?.weeklySchedule?.slots;
            const tz = cur?.scheduleTimeZone;
            const shouldReschedule =
              cur?.scheduleRepeatWeekly === true &&
              Array.isArray(slots) &&
              slots.length > 0 &&
              typeof tz === 'string' &&
              tz.length > 0;
            const nextIso = shouldReschedule ? computeNextRunIso(slots, tz, Date.now() + 45_000) : null;

            if (uid) {
              if (shouldReschedule && nextIso) {
                patchCampaignPersist(uid, campaignId, {
                  status: CampaignStatus.SCHEDULED,
                  nextRunAt: nextIso,
                  lastRunAt: new Date().toISOString(),
                  processedCount: 0,
                  successCount: 0,
                  failedCount: 0
                });
              } else {
                patchCampaignPersist(uid, campaignId, {
                  status: CampaignStatus.COMPLETED,
                  successCount,
                  failedCount: failCount,
                  processedCount
                });
              }
            }

            const next = prev.map((c) => {
              if (c.id !== campaignId) return c;
              if (shouldReschedule && nextIso) {
                return {
                  ...c,
                  status: CampaignStatus.SCHEDULED,
                  nextRunAt: nextIso,
                  lastRunAt: new Date().toISOString(),
                  processedCount: 0,
                  successCount: 0,
                  failedCount: 0
                };
              }
              return {
                ...c,
                status: CampaignStatus.COMPLETED,
                successCount,
                failedCount: failCount,
                processedCount
              };
            });
            if (uid) syncStuckCampaignsToFirestore(next, uid);
            return healStuckRunningCampaignsList(next);
          });
          clearCampaignProgressPersist(campaignId);
        }
        const ok = Number(successCount) || 0;
        const fail = Number(failCount) || 0;
        if (fail > 0) {
          toast.success(
            `Campanha terminada: ${ok} com sucesso · ${fail} falharam. Abra relatório ou «Registos do sistema» por número — evitamos notificar número a número durante o disparo.`,
            { duration: 9500, icon: '✅' }
          );
        } else {
          toast.success('Campanha finalizada!', { duration: 4500 });
        }
      }
    );

    // Motor Evolution emite 'campaign-finished'; motor legado emite 'campaign-complete'.
    // Ambos devem ter o mesmo tratamento de encerramento de campanha.
    socket.on(
      'campaign-finished',
      (payload: {
        successCount: number;
        failCount: number;
        campaignId?: string;
        total?: number;
      }) => {
        resetCampaignRecipientErrorBurst(campaignRecipientErrorBurstRef);
        const { successCount, failCount, campaignId } = payload;
        const processedCount = Math.max(0, (Number(successCount) || 0) + (Number(failCount) || 0));
        setCampaignStatus(prev => ({ ...prev, isRunning: false }));
        if (campaignId) {
          flushCampaignProgressToFirestore(campaignId, true);
          const uid = currentUidRef.current;
          setCampaigns((prev) => {
            const cur = prev.find((c) => c.id === campaignId);
            const slots = cur?.weeklySchedule?.slots;
            const tz = cur?.scheduleTimeZone;
            const shouldReschedule =
              cur?.scheduleRepeatWeekly === true &&
              Array.isArray(slots) &&
              slots.length > 0 &&
              typeof tz === 'string' &&
              tz.length > 0;
            const nextIso = shouldReschedule ? computeNextRunIso(slots, tz, Date.now() + 45_000) : null;

            if (uid) {
              if (shouldReschedule && nextIso) {
                patchCampaignPersist(uid, campaignId, {
                  status: CampaignStatus.SCHEDULED,
                  nextRunAt: nextIso,
                  lastRunAt: new Date().toISOString(),
                  processedCount: 0,
                  successCount: 0,
                  failedCount: 0
                });
              } else {
                patchCampaignPersist(uid, campaignId, {
                  status: CampaignStatus.COMPLETED,
                  successCount,
                  failedCount: failCount,
                  processedCount
                });
              }
            }

            const next = prev.map((c) => {
              if (c.id !== campaignId) return c;
              if (shouldReschedule && nextIso) {
                return {
                  ...c,
                  status: CampaignStatus.SCHEDULED,
                  nextRunAt: nextIso,
                  lastRunAt: new Date().toISOString(),
                  processedCount: 0,
                  successCount: 0,
                  failedCount: 0
                };
              }
              return {
                ...c,
                status: CampaignStatus.COMPLETED,
                successCount,
                failedCount: failCount,
                processedCount
              };
            });
            if (uid) syncStuckCampaignsToFirestore(next, uid);
            return healStuckRunningCampaignsList(next);
          });
          clearCampaignProgressPersist(campaignId);
        }
        const ok = Number(successCount) || 0;
        const fail = Number(failCount) || 0;
        const campaignName =
          campaigns.find((c) => c.id === campaignId)?.name || 'Campanha';
        if (fail > 0) {
          toast.success(
            `Campanha terminada: ${ok} com sucesso · ${fail} falharam. Abra relatório ou «Registos do sistema» por número.`,
            { duration: 9500, icon: '✅' }
          );
        } else {
          toast.success('Campanha finalizada!', { duration: 4500 });
        }
        // Web Push: notifica mesmo com a aba em segundo plano ou minimizada.
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const body =
              fail > 0
                ? `${ok} enviadas · ${fail} falharam`
                : `${ok} mensagem${ok !== 1 ? 'ns' : ''} enviada${ok !== 1 ? 's' : ''} com sucesso`;
            new Notification(`ZapMass — ${campaignName} concluída`, {
              body,
              icon: '/favicon.ico',
              tag: `campaign-done-${campaignId}`,
            });
          } else if ('Notification' in window && Notification.permission === 'default') {
            // Solicita permissão de forma silenciosa para futuras campanhas.
            void Notification.requestPermission();
          }
        } catch { /* Notificações não suportadas — ignora silenciosamente */ }
      }
    );

    socket.on(
      'campaign-auto-paused',
      ({ campaignId, failRatePct }: { campaignId?: string; reason?: string; failRatePct?: number }) => {
        const pct = failRatePct ?? '?';
        toast.error(
          `Campanha pausada automaticamente: ${pct}% de falhas nos últimos envios. Verifique os chips e retome manualmente.`,
          { duration: 12000, icon: '⚠️', id: `auto-pause-${campaignId}` }
        );
        if (campaignId) {
          setCampaigns((prev) =>
            prev.map((c) =>
              c.id === campaignId ? { ...c, status: CampaignStatus.PAUSED } : c
            )
          );
        }
      }
    );

    socket.on('campaign-error', ({ error, campaignId }: { error?: string; campaignId?: string }) => {
      toast.error(error || 'Falha ao iniciar campanha.', {
        id: 'campaign-bootstrap',
        duration: 7500
      });
      const uid = currentUidRef.current;
      if (uid && campaignId) {
        patchCampaignPersist(uid, campaignId, { status: CampaignStatus.FAILED });
        setCampaigns((prev) =>
          prev.map((c) => (c.id === campaignId ? { ...c, status: CampaignStatus.FAILED } : c))
        );
      }
    });

    socket.on(
      'scheduled-campaign-notice',
      (p: { message?: string; campaignId?: string; kind?: string }) => {
        const message =
          typeof p?.message === 'string' && p.message.trim().length > 0
            ? p.message.trim()
            : 'O agendamento não pôde iniciar; nova tentativa será feita em breve.';
        const kind = typeof p?.kind === 'string' ? p.kind : 'retry';
        if (kind === 'subscription') {
          toast.error(message, { duration: 9000, id: 'scheduled-notice', icon: '💳' });
        } else if (kind === 'no_chip') {
          toast(message, { duration: 7500, id: 'scheduled-notice', icon: '📶' });
        } else {
          toast(message, { duration: 7000, id: 'scheduled-notice', icon: '⏰' });
        }
        setSystemLogs((prev) =>
          [
            {
              timestamp: new Date().toISOString(),
              event: `scheduled:${p?.kind || 'notice'}`,
              payload: {
                message,
                campaignId: typeof p?.campaignId === 'string' ? p.campaignId : ''
              }
            },
            ...prev
          ].slice(0, 200)
        );
      }
    );

    socket.on(
      'send-message-error',
      ({ error, conversationId }: { error?: string; conversationId?: string }) => {
        if (conversationId) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    messages: (c.messages || []).filter((m) => !String(m.id).startsWith('pending-'))
                  }
                : c
            )
          );
        }
        const now = Date.now();
        const minGapMs = 8000;
        if (now - sendMessageErrorToastAtRef.current < minGapMs) return;
        sendMessageErrorToastAtRef.current = now;
        toast.error(error || 'Falha ao enviar mensagem.', { id: 'send-message-error', duration: 6000 });
      }
    );

    socket.on('socket-operation-error', (p: { op?: string; error?: string }) => {
      const msg = p?.error || 'Operação falhou. Tente de novo.';
      const now = Date.now();
      const minGapMs = 10_000;
      if (now - socketOperationErrorToastAtRef.current < minGapMs) return;
      socketOperationErrorToastAtRef.current = now;
      if (pendingConnectionToastIdRef.current) {
        toast.dismiss(pendingConnectionToastIdRef.current);
        pendingConnectionToastIdRef.current = null;
      }
      toast.error(msg, { id: 'socket-operation-error', duration: 6500 });
    });

    socket.on('security-warning', (p: { action?: string; error?: string }) => {
      if (pendingConnectionToastIdRef.current) {
        toast.dismiss(pendingConnectionToastIdRef.current);
        pendingConnectionToastIdRef.current = null;
      }
      const base =
        typeof p?.error === 'string' && p.error.trim()
          ? p.error
          : 'Operação bloqueada por isolamento de conta.';
      const actionHint =
        typeof p?.action === 'string' && p.action.trim() ? ` (${p.action.trim()})` : '';
      toast.error(`${base}${actionHint}`, { id: 'security-warning', duration: 7000 });
    });

    socket.on('connection-deleted', ({ id }: { id?: string }) => {
      const connId = String(id || '').trim();
      if (!connId) return;
      if (pendingConnectionToastIdRef.current) {
        toast.dismiss(pendingConnectionToastIdRef.current);
        pendingConnectionToastIdRef.current = null;
      } else {
        toast.dismiss(`remove-${connId}`);
      }
      setConnections((prev) => prev.filter((c) => c.id !== connId));
      delete qrCodeByConnectionId.current[connId];
      toast.success('Conexão removida.', { id: `removed-${connId}` });
    });

    socket.on('campaign-log', (log: { timestamp: string; level: string; message: string; payload?: Record<string, unknown> }) => {
      setSystemLogs(prev => [
        {
          timestamp: log.timestamp,
          event: `campaign:${log.level.toLowerCase()}`,
          payload: { ...(log.payload || {}), message: log.message || String((log.payload as { message?: string })?.message || '') }
        },
        ...prev
      ].slice(0, 200));
      if (log.level === 'ERROR') {
        const payload = (log.payload || {}) as Record<string, unknown>;
        const toRaw = payload.to;
        const digitsOnly = typeof toRaw === 'string' ? toRaw.replace(/\D/g, '') : '';
        const looksLikeRecipientNumber = digitsOnly.length >= 8;

        if (looksLikeRecipientNumber) {
          scheduleCampaignRecipientErrorDigest(campaignRecipientErrorBurstRef);
        } else {
          const clip = typeof log.message === 'string' ? log.message.slice(0, 220) : 'Erro na campanha.';
          const cid = String(payload.campaignId || '').slice(0, 64);
          const stable = `${cid}:${typeof log.message === 'string' ? log.message.slice(0, 40) : 'err'}`;
          toast.error(clip, { id: `campaign-scope:${stable}`, duration: 9000 });
        }
      }

      if (log.level === 'INFO' && log.message === 'Mensagem enviada' && log.payload?.campaignId) {
        const uid = currentUidRef.current;
        const payload = log.payload as {
          campaignId: string;
          to?: string;
          connectionId?: string;
        };
        if (uid) {
          const toRaw = payload.to;
          if (typeof toRaw === 'string' && toRaw.trim()) {
            const pkey = normPhoneKey(toRaw);
            const campaignDoc = campaignsRef.current.find((x) => x.id === payload.campaignId);
            const totalStages = getCampaignStageTotal(campaignDoc);
            const cname = String(campaignDoc?.name || 'Campanha').slice(0, 120);
            // Em vez de copiar 10k contatos e re-renderizar a cada mensagem, acumula
            // e dá flush agrupado (ver flushCampaignPreviewBuffer).
            queueCampaignPreview(pkey, payload.campaignId, cname, totalStages);
          }
        }
      }
    });

    socket.on(
      'contact-marketing-consent',
      (p: {
        campaignId: string;
        phoneDigits: string;
        effect: 'opt_in' | 'opt_out';
        replyText?: string;
        at: string;
      }) => {
        const uid = currentUidRef.current;
        if (!uid) return;
        const key = normPhoneKey(p.phoneDigits);
        setContacts((prev) => {
          const idx = prev.findIndex((c) => normPhoneKey(c.phone) === key);
          if (idx < 0) return prev;
          const c = prev[idx];
          const updates: Partial<Contact> =
            p.effect === 'opt_in'
              ? {
                  marketingConsentAt: p.at,
                  marketingConsentText: (p.replyText || '').slice(0, 500),
                  marketingOptIn: true,
                  marketingOptOut: false
                }
              : {
                  marketingConsentAt: p.at,
                  marketingConsentText: (p.replyText || '').slice(0, 500),
                  marketingOptOut: true,
                  marketingOptIn: false
                };
          void apiUpdateContact(c.id, updates).catch(() => {});
          const next = [...prev];
          next[idx] = { ...c, ...updates };
          return next;
        });
        if (p.effect === 'opt_in') {
          toast.success('Autorização de marketing registrada (lead quente).', { duration: 5000 });
        } else {
          toast('Contato na lista negra de marketing.', { icon: '🚫', duration: 6000 });
        }
      }
    );

    socket.on('system-log', (log: SystemLog) => {
      setSystemLogs(prev => [log, ...prev].slice(0, 200));
    });

    socket.on('connection-limit-exceeded', (p: { connectionId?: string; dailyLimit?: number; messagesSentToday?: number; campaignId?: string }) => {
      const id = String(p?.connectionId || '');
      const limit = Number(p?.dailyLimit) || 0;
      const sent = Number(p?.messagesSentToday) || 0;
      const name = id || 'Canal';
      toast.error(
        `Limite diário atingido: ${name} enviou ${sent}/${limit} mensagens hoje. Configure a ação de limite nas configurações do canal.`,
        { id: `limit-${id}`, duration: 10000, icon: '⚠️' }
      );
    });

    socket.on('circuit-breaker-open', (p: { connectionId?: string }) => {
      const id = String(p?.connectionId || '');
      if (!id) return;
      setCircuitBreakerOpenIds((prev) => new Set(prev).add(id));
    });

    socket.on('circuit-breaker-closed', (p: { connectionId?: string }) => {
      const id = String(p?.connectionId || '');
      if (!id) return;
      setCircuitBreakerOpenIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });

    socket.on('campaign-paused', ({ campaignId }: { campaignId: string }) => {
      flushCampaignProgressToFirestore(campaignId, true);
      const uid = currentUidRef.current;
      if (uid) patchCampaignPersist(uid, campaignId, { status: CampaignStatus.PAUSED });
      clearCampaignProgressPersist(campaignId);
      setCampaigns((prev) => {
        const next = prev.map((c) => (c.id === campaignId ? { ...c, status: CampaignStatus.PAUSED } : c));
        const u = currentUidRef.current;
        if (u) syncStuckCampaignsToFirestore(next, u);
        return healStuckRunningCampaignsList(next);
      });
      toast('Campanha pausada.', { icon: '⏸️' });
    });

    socket.on('campaign-resumed', ({ campaignId }: { campaignId: string }) => {
      flushCampaignProgressToFirestore(campaignId, true);
      const uid = currentUidRef.current;
      if (uid) patchCampaignPersist(uid, campaignId, { status: CampaignStatus.RUNNING });
      clearCampaignProgressPersist(campaignId);
      setCampaigns((prev) => {
        const next = prev.map((c) => (c.id === campaignId ? { ...c, status: CampaignStatus.RUNNING } : c));
        const u = currentUidRef.current;
        if (u) syncStuckCampaignsToFirestore(next, u);
        return healStuckRunningCampaignsList(next);
      });
      toast('Campanha retomada!', { icon: '▶️' });
    });

    /** Ao voltar ao separador/desktop: reconectar se o browser suspendeu o WS; depois pedir sync. */
    let lastConvResyncMs = 0;
    let lastReconnectNudgeMs = 0;
    const onVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (!socket.connected) {
        if (now - lastReconnectNudgeMs < 1200) return;
        lastReconnectNudgeMs = now;
        void getSessionIdToken(false)
          .then((token) => {
            (socket as Socket & { auth: { token?: string } }).auth = token ? { token } : {};
            if (!socket.connected) socket.connect();
          })
          .catch(() => {
            if (!socket.connected) socket.connect();
          });
        return;
      }
      if (now - lastConvResyncMs < 4500) return;
      lastConvResyncMs = now;
      socket.emit('request-conversations-sync');
    };
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
      resetCampaignRecipientErrorBurst(campaignRecipientErrorBurstRef);
      if (conversationsSocketRafRef.current != null) {
        cancelAnimationFrame(conversationsSocketRafRef.current);
        conversationsSocketRafRef.current = null;
      }
      conversationsSocketPendingRef.current = null;
      if (campaignProgressSocketRafRef.current != null) {
        cancelAnimationFrame(campaignProgressSocketRafRef.current);
        campaignProgressSocketRafRef.current = null;
      }
      if (
        Object.keys(campaignProgressSocketPendingRef.current).length > 0 ||
        campaignProgressBarPendingRef.current != null
      ) {
        flushCampaignProgressSocketFromRefsRef.current();
      }
      Object.values(campaignProgressPersistRef.current).forEach((entry) => {
        if (entry.timer) clearTimeout(entry.timer);
      });
      campaignProgressPersistRef.current = {};
      if (disconnectToastTimerRef.current) {
        clearTimeout(disconnectToastTimerRef.current);
        disconnectToastTimerRef.current = null;
      }
      if (offlineBadgeDelayRef.current) {
        clearTimeout(offlineBadgeDelayRef.current);
        offlineBadgeDelayRef.current = null;
      }
      clearInterval(pingInterval);
      clearInterval(stuckConnectingSyncInterval);
      clearInterval(stuckQrPollInterval);
      for (const t of bootstrapSyncTimers) clearTimeout(t);
      bootstrapSyncTimers.length = 0;
      flushCampaignPreviewBuffer();
      socket.io.off('reconnect', onManagerReconnect);
      socket.disconnect();
      socketRef.current = null;
      setSocketForShell(null);
    };
  }, [syncStuckCampaignsToFirestore, effectiveWorkspaceUid, workspaceLoading, sessionUser?.uid]);

  /** Hidrata canais após auth + workspace — não depender só do primeiro socket.connect. */
  useEffect(() => {
    if (!sessionUser?.uid || workspaceLoading) return;
    const dataUid = effectiveWorkspaceUid ?? sessionUser.uid;
    currentUidRef.current = dataUid;

    const runSync = () => void syncConnectionsFromApiRef.current();
    runSync();
    const t1 = window.setTimeout(runSync, 1500);
    const t2 = window.setTimeout(runSync, 5000);

    const sock = socketRef.current;
    if (sock && !sock.connected) {
      void getSessionIdToken().then((token) => {
        if (!token) return;
        sock.auth = { token };
        if (!sock.connected) sock.connect();
      });
    }

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [effectiveWorkspaceUid, workspaceLoading, sessionUser?.uid]);

  // --- ACTIONS ---
  const waitForSocketConnected = (timeoutMs: number) =>
    new Promise<void>((resolve, reject) => {
      const sock = socketRef.current;
      if (!sock) {
        reject(new Error('Socket nao inicializado.'));
        return;
      }
      if (sock.connected) {
        resolve();
        return;
      }
      const t = window.setTimeout(() => {
        cleanup();
        reject(new Error('Tempo esgotado ao conectar ao servidor.'));
      }, timeoutMs);
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(t);
        sock.off('connect', onConnect);
      };
      sock.on('connect', onConnect);
    });

  const refreshSocketAuthToken = async (forceRefresh = false) => {
    const sock = socketRef.current;
    if (!sock) return;
    try {
      const token = await getSessionIdToken(forceRefresh);
      (sock as Socket & { auth: { token?: string } }).auth = token ? { token } : {};
    } catch {
      (sock as Socket & { auth: { token?: string } }).auth = {};
    }
  };

  const addConnection = async (
    name: string,
    proxy?: { host: string; port: string | number; protocol?: string; username?: string; password?: string }
  ) => {
    const sock = socketRef.current;
    if (!sock) {
      toast.error('Socket nao pronto. Atualize a pagina.');
      return;
    }
    try {
      await refreshSocketAuthToken();
      if (!sock.connected) {
        sock.connect();
      }
      await waitForSocketConnected(20000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao conectar ao servidor.';
      toast.error(msg);
      return;
    }
    sock.emit('ui-log', { action: 'create-connection', name, hasProxy: Boolean(proxy?.host) });
    sock.emit('create-connection', { name, proxy });
  };

  const setConnectionProxy = async (
    id: string,
    proxy: { host: string; port: string | number; protocol?: string; username?: string; password?: string } | null
  ) => {
    const sock = socketRef.current;
    if (!sock) {
      toast.error('Socket nao pronto. Atualize a pagina.');
      return;
    }
    sock.emit('set-connection-proxy', { id, proxy });
  };

  const removeConnection = (id: string) => {
    const sock = socketRef.current;
    if (!sock) {
      toast.error('Socket nao pronto. Atualize a pagina.');
      return;
    }
    sock.emit('ui-log', { action: 'delete-connection', id });
    const toastId = `remove-${id}`;
    pendingConnectionToastIdRef.current = toastId;
    toast.loading('Removendo canal...', { id: toastId });
    sock.emit('delete-connection', { id });
  };

  const updateConnectionStatus = (id: string, status: ConnectionStatus) => {
    setConnections(prev => prev.map(c => c.id === id ? { ...c, status } : c));
  };

  const reconnectConnection = async (id: string) => {
    const sock = socketRef.current;
    if (!sock) {
      toast.error('Socket nao pronto. Atualize a pagina.');
      return;
    }
    try {
      await refreshSocketAuthToken();
      if (!sock.connected) sock.connect();
      await waitForSocketConnected(20000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao conectar ao servidor.';
      toast.error(msg);
      return;
    }
    sock.emit('ui-log', { action: 'reconnect-connection', id });
    sock.emit('reconnect-connection', { id });
    toast('Tentando reconectar...', { icon: '🔄' });
  };

  const forceQr = async (id: string) => {
    const sock = socketRef.current;
    if (!sock) {
      toast.error('Socket nao pronto. Atualize a pagina.');
      return;
    }
    try {
      await refreshSocketAuthToken();
      if (!sock.connected) sock.connect();
      await waitForSocketConnected(20000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao conectar ao servidor.';
      toast.error(msg);
      return;
    }
    sock.emit('ui-log', { action: 'force-qr', id });
    sock.emit('force-qr', { id });
    toast('Forcando novo QR...', { icon: '🧩' });
  };

  const renameConnection = async (id: string, name: string) => {
    const sock = socketRef.current;
    if (!sock) {
      toast.error('Socket nao pronto. Atualize a pagina.');
      return;
    }
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      toast.error('Nome inválido.');
      return;
    }
    if (trimmed.length > 60) {
      toast.error('Nome muito longo (máx 60).');
      return;
    }
    setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
    try {
      await refreshSocketAuthToken();
      if (!sock.connected) sock.connect();
      await waitForSocketConnected(20000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao conectar ao servidor.';
      toast.error(msg);
      return;
    }
    sock.emit('ui-log', { action: 'rename-connection', id, name: trimmed });
    sock.emit('rename-connection', { id, name: trimmed });
    toast.success('Nome atualizado.');
  };

  const updateConnectionSettings = async (id: string, settings: any) => {
    const sock = socketRef.current;
    if (!sock) {
      toast.error('Socket nao pronto. Atualize a pagina.');
      return;
    }
    // Otimista: atualiza o estado local das conexões imediatamente
    setConnections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...settings } : c))
    );
    try {
      await refreshSocketAuthToken();
      if (!sock.connected) sock.connect();
      await waitForSocketConnected(20000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao conectar ao servidor.';
      toast.error(msg);
      return;
    }
    sock.emit('ui-log', { action: 'update-connection-settings', id, settings });
    sock.emit('update-connection-settings', { id, settings });
    toast.success('Configurações salvas.');
  };

  const addContact = async (contact: Contact, options?: { silent?: boolean }) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para adicionar contato.');
    const { id, ...payload } = contact;
    const newId = await apiCreateContact(payload);
    await reloadVpsContactsRef.current();
    void refreshContactsSavedTotal();
    if (!options?.silent) toast.success('Contato adicionado com sucesso!');
    return newId;
  };

  const bulkAddContacts = async (
    contactRows: Contact[],
    options?: { silent?: boolean; skipReload?: boolean }
  ) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para adicionar contato.');
    if (contactRows.length === 0) return [];
    const payloads = contactRows.map(({ id: _d, ...rest }) => rest);
    const ids = await apiBulkCreateContacts(payloads);
    if (options?.skipReload) {
      setContacts((prev) => {
        const created = contactRows.map((row, i) => ({
          ...row,
          id: ids[i] || row.id
        }));
        const merged = [...prev, ...created].sort((a, b) =>
          (a.name || '').localeCompare(b.name || '', 'pt-BR')
        );
        contactsVpsOffsetRef.current = merged.length;
        return merged;
      });
      setContactsSavedTotal((t) => (t != null ? t + contactRows.length : t));
      setContactsHasMore((prev) => prev || contactRows.length > 0);
    } else {
      await reloadVpsContactsRef.current();
      void refreshContactsSavedTotal();
    }
    if (!options?.silent && contactRows.length > 0) {
      toast.success(`${contactRows.length} contato(s) gravados em lote.`);
    }
    return ids;
  };

  const removeContact = async (id: string, options?: { silent?: boolean }) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para remover contato.');
    await apiDeleteContact(id);
    await reloadVpsContactsRef.current();
    void refreshContactsSavedTotal();
    if (!options?.silent) toast.success('Contato removido.');
  };

  const updateContact = async (
    id: string,
    updates: Partial<Contact>,
    options?: { silent?: boolean; assumeUserDoc?: boolean }
  ) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para atualizar contato.');
    await apiUpdateContact(id, updates);
    await reloadVpsContactsRef.current();
    if (!options?.silent) toast.success('Contato atualizado com sucesso!');
  };

  const bulkUpdateContacts = async (
    items: Array<{ id: string; updates: Partial<Contact> }>,
    options?: { silent?: boolean; skipReload?: boolean }
  ) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para atualizar contato.');
    if (items.length === 0) return;
    await apiBulkUpdateContacts(items);
    if (options?.skipReload) {
      const patchById = new Map(items.map((i) => [i.id, i.updates]));
      setContacts((prev) =>
        prev.map((c) => {
          const patch = patchById.get(c.id);
          return patch ? { ...c, ...patch } : c;
        })
      );
    } else {
      await reloadVpsContactsRef.current();
    }
    if (!options?.silent) toast.success('Contatos atualizados.');
  };

  const refreshContacts = async () => {
    await reloadVpsContactsRef.current();
    void refreshContactsSavedTotal();
  };

  const clearAllUserData = async () => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para limpar os dados.');

    // Escopo estritamente do usuário logado: apenas em users/{uid}/...
    // Mantemos a limpeza resiliente a regras de permissão por coleção.
    let hadAnySuccess = false;
    const errors: string[] = [];
    const summary = {
      contacts: 0,
      contactLists: 0,
      campaigns: 0,
      campaignLogs: 0,
      errors: 0
    };

    try {
      const cleared = await apiClearTenantContactsData();
      summary.contacts = cleared.contacts;
      summary.contactLists = cleared.contactLists;
      hadAnySuccess = true;
    } catch (err: unknown) {
      errors.push(`vps/contacts-data: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      summary.campaigns = await apiDeleteAllCampaigns();
      hadAnySuccess = true;
    } catch (err: unknown) {
      errors.push(`vps/campaigns: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!hadAnySuccess && errors.length > 0) {
      throw new Error('Permissão insuficiente para limpar os dados deste usuário.');
    }
    summary.errors = errors.length;

    // Limpa estado local imediatamente para refletir a ação na UI sem atraso.
    setContacts([]);
    setContactLists([]);
    setCampaigns([]);
    setConnections([]);
    setConversations([]);
    setBirthdays([]);
    setSystemLogs([]);
    setWarmupQueue([]);
    setWarmedCount(0);
    setMetrics(INITIAL_METRICS);
    setCampaignStatus({ isRunning: false, total: 0, processed: 0, success: 0, failed: 0 });
    setFunnelStats(INITIAL_FUNNEL);
    setCampaignGeo(INITIAL_CAMPAIGN_GEO);
    setWarmupChipStats({});
    stopWarmupTimer();

    // Limpa preferências locais ligadas ao workspace atual do usuário.
    const storageKeys = [
      'zapmass_settings',
      'zapmass.contactsFilter',
      'zapmass.pendingCampaignDraft',
      'zapmass.openChatByPhone',
      'zapmass.warmup.state'
    ];
    for (const key of storageKeys) {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    void refreshContactsSavedTotal();
    return summary;
  };

  /**
   * Acrescenta IDs à lista em `users/{uid}/contact_lists` com transação (merge lido + novo).
   * Não usa mais `contact_lists` na raiz: em produção as regras bloqueiam cliente nesse path e o
   * fallback fazia `updateDoc` falhar ou gravar onde a UI não lê — parecia “não salvou na lista”.
   */
  const appendContactIdsToContactList = async (
    listId: string,
    ids: string[],
    options?: { notesLine?: string }
  ): Promise<void> => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para atualizar lista.');
    const uniq = [...new Set(ids.filter(Boolean))];
    if (uniq.length === 0 && !options?.notesLine) return;

    const CHUNK = 2500;
    for (let i = 0; i < uniq.length; i += CHUNK) {
      const chunk = uniq.slice(i, i + CHUNK);
      const isLast = i + CHUNK >= uniq.length;
      await apiAppendContactIdsToList(listId, chunk, {
        notesLine: isLast ? options?.notesLine : undefined
      });
    }
    if (uniq.length === 0 && options?.notesLine) {
      await apiAppendContactIdsToList(listId, [], { notesLine: options.notesLine });
    }
    await reloadVpsContactListsRef.current();
  };

  const createContactList = async (name: string, contactIds: string[], description?: string): Promise<string> => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para criar lista.');
    const uniqIds = [...new Set(contactIds.filter(Boolean))];
    const listId = await apiCreateContactList({
      name,
      contactIds: uniqIds,
      description: description || '',
      createdAt: new Date().toISOString()
    });
    await reloadVpsContactListsRef.current();
    return listId;
  };

  const deleteContactList = async (id: string) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para remover lista.');
    await apiDeleteContactList(id);
    await reloadVpsContactListsRef.current();
  };

  const updateContactList = async (id: string, updates: Partial<ContactList>) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para atualizar lista.');
    await apiUpdateContactList(id, updates);
    await reloadVpsContactListsRef.current();
  };

  const sendMessage = (conversationId: string, text: string) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    const nowMs = Date.now();
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== conversationId) return c;
        const pendingId = `pending-${nowMs}`;
        const optimistic = {
          id: pendingId,
          text: trimmed,
          timestamp: new Date(nowMs).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
          }),
          sender: 'me' as const,
          status: 'pending' as const,
          type: 'text' as const,
          timestampMs: nowMs
        };
        const msgs = [...(c.messages || []), optimistic];
        return {
          ...c,
          messages: msgs,
          lastMessage: trimmed,
          lastMessageTime: optimistic.timestamp,
          lastMessageTimestamp: nowMs
        };
      })
    );
    socketRef.current?.emit('ui-log', { action: 'send-message', conversationId });
    socketRef.current?.emit('send-message', { conversationId, text: trimmed });
  };

  const sendMedia = (
    conversationId: string,
    payload: {
      dataBase64: string;
      mimeType: string;
      fileName: string;
      caption?: string;
      sendMediaAsDocument?: boolean;
    }
  ): Promise<{ ok: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket) {
        resolve({ ok: false, error: 'Sem conexao com servidor.' });
        return;
      }
      // WA Web faz upload para a Meta; em ficheiros grandes (~100–200 MB) ou uplink
      // fraco na VPS o ack pode demorar bem mais que alguns minutos.
      let done = false;
      const b64len = typeof payload.dataBase64 === 'string' ? payload.dataBase64.length : 0;
      const approxMb = Math.max(0.05, ((b64len * 3) / 4 / (1024 * 1024)) || 0);
      let TIMEOUT_MS = 10 * 60 * 1000;
      if (approxMb >= 150) TIMEOUT_MS = 120 * 60 * 1000;
      else if (approxMb >= 100) TIMEOUT_MS = 95 * 60 * 1000;
      else if (approxMb >= 60) TIMEOUT_MS = 75 * 60 * 1000;
      else if (approxMb >= 35) TIMEOUT_MS = 55 * 60 * 1000;
      else if (approxMb >= 15) TIMEOUT_MS = 28 * 60 * 1000;
      if (payload.sendMediaAsDocument === true) {
        TIMEOUT_MS = Math.round(TIMEOUT_MS * 1.2);
      }
      TIMEOUT_MS = Math.min(TIMEOUT_MS, 130 * 60 * 1000);

      let timer: ReturnType<typeof setTimeout>;
      const finish = (r: { ok: boolean; error?: string }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      };
      const waitMin = Math.round(TIMEOUT_MS / 60000);
      timer = setTimeout(() => {
        finish({
          ok: false,
          error:
            `Tempo esgotado (${waitMin} min): não houve confirmação do WhatsApp a tempo. ` +
            'Ficheiros grandes ou rede lenta podem precisar de mais tempo — comprima o vídeo, melhore o uplink da VPS ou envie pelo telemóvel.'
        });
      }, TIMEOUT_MS);
      socket.emit('send-media', { conversationId, ...payload }, (resp?: { ok: boolean; error?: string }) => {
        finish(resp || { ok: false, error: 'Sem resposta do servidor.' });
      });
    });
  };

  const markAsRead = (conversationId: string) => {
    /**
     * Atualizacao otimista: zera o badge ja, sem esperar o servidor responder.
     * Evita o caso "abro a conversa mas o nao-lido continua" enquanto o
     * `conversations-update` nao chega de volta.
     */
    setConversations((prev) => {
      let touched = false;
      const next = prev.map((c) => {
        if (c.id === conversationId && c.unreadCount > 0) {
          touched = true;
          return { ...c, unreadCount: 0 };
        }
        return c;
      });
      return touched ? next : prev;
    });
    socketRef.current?.emit('ui-log', { action: 'mark-as-read', conversationId });
    socketRef.current?.emit('mark-as-read', { conversationId });
  };

  const patchConversationInboxClaim = (conversationId: string, inboxClaimedByAuthUid: string | undefined) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== conversationId) return c;
        if (inboxClaimedByAuthUid == null || inboxClaimedByAuthUid === '') {
          const { inboxClaimedByAuthUid: _drop, ...rest } = c;
          return rest as Conversation;
        }
        return { ...c, inboxClaimedByAuthUid };
      })
    );
  };

  const fetchConversationPicture = (conversationId: string) => {
    socketRef.current?.emit('fetch-conversation-picture', { conversationId });
  };

  const loadChatHistory = (
    conversationId: string,
    limit: number = 500,
    includeMedia: boolean = false
  ): Promise<{ ok: boolean; total: number; error?: string }> => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket) {
        resolve({ ok: false, total: 0, error: 'Sem conexao com servidor.' });
        return;
      }
      // Antes a Promise nunca resolvia se o callback do servidor nao
      // chegava (worker offline, socket morto), travando o ChatTab em
      // historyLoading. Agora cai em timeout apos 60s.
      let settled = false;
      const finish = (resp: { ok: boolean; total: number; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(resp);
      };
      const timeoutId = setTimeout(() => {
        finish({ ok: false, total: 0, error: 'Tempo esgotado ao carregar historico.' });
      }, 120_000);
      socket.emit(
        'load-chat-history',
        { conversationId, limit, includeMedia },
        (resp?: { ok: boolean; total: number; error?: string }) => {
          finish(resp || { ok: false, total: 0, error: 'Sem resposta.' });
        }
      );
    });
  };

  const hydrateFirestoreChatArchive = (
    conversationId: string,
    limit: number = 400
  ): Promise<{ ok: boolean; total: number; error?: string }> => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket) {
        resolve({ ok: false, total: 0, error: 'Sem conexao com servidor.' });
        return;
      }
      socket.emit(
        'hydrate-firestore-chat-archive',
        { conversationId, limit },
        (resp?: { ok: boolean; total: number; error?: string }) => {
          resolve(resp || { ok: false, total: 0, error: 'Sem resposta.' });
        }
      );
    });
  };

  const loadMessageMedia = (
    conversationId: string,
    messageId: string
  ): Promise<{ ok: boolean; mediaUrl?: string; error?: string }> => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket) {
        resolve({ ok: false, error: 'Sem conexao com servidor.' });
        return;
      }
      socket.emit(
        'load-message-media',
        { conversationId, messageId },
        (resp?: { ok: boolean; mediaUrl?: string; error?: string }) => {
          resolve(resp || { ok: false, error: 'Sem resposta.' });
        }
      );
    });
  };

  const loadMoreInbox = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || inboxLoadingMore || !inboxHasMore) return;
    setInboxLoadingMore(true);
    socket.emit(
      'request-inbox-page',
      { cursor: inboxNextCursorRef.current },
      () => {
        setInboxLoadingMore(false);
      }
    );
  }, [inboxHasMore, inboxLoadingMore]);

  const deleteLocalConversations = (conversationIds: string[]): Promise<number> => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket || conversationIds.length === 0) {
        resolve(0);
        return;
      }
      socket.emit('delete-local-conversations', { conversationIds }, (resp?: { ok: boolean; removed: number }) => {
        const removed = resp?.removed ?? 0;
        if (resp?.ok && removed > 0) {
          toast.success(`${removed} conversa${removed === 1 ? '' : 's'} removida${removed === 1 ? '' : 's'} do painel.`);
        } else if (resp && !resp.ok) {
          toast.error('Nao foi possivel remover as conversas.');
        }
        resolve(removed);
      });
    });
  };

  const pauseCampaign = (campaignId: string) => {
    setCampaigns((prev) => {
      const next = prev.map((c) =>
        c.id === campaignId ? { ...c, status: CampaignStatus.PAUSED } : c
      );
      const u = currentUidRef.current;
      if (u) {
        patchCampaignPersist(u, campaignId, { status: CampaignStatus.PAUSED });
      }
      return next;
    });
    setCampaignStatus((s) => ({ ...s, isRunning: false }));
    socketRef.current?.emit('pause-campaign', { campaignId });
  };

  const resumeCampaign = (campaignId: string) => {
    setCampaigns((prev) => {
      const camp = prev.find((c) => c.id === campaignId);
      let nextStatus = CampaignStatus.RUNNING;
      if (camp && isConversationalMultiStepCampaign(camp)) {
        const planned = getCampaignPlannedSendTotal(camp);
        const processed = camp.processedCount ?? 0;
        if (planned > 0 && processed >= planned) {
          nextStatus = CampaignStatus.WAITING_REPLY;
        }
      }
      const next = prev.map((c) =>
        c.id === campaignId ? { ...c, status: nextStatus } : c
      );
      const u = currentUidRef.current;
      if (u) {
        patchCampaignPersist(u, campaignId, { status: nextStatus });
      }
      return next;
    });
    setCampaignStatus((s) => ({ ...s, isRunning: true }));
    socketRef.current?.emit('resume-campaign', { campaignId });
  };

  const deleteCampaign = async (campaignId: string) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para remover campanha.');
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (campaign?.status === CampaignStatus.RUNNING) {
      socketRef.current?.emit('pause-campaign', { campaignId });
    }
    await purgeCampaignForUser(uid, campaignId);
    setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
    void reloadVpsCampaignsRef.current();
    toast.success('Campanha removida.');
  };

  const deleteCampaigns = async (campaignIds: string[]) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para remover campanhas.');
    if (campaignIds.length === 0) return;
    for (const id of campaignIds) {
      const campaign = campaigns.find((c) => c.id === id);
      if (campaign?.status === CampaignStatus.RUNNING) {
        socketRef.current?.emit('pause-campaign', { campaignId: id });
      }
    }

    const removed = new Set<string>();
    const failures: string[] = [];

    if (campaignIds.length > 1) {
      try {
        const { deleted, missing } = await apiBulkDeleteCampaigns(campaignIds);
        for (const id of deleted) removed.add(id);
        for (const id of missing) {
          try {
            await purgeCampaignForUser(uid, id);
            removed.add(id);
          } catch {
            failures.push(id);
          }
        }
      } catch (bulkErr) {
        if (!isCampaignApiDeleteRetryable(bulkErr)) throw bulkErr;
        for (const id of campaignIds) {
          try {
            await purgeCampaignForUser(uid, id);
            removed.add(id);
          } catch {
            failures.push(id);
          }
        }
      }
    } else {
      for (const id of campaignIds) {
        try {
          await purgeCampaignForUser(uid, id);
          removed.add(id);
        } catch {
          failures.push(id);
        }
      }
    }

    if (removed.size === 0) {
      throw new Error(
        failures.length > 0
          ? 'Nenhuma campanha pôde ser removida. Atualize a página e tente de novo.'
          : 'Nenhuma campanha selecionada.'
      );
    }

    setCampaigns((prev) => prev.filter((c) => !removed.has(c.id)));
    void reloadVpsCampaignsRef.current();

    if (failures.length > 0) {
      toast.error(`${failures.length} campanha(s) não foram removidas.`);
    }
    toast.success(
      `${removed.size} campanha${removed.size > 1 ? 's removidas' : ' removida'}.`
    );
  };

  const markWarmupReady = (numbers: string[]) => {
    if (!numbers || numbers.length === 0) return;
    socketRef.current?.emit('warmup-marked', { numbers });
  };

  const clearFunnelStats = () => {
    socketRef.current?.emit('clear-funnel-stats');
    toast.success('Funil zerado.');
  };

  const clearWarmupChipStats = (connectionId?: string) => {
    socketRef.current?.emit('clear-warmup-chip-stats', connectionId);
    toast.success(connectionId ? 'Histórico deste chip zerado.' : 'Histórico de aquecimento zerado.');
  };

  const startCampaign = async (
    sessionId: string,
    numbers: string[],
    message: string,
    connectionIds?: string[],
    contactListMeta?: { id?: string; name?: string },
    campaignName?: string,
    options?: {
      delaySeconds?: number;
      recipients?: Array<{ phone: string; vars: Record<string, string> }>;
      messageStages?: string[];
      replyFlow?: CampaignReplyFlow;
      channelWeights?: Record<string, number>;
      mediaAttachment?: {
        dataBase64: string;
        mimeType: string;
        fileName: string;
        sendMediaAsDocument?: boolean;
      };
      followUpMediaAttachment?: {
        dataBase64: string;
        mimeType: string;
        fileName: string;
        sendMediaAsDocument?: boolean;
      };
    }
  ) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para iniciar campanha.');
    const targetConnections = connectionIds || [sessionId];
    const socket = socketRef.current;
    if (!socket) {
      throw new Error('Socket nao pronto. Atualize a pagina.');
    }
    try {
      // Token fresco + espera de reconexao (evita addDoc+timeout quando o socket caiu).
      await refreshSocketAuthToken(true);
      if (!socket.connected) {
        socket.connect();
      }
      await waitForSocketConnected(20000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao conectar ao servidor.';
      throw new Error(msg);
    }

    // Verificar Redis antes de iniciar: evita "Tempo esgotado ao enfileirar" surpresa.
    try {
      const redisCheck = await fetch('/api/health/redis', { signal: AbortSignal.timeout(6000) });
      if (!redisCheck.ok) {
        const body = await redisCheck.json().catch(() => ({})) as { error?: string };
        throw new Error(
          body.error ||
          'Redis indisponível na VPS. O disparo não pode ser iniciado. Verifique o container Redis.'
        );
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('Redis')) throw e;
      // Timeout ou falha de rede — não bloqueia (servidor pode estar iniciando)
      console.warn('[startMassCampaign] Redis health-check falhou (continuando):', e);
    }

    const cleanNumbers = Array.from(
      new Set(
        numbers
          .map(number => number.replace(/\D/g, ''))
          .filter(number => number.length >= 10)
      )
    );

    if (cleanNumbers.length === 0) {
      throw new Error('Nenhum numero valido foi encontrado para o disparo.');
    }

    const stagesForDoc =
      options?.messageStages && options.messageStages.length > 0
        ? options.messageStages.map((s) => String(s || '').trim()).filter((s) => s.length > 0)
        : [message.trim()].filter((s) => s.length > 0);

    const campaignPayload = {
      ownerUid: uid,
      name: campaignName || `Disparo ${new Date().toLocaleString()}`,
      message: stagesForDoc[0] || message,
      ...(stagesForDoc.length > 0 ? { messageStages: stagesForDoc } : {}),
      ...(options?.replyFlow?.enabled ? { replyFlow: options.replyFlow } : {}),
      totalContacts: cleanNumbers.length,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      status: CampaignStatus.DRAFT,
      selectedConnectionIds: targetConnections,
      contactListId: contactListMeta?.id || '',
      contactListName: contactListMeta?.name || '',
      delaySeconds: options?.delaySeconds,
      ...(options?.channelWeights && Object.keys(options.channelWeights).length > 0
        ? { channelWeights: options.channelWeights }
        : {}),
      createdAt: new Date().toISOString()
    };

    const campaignIdCreated = await Promise.race([
      apiCreateCampaign(campaignPayload),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Tempo esgotado ao salvar a campanha. Verifique sua conexão e tente de novo.')),
          20_000
        )
      )
    ]);
    void reloadVpsCampaignsRef.current();
    const campaignRef = { id: campaignIdCreated };

    try {
      const ackTimeoutMs = startCampaignAckTimeoutMs(
        options?.mediaAttachment || options?.followUpMediaAttachment,
        targetConnections.length
      );
      const response = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        let done = false;
        const finish = (payload: { ok: boolean; error?: string }) => {
          if (done) return;
          done = true;
          socket.off('campaign-started', onStarted);
          socket.off('campaign-error', onError);
          clearTimeout(timeoutId);
          resolve(payload);
        };

        const onStarted = (data: { campaignId?: string }) => {
          if (data?.campaignId === campaignRef.id) {
            finish({ ok: true });
          }
        };

        const onError = (data: { campaignId?: string; error?: string }) => {
          // Antes: !campaignId fazia QUALQUER campaign-error global cancelar
          // o disparo em curso, gerando falsos positivos. Agora so cancela
          // se o ID bater explicitamente.
          if (data?.campaignId === campaignRef.id) {
            finish({ ok: false, error: data?.error || 'Falha ao iniciar campanha.' });
          }
        };

        const timeoutId = setTimeout(() => {
          finish({ ok: false, error: START_CAMPAIGN_ACK_TIMEOUT_MESSAGE });
        }, ackTimeoutMs);

        socket.on('campaign-started', onStarted);
        socket.on('campaign-error', onError);

        // Emite com callback opcional (quando disponível no backend), mas sem depender dele.
        const cleanRecipients = options?.recipients
          ? options.recipients
              .map(r => ({ phone: r.phone.replace(/\D/g, ''), vars: r.vars || {} }))
              .filter(r => r.phone.length >= 10)
          : undefined;

        socket.emit(
          'start-campaign',
          {
            numbers: cleanNumbers,
            message: stagesForDoc[0] || message,
            messageStages: stagesForDoc,
            replyFlow: options?.replyFlow?.enabled ? options.replyFlow : undefined,
            connectionIds: targetConnections,
            campaignId: campaignRef.id,
            delaySeconds: options?.delaySeconds,
            recipients: cleanRecipients,
            channelWeights: options?.channelWeights,
            mediaAttachment: options?.mediaAttachment,
            followUpMediaAttachment: options?.followUpMediaAttachment
          },
          (result?: { ok?: boolean; error?: string }) => {
            if (result?.ok === true) {
              finish({ ok: true });
              return;
            }
            if (result?.ok === false) {
              finish({ ok: false, error: result.error || 'Falha ao iniciar campanha.' });
            }
          }
        );
      });

      if (!response.ok) {
        const timedOut = response.error === START_CAMPAIGN_ACK_TIMEOUT_MESSAGE;
        if (timedOut) {
          await reloadVpsCampaignsRef.current();
          const confirmed = await confirmCampaignStartedViaApi(campaignRef.id);
          if (confirmed) {
            await reloadVpsCampaignsRef.current();
          } else {
            throw new Error(START_CAMPAIGN_ACK_TIMEOUT_MESSAGE);
          }
        } else {
          throw new Error(response.error || 'Falha ao iniciar campanha.');
        }
      }

      socket.emit('ui-log', {
        action: 'start-campaign',
        campaignId: campaignRef.id,
        total: cleanNumbers.length * stagesForDoc.length,
        connections: targetConnections.length,
        delaySeconds: options?.delaySeconds
      });

      return campaignRef.id;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const likelyStillRunning = msg.includes('Demoramos a confirmar no servidor');
      // Rollback seguro: só apaga a campanha se confirmarmos que ela NÃO iniciou
      // no servidor. Caso contrário, um erro tardio (ex.: campaign-error após jobs
      // já enfileirados) apagaria uma campanha que está enviando de verdade.
      if (!likelyStillRunning) {
        let actuallyStarted = false;
        try {
          actuallyStarted = await confirmCampaignStartedViaApi(campaignRef.id);
        } catch {
          // Não foi possível confirmar — por segurança, NÃO apaga (evita sumir
          // campanha viva). Mantém o doc; usuário pode ver/limpar na lista.
          actuallyStarted = true;
        }
        if (!actuallyStarted) {
          await apiDeleteCampaign(campaignRef.id).catch(() => {});
        }
        void reloadVpsCampaignsRef.current();
      }
      throw error;
    }
  };

  const scheduleCampaign = async (
    sessionId: string,
    numbers: string[],
    message: string,
    connectionIds: string[] | undefined,
    contactListMeta: { id?: string; name?: string } | undefined,
    campaignName: string | undefined,
    schedule: {
      timeZone: string;
      slots: CampaignScheduleSlot[];
      repeatWeekly: boolean;
      onceLocalDate?: string;
      onceLocalTime?: string;
    },
    options?: {
      delaySeconds?: number;
      recipients?: Array<{ phone: string; vars: Record<string, string> }>;
      messageStages?: string[];
      replyFlow?: CampaignReplyFlow;
      channelWeights?: Record<string, number>;
    }
  ) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para agendar campanha.');
    const targetConnections = connectionIds || [sessionId];
    const oneShotCal =
      !schedule.repeatWeekly &&
      typeof schedule.onceLocalDate === 'string' &&
      schedule.onceLocalDate.trim().length > 0 &&
      typeof schedule.onceLocalTime === 'string' &&
      schedule.onceLocalTime.trim().length > 0;
    if (!oneShotCal && schedule.slots.length === 0) {
      throw new Error('Selecione ao menos um dia e horário.');
    }
    const cleanNumbers = Array.from(
      new Set(
        numbers
          .map((number) => number.replace(/\D/g, ''))
          .filter((number) => number.length >= 10)
      )
    );
    if (cleanNumbers.length === 0) {
      throw new Error('Nenhum número válido para o disparo.');
    }
    const stagesForDoc =
      options?.messageStages && options.messageStages.length > 0
        ? options.messageStages.map((s) => String(s || '').trim()).filter((s) => s.length > 0)
        : [message.trim()].filter((s) => s.length > 0);
    if (stagesForDoc.length === 0) {
      throw new Error('Defina a mensagem da campanha.');
    }
    let nextRun: string | null = null;
    if (oneShotCal) {
      nextRun = localDateTimeToUtcIso(
        schedule.onceLocalDate!.trim(),
        schedule.onceLocalTime!.trim(),
        schedule.timeZone
      );
      if (!nextRun) {
        throw new Error('Data ou horário inválidos.');
      }
      if (Date.parse(nextRun) <= Date.now()) {
        throw new Error('Escolha uma data e horário no futuro (pelo próximo minuto ou depois).');
      }
    } else {
      nextRun = computeNextRunIso(schedule.slots, schedule.timeZone, Date.now());
      if (!nextRun) {
        throw new Error('Não foi possível calcular o próximo horário. Verifique os horários e o fuso.');
      }
    }
    const cleanRecipients = options?.recipients
      ? options.recipients
          .map((r) => ({ phone: r.phone.replace(/\D/g, ''), vars: r.vars || {} }))
          .filter((r) => r.phone.length >= 10)
      : undefined;

    const schedulePayload = {
      ownerUid: uid,
      name: campaignName || `Agendada — ${new Date().toLocaleString('pt-BR')}`,
      message: stagesForDoc[0] || message,
      ...(stagesForDoc.length > 0 ? { messageStages: stagesForDoc } : {}),
      ...(options?.replyFlow?.enabled ? { replyFlow: options.replyFlow } : {}),
      totalContacts: cleanNumbers.length,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      status: CampaignStatus.SCHEDULED,
      selectedConnectionIds: targetConnections,
      contactListId: contactListMeta?.id || '',
      contactListName: contactListMeta?.name || '',
      delaySeconds: options?.delaySeconds,
      createdAt: new Date().toISOString(),
      scheduleTimeZone: schedule.timeZone,
      weeklySchedule: { slots: schedule.slots },
      scheduleRepeatWeekly: schedule.repeatWeekly,
      ...(oneShotCal && schedule.onceLocalDate && schedule.onceLocalTime
        ? {
            scheduleOnceLocalDate: schedule.onceLocalDate.trim(),
            scheduleOnceLocalTime: schedule.onceLocalTime.trim()
          }
        : {}),
      nextRunAt: nextRun,
      scheduleStartSnapshot: {
        numbers: cleanNumbers,
        message: stagesForDoc[0] || message,
        messageStages: stagesForDoc,
        connectionIds: targetConnections,
        delaySeconds: options?.delaySeconds,
        ...(cleanRecipients && cleanRecipients.length > 0 ? { recipients: cleanRecipients } : {}),
        ...(options?.replyFlow?.enabled ? { replyFlow: options.replyFlow } : {}),
        ...(options?.channelWeights && Object.keys(options.channelWeights).length > 0
          ? { channelWeights: options.channelWeights }
          : {})
      }
    };
    const campaignId = await apiCreateCampaign(schedulePayload);
    void reloadVpsCampaignsRef.current();
    toast.success('Campanha agendada. O disparo ocorre no horário escolhido (servidor online).');
    return campaignId;
  };

  const stableAddConnection = useStableCallback(addConnection);
  const stableSetConnectionProxy = useStableCallback(setConnectionProxy);
  const stableRemoveConnection = useStableCallback(removeConnection);
  const stableUpdateConnectionStatus = useStableCallback(updateConnectionStatus);
  const stableReconnectConnection = useStableCallback(reconnectConnection);
  const stableForceQr = useStableCallback(forceQr);
  const stableRenameConnection = useStableCallback(renameConnection);
  const stableUpdateConnectionSettings = useStableCallback(updateConnectionSettings);
  const stableAddContact = useStableCallback(addContact);
  const stableBulkAddContacts = useStableCallback(bulkAddContacts);
  const stableRemoveContact = useStableCallback(removeContact);
  const stableRefreshContactsSavedTotal = useStableCallback(refreshContactsSavedTotal);
  const stableUpdateContact = useStableCallback(updateContact);
  const stableBulkUpdateContacts = useStableCallback(bulkUpdateContacts);
  const stableRefreshContacts = useStableCallback(refreshContacts);
  const stableCreateContactList = useStableCallback(createContactList);
  const stableAppendContactIdsToContactList = useStableCallback(appendContactIdsToContactList);
  const stableDeleteContactList = useStableCallback(deleteContactList);
  const stableUpdateContactList = useStableCallback(updateContactList);
  const stableSendMessage = useStableCallback(sendMessage);
  const stableSendMedia = useStableCallback(sendMedia);
  const stableMarkAsRead = useStableCallback(markAsRead);
  const stableFetchConversationPicture = useStableCallback(fetchConversationPicture);
  const stablePatchConversationInboxClaim = useStableCallback(patchConversationInboxClaim);
  const stableDeleteLocalConversations = useStableCallback(deleteLocalConversations);
  const stableLoadChatHistory = useStableCallback(loadChatHistory);
  const stableHydrateFirestoreChatArchive = useStableCallback(hydrateFirestoreChatArchive);
  const stableLoadMessageMedia = useStableCallback(loadMessageMedia);
  const stableMarkWarmupReady = useStableCallback(markWarmupReady);
  const stablePauseCampaign = useStableCallback(pauseCampaign);
  const stableResumeCampaign = useStableCallback(resumeCampaign);
  const stableDeleteCampaign = useStableCallback(deleteCampaign);
  const stableDeleteCampaigns = useStableCallback(deleteCampaigns);
  const stableStartCampaign = useStableCallback(startCampaign);
  const stableScheduleCampaign = useStableCallback(scheduleCampaign);
  const stableClearFunnelStats = useStableCallback(clearFunnelStats);
  const stableClearWarmupChipStats = useStableCallback(clearWarmupChipStats);
  const stableClearAllUserData = useStableCallback(clearAllUserData);
  const stableStartWarmupTimer = useStableCallback(startWarmupTimer);
  const stableStopWarmupTimer = useStableCallback(stopWarmupTimer);
  const stableStartAutoWarmup = useStableCallback(startAutoWarmup);
  const stableStopAutoWarmup = useStableCallback(stopAutoWarmup);

  const zapMassUiSnapshot = useMemo<ZapMassUiSnapshot>(
    () => ({
      isBackendConnected,
      backendLinkState,
      systemMetrics,
      sessionLiveStats
    }),
    [isBackendConnected, backendLinkState, systemMetrics, sessionLiveStats]
  );

  const connectionsSlice = useMemo(() => {
    const scopeUid = effectiveWorkspaceUid ?? sessionUser?.uid ?? null;
    return { connections: filterByConnectionScope(scopeUid, connections) };
  }, [connections, effectiveWorkspaceUid, sessionUser?.uid]);

  const stableLoadMoreInbox = useStableCallback(loadMoreInbox);

  const zapMassConversationsSlice = useMemo<ZapMassConversationsSlice>(
    () => ({
      conversations,
      inboxHasMore,
      inboxLoadingMore,
      inboxTotal,
      loadMoreInbox: stableLoadMoreInbox,
    }),
    [conversations, inboxHasMore, inboxLoadingMore, inboxTotal, stableLoadMoreInbox]
  );

  const zapMassCoreValue = useMemo<ZapMassCoreContextValue>(
    () => ({
      socket: socketRef.current,
      connections,
      campaigns,
      contacts,
      contactsHasMore,
      contactsLoadingMore,
      loadMoreContacts,
      loadAllContacts,
      contactsSavedTotal,
      contactsSavedTotalLoading,
      refreshContactsSavedTotal: stableRefreshContactsSavedTotal,
      refreshContacts: stableRefreshContacts,
      contactLists,
      metrics,
      birthdays,
      systemLogs,
      warmupQueue,
      warmedCount,
      isBackendConnected,
      campaignStatus,
      addConnection: stableAddConnection,
      setConnectionProxy: stableSetConnectionProxy,
      removeConnection: stableRemoveConnection,
      updateConnectionStatus: stableUpdateConnectionStatus,
      reconnectConnection: stableReconnectConnection,
      forceQr: stableForceQr,
      renameConnection: stableRenameConnection,
      updateConnectionSettings: stableUpdateConnectionSettings,
      addContact: stableAddContact,
      bulkAddContacts: stableBulkAddContacts,
      removeContact: stableRemoveContact,
      updateContact: stableUpdateContact,
      bulkUpdateContacts: stableBulkUpdateContacts,
      createContactList: stableCreateContactList,
      appendContactIdsToContactList: stableAppendContactIdsToContactList,
      deleteContactList: stableDeleteContactList,
      updateContactList: stableUpdateContactList,
      sendMessage: stableSendMessage,
      sendMedia: stableSendMedia,
      markAsRead: stableMarkAsRead,
      fetchConversationPicture: stableFetchConversationPicture,
      patchConversationInboxClaim: stablePatchConversationInboxClaim,
      deleteLocalConversations: stableDeleteLocalConversations,
      loadChatHistory: stableLoadChatHistory,
      hydrateFirestoreChatArchive: stableHydrateFirestoreChatArchive,
      loadMessageMedia: stableLoadMessageMedia,
      markWarmupReady: stableMarkWarmupReady,
      pauseCampaign: stablePauseCampaign,
      resumeCampaign: stableResumeCampaign,
      deleteCampaign: stableDeleteCampaign,
      deleteCampaigns: stableDeleteCampaigns,
      startCampaign: stableStartCampaign,
      scheduleCampaign: stableScheduleCampaign,
      funnelStats,
      clearFunnelStats: stableClearFunnelStats,
      campaignGeo,
      warmupChipStats,
      clearWarmupChipStats: stableClearWarmupChipStats,
      clearAllUserData: stableClearAllUserData,
      warmupActive,
      startWarmupTimer: stableStartWarmupTimer,
      stopWarmupTimer: stableStopWarmupTimer,
      startAutoWarmup: stableStartAutoWarmup,
      stopAutoWarmup: stableStopAutoWarmup,
      circuitBreakerOpenConnectionIds: [...circuitBreakerOpenIds].sort()
    }),
    [
      connections,
      campaigns,
      contacts,
      contactsHasMore,
      contactsLoadingMore,
      loadMoreContacts,
      loadAllContacts,
      contactsSavedTotal,
      contactsSavedTotalLoading,
      stableRefreshContactsSavedTotal,
      stableRefreshContacts,
      contactLists,
      metrics,
      birthdays,
      systemLogs,
      warmupQueue,
      warmedCount,
      isBackendConnected,
      campaignStatus,
      funnelStats,
      campaignGeo,
      warmupChipStats,
      warmupActive,
      circuitBreakerOpenIds
    ]
  );

  return (
    <ZapMassSocketContext.Provider value={socketForShell}>
      <ZapMassConnectionsSliceContext.Provider value={connectionsSlice}>
        <ZapMassUiSnapshotContext.Provider value={zapMassUiSnapshot}>
          <ZapMassConversationsContext.Provider value={zapMassConversationsSlice}>
            <ZapMassCoreContext.Provider value={zapMassCoreValue}>{children}</ZapMassCoreContext.Provider>
          </ZapMassConversationsContext.Provider>
        </ZapMassUiSnapshotContext.Provider>
      </ZapMassConnectionsSliceContext.Provider>
    </ZapMassSocketContext.Provider>
  );
};

/** Socket sem subscrever `contacts` / campanhas — use no AppShell e banners. */
export function useZapMassSocket(): Socket | null {
  return useContext(ZapMassSocketContext);
}

/** Sidebar, TopBar, banners: ignoram atualizações de conversas/contactos — menos “travar” ao sync. */
export function useZapMassUiSnapshot(): ZapMassUiSnapshot {
  const v = useContext(ZapMassUiSnapshotContext);
  if (v) return v;
  return {
    isBackendConnected: false,
    backendLinkState: 'offline',
    systemMetrics: INITIAL_SYS_METRICS,
    sessionLiveStats: null
  };
}

/** Lista de conversas/inbox isolada — `useZapMassCore()` não dispara quando o socket sincroniza o pipeline. */
export function useZapMassConversations(): Conversation[] {
  return useContext(ZapMassConversationsContext).conversations;
}

export function useZapMassInboxPagination(): Omit<ZapMassConversationsSlice, 'conversations'> {
  const slice = useContext(ZapMassConversationsContext);
  return {
    inboxHasMore: slice.inboxHasMore,
    inboxLoadingMore: slice.inboxLoadingMore,
    inboxTotal: slice.inboxTotal,
    loadMoreInbox: slice.loadMoreInbox,
  };
}

/** Resto do ZapMass sem `conversations` — usar em abas que não leem inbox (Warmup, Conexões, etc.). */
export function useZapMassCore(): ZapMassCoreContextValue {
  const core = useContext(ZapMassCoreContext);
  if (core === EMPTY_CORE) {
    devWarn('useZapMassCore usado fora do ZapMassProvider. Retornando núcleo vazio.');
  }
  return core;
}

/** Lista de chips (`connections`) sem subscrever o restante do ZapMass — para layout que só passa chips às Campanhas. */
export function useZapMassConnectionsSlice(): WhatsAppConnection[] {
  const v = useContext(ZapMassConnectionsSliceContext);
  return v?.connections ?? EMPTY_CONTEXT.connections;
}

export const useZapMass = (): ZapMassContextWithSocket => {
  const core = useContext(ZapMassCoreContext);
  const { conversations } = useContext(ZapMassConversationsContext);
  if (core === EMPTY_CORE) {
    devWarn('useZapMass usado fora do ZapMassProvider. Retornando contexto vazio.');
    return EMPTY_CONTEXT;
  }
  return useMemo(
    () => ({ ...core, conversations }),
    [core, conversations]
  );
};