import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
  useRef
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
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  orderBy,
  limit,
  startAfter,
  setDoc,
  updateDoc,
  writeBatch,
  increment,
  runTransaction,
  type QueryDocumentSnapshot,
  type DocumentData
} from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useAuth } from './AuthContext';
import { useVpsAuth } from '../services/vpsAuth';
import { useVpsData } from '../services/vpsData';
import {
  apiBulkCreateContacts,
  apiBulkUpdateContacts,
  apiClearTenantContactsData,
  apiCreateContact,
  apiCreateContactList,
  apiDeleteContact,
  apiDeleteContactList,
  apiUpdateContact,
  apiUpdateContactList,
  fetchContactLists,
  fetchContacts,
  fetchContactsCount
} from '../services/contactsApi';
import {
  apiCreateCampaign,
  apiDeleteAllCampaigns,
  apiDeleteCampaign,
  apiUpdateCampaign,
  fetchCampaigns
} from '../services/campaignsApi';
import { getSessionIdToken } from '../utils/sessionAuth';
import { auth, db } from '../services/firebase';
import { useWorkspace } from './WorkspaceContext';
import { ownsConnectionForUid } from '../utils/connectionScope';
import {
  mergeConnectionStatus,
  mergeWhatsAppConnectionLists
} from '../utils/connectionStateMerge';
import { apiUrl, getSocketIoOrigin, isLikelySplitStaticFrontend } from '../utils/apiBase';
import { MAX_CHANNELS_TOTAL } from '../utils/connectionLimitPolicy';
import { openChannelExtraPurchaseFlow } from '../utils/openChannelExtraFlow';
import { mergeCampaigns, mergeContactLists, mergeContacts } from '../utils/mergeLegacyUserDocs';
import {
  getCampaignProgressMetrics,
  healStuckRunningCampaignsList,
  isRunningStatusButWorkComplete
} from '../utils/campaignMetrics';
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

const FIRESTORE_BATCH_CHUNK = 280;

/** Persiste subcoleção campaignDeliveries + resumo no documento do contato (coluna da lista). */
async function persistCampaignDeliveryAndPreview(
  uid: string,
  contactId: string,
  campaignId: string,
  campaignsSnapshot: Campaign[]
): Promise<void> {
  const campaignDoc = campaignsSnapshot.find((x) => x.id === campaignId);
  const totalStages = getCampaignStageTotal(campaignDoc);
  const cname = String(campaignDoc?.name || 'Campanha').slice(0, 200);
  const delRef = doc(db, 'users', uid, 'contacts', contactId, 'campaignDeliveries', campaignId);
  await setDoc(
    delRef,
    {
      sentCount: increment(1),
      totalStages,
      campaignName: cname,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
  const snap = await getDoc(delRef);
  const sent = Math.max(0, Math.floor(Number(snap.data()?.sentCount) || 0));
  const pending = Math.max(0, totalStages - sent);
  const contactRef = doc(db, 'users', uid, 'contacts', contactId);
  await updateDoc(contactRef, {
    campaignMessagesReceived: increment(1),
    campaignTablePreview: {
      campaignId,
      campaignName: cname.slice(0, 120),
      sent,
      totalStages,
      pending,
      updatedAt: new Date().toISOString()
    }
  } as Record<string, unknown>);
}

async function yieldToUiThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/** Mensagem quando o ACK da campanha ultrapassa o tempo — o servidor pode já ter iniciado mesmo assim. */
const START_CAMPAIGN_ACK_TIMEOUT_MESSAGE =
  'Demoramos a confirmar no servidor; a campanha pode já ter iniciado — veja a lista de campanhas antes de repetir o disparo.';

/**
 * Tempo máximo até ack da campanha (callback / campaign-started / campaign-error).
 * Backend faz ping nos canais, opcional reconnect e espera (~10s) antes de responder — vários chips somam esse tempo.
 * Anexos em base64 atravessam o WebSocket e precisam de ainda mais margem.
 */
function startCampaignAckTimeoutMs(
  media?: { dataBase64?: string },
  connectionIdsCount: number = 1
): number {
  const b64 = media?.dataBase64;
  if (b64) {
    const approxBytes = (b64.length * 3) / 4;
    if (approxBytes < 50_000) return 45_000;
    const ms = 40_000 + (approxBytes / 100_000) * 1_000;
    return Math.min(900_000, Math.max(90_000, Math.ceil(ms)));
  }
  /** Servidor responde callback cedo; margem curta caso o socket caia no meio do emit. */
  const n = Math.max(1, Math.min(24, Number(connectionIdsCount) || 1));
  return Math.min(35_000, 12_000 + n * 2_000);
}

const INITIAL_METRICS: DashboardMetrics = {
  totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0
};

const INITIAL_FUNNEL: FunnelStats = {
  totalSent: 0,
  totalDelivered: 0,
  totalRead: 0,
  totalReplied: 0,
  updatedAt: 0
};

const INITIAL_CAMPAIGN_GEO: CampaignGeoState = {
  campaignId: null,
  byUf: {},
  updatedAt: 0
};

// Extender o tipo para incluir o socket e métricas de sistema
interface ZapMassContextWithSocket extends ZapMassContextType {
  socket: Socket | null;
  systemMetrics: SystemMetrics;
  warmupActive: boolean;
  startWarmupTimer: (intervalMinutes: number, runRound: () => void) => void;
  stopWarmupTimer: () => void;
  startAutoWarmup: (connectionIds: string[], intervalMinutes: number) => void;
  stopAutoWarmup: () => void;
}

const INITIAL_SYS_METRICS: SystemMetrics = { cpu: 0, ram: 0, uptime: '0m', latency: 0 };

/** Snapshot enxuto para shell (TopBar, Sidebar, banners): não herda atualizações de `conversations`. */
export type ZapMassUiSnapshot = {
  isBackendConnected: boolean;
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

const ZapMassUiSnapshotContext = createContext<ZapMassUiSnapshot | null>(null);

const ZapMassConnectionsSliceContext = createContext<{ connections: WhatsAppConnection[] } | null>(
  null
);

const EMPTY_CONTEXT: ZapMassContextWithSocket = {
  socket: null,
  systemMetrics: INITIAL_SYS_METRICS,
  connections: [],
  contacts: [],
  contactsHasMore: false,
  contactsLoadingMore: false,
  loadMoreContacts: async () => {},
  contactsSavedTotal: null,
  contactsSavedTotalLoading: false,
  refreshContactsSavedTotal: async () => {},
  contactLists: [],
  campaigns: [],
  metrics: INITIAL_METRICS,
  birthdays: [],
  conversations: [],
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

const ZAP_MASS_CONVERSATIONS_DEFAULT = { conversations: [] as Conversation[] };
const ZapMassConversationsContext = createContext(ZAP_MASS_CONVERSATIONS_DEFAULT);

const ZapMassCoreContext = createContext<ZapMassCoreContextValue>(EMPTY_CORE);
const legacyIgnoreKey = (uid: string) => `zapmass.ignoreLegacyData:${uid}`;
const allowLegacyMerge = (): boolean => {
  // Segurança multi-tenant: desabilitado por padrão de forma rígida
  // para impedir mistura entre contas.
  return false;
};

const belongsToUidCampaign = (
  uid: string,
  raw: Record<string, unknown>
): boolean => {
  const ownerUid = typeof raw.ownerUid === 'string' ? raw.ownerUid : '';
  if (ownerUid) return ownerUid === uid;

  const connIds = Array.isArray(raw.selectedConnectionIds)
    ? (raw.selectedConnectionIds as unknown[]).map((x) => String(x || '')).filter(Boolean)
    : [];
  // Sem owner e sem conexao vinculada => registro suspeito/contaminado. Bloqueia.
  if (connIds.length === 0) return false;

  return connIds.some((id) => ownsConnectionForUid(uid, id));
};

/** Apaga subcolecao logs antes de remover a campanha (batch com limite Firestore). */
async function deleteCampaignLogsForUser(uid: string, campaignId: string): Promise<void> {
  const logsSnap = await getDocs(collection(db, 'users', uid, 'campaigns', campaignId, 'logs'));
  if (logsSnap.empty) return;
  let batch = writeBatch(db);
  let pending = 0;
  for (const logDoc of logsSnap.docs) {
    batch.delete(logDoc.ref);
    pending++;
    if (pending >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
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
  const contactsLastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const contactsVpsOffsetRef = useRef(0);
  const reloadVpsContactsRef = useRef<() => Promise<void>>(async () => {});
  const reloadVpsContactListsRef = useRef<() => Promise<void>>(async () => {});
  const reloadVpsCampaignsRef = useRef<() => Promise<void>>(async () => {});

  const patchCampaignPersist = useCallback((uid: string, campaignId: string, patch: Record<string, unknown>) => {
    if (useVpsData()) {
      void apiUpdateCampaign(campaignId, patch);
      return;
    }
    void updateDoc(doc(db, 'users', uid, 'campaigns', campaignId), patch).catch(() => {});
  }, []);

  reloadVpsCampaignsRef.current = async () => {
    const uid = currentUidRef.current;
    if (!uid || !useVpsData()) return;
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
  const [birthdays, setBirthdays] = useState<BirthdayContact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [warmupQueue, setWarmupQueue] = useState<WarmupItem[]>([]);
  const [warmedCount, setWarmedCount] = useState(0);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
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
  const currentUidRef = useRef<string | null>(auth.currentUser?.uid ?? null);
  const prevAuthUserRef = useRef<string | null>(auth.currentUser?.uid ?? null);
  const bindUserRef = useRef<(uid: string) => void>(() => {});
  /** Mescla Firestore legado (coleções na raiz) com `users/{uid}/...`. */
  const fbMergeRef = useRef({
    userContacts: [] as Contact[],
    legacyContacts: [] as Contact[],
    userLists: [] as ContactList[],
    legacyLists: [] as ContactList[],
    userCampaigns: [] as Campaign[],
    legacyCampaigns: [] as Campaign[]
  });
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
      if (!useVpsData()) {
        campaignFirestoreHealRef.current.delete(c.id);
      }
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
    return {
      id,
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
    };
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
      if (useVpsData()) {
        const total = await fetchContactsCount();
        if (currentUidRef.current !== requestUid) return;
        setContactsSavedTotal(total);
      } else {
        const agg = await getCountFromServer(query(collection(db, 'users', requestUid, 'contacts')));
        if (currentUidRef.current !== requestUid) return;
        setContactsSavedTotal(agg.data().count);
      }
    } catch (err) {
      warnProd(
        useVpsData() ? '[VPS] contagem contacts:' : '[Firestore] contagem users/.../contacts:',
        (err as Error)?.message || err
      );
      if (currentUidRef.current === requestUid) setContactsSavedTotal(null);
    } finally {
      if (currentUidRef.current === requestUid) setContactsSavedTotalLoading(false);
    }
  }, []);

  reloadVpsContactsRef.current = async () => {
    const uid = currentUidRef.current;
    if (!uid || !useVpsData()) return;
    const requestUid = uid;
    try {
      const { contacts, total, hasMore } = await fetchContacts({ limit: 5000, offset: 0 });
      if (currentUidRef.current !== requestUid) return;
      contactsVpsOffsetRef.current = contacts.length;
      contactsLastDocRef.current = hasMore ? ({} as QueryDocumentSnapshot<DocumentData>) : null;
      setContacts(contacts);
      setContactsHasMore(hasMore);
      setContactsSavedTotal(total);
    } catch (err) {
      warnProd('[VPS] reload contacts:', (err as Error)?.message || err);
    }
  };

  reloadVpsContactListsRef.current = async () => {
    const uid = currentUidRef.current;
    if (!uid || !useVpsData()) return;
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

  // --- FIREBASE SYNC ---
  useEffect(() => {
    let cleanupFirestore: Array<() => void> = [];

    const stopAll = () => {
      cleanupFirestore.forEach((fn) => fn());
      cleanupFirestore = [];
    };

    /**
     * Com sessão ativa mantemos contactos, listas e campanhas sincronizados com Firestore.
     * Não dependemos da aba visível: re-subscrever só em algumas vistas + `stopAll` a cada troca
     * de aba derrubava os listeners de `contacts` e voltava a descarregar milhares de docs → UI travava.
     */
    const bindUser = (uid: string) => {
      const needContacts = true;
      const needLists = true;
      const needCampaigns = true;

      stopAll();
      setCircuitBreakerOpenIds(new Set());
      const b = fbMergeRef.current;
      const ignoreLegacy = !allowLegacyMerge() || (() => {
        try {
          return localStorage.getItem(legacyIgnoreKey(uid)) === '1';
        } catch {
          return false;
        }
      })();
      const allowLegacyNow = () => {
        try {
          return localStorage.getItem(legacyIgnoreKey(uid)) !== '1';
        } catch {
          return true;
        }
      };
      b.userContacts = [];
      b.legacyContacts = [];
      b.userLists = [];
      b.legacyLists = [];
      b.userCampaigns = [];
      b.legacyCampaigns = [];

      if (needContacts) {
        contactsLastDocRef.current = null;
        contactsVpsOffsetRef.current = 0;
        setContactsHasMore(false);
        if (useVpsData()) {
          void reloadVpsContactsRef.current();
          void refreshContactsSavedTotalRef.current();
        } else {
          cleanupFirestore.push(
            onSnapshot(
              query(collection(db, 'users', uid, 'contacts'), orderBy('name')),
              (snapshot) => {
                if (currentUidRef.current !== uid) return;
                b.userContacts = snapshot.docs.map((docSnap) =>
                  normalizeContactDoc(docSnap.id, docSnap.data() as Record<string, any>)
                );
                setContacts(mergeContacts(b.userContacts, b.legacyContacts));
              },
              (err) => warnProd('[Firestore] users/.../contacts:', (err as Error)?.message || err)
            )
          );
          if (!ignoreLegacy) {
            cleanupFirestore.push(
              onSnapshot(
                query(collection(db, 'contacts'), orderBy('name')),
                (snapshot) => {
                  if (currentUidRef.current !== uid) return;
                  if (!allowLegacyNow()) {
                    b.legacyContacts = [];
                    setContacts(mergeContacts(b.userContacts, []));
                    return;
                  }
                  b.legacyContacts = snapshot.docs.map((docSnap) =>
                    normalizeContactDoc(docSnap.id, docSnap.data() as Record<string, any>)
                  );
                  setContacts(mergeContacts(b.userContacts, b.legacyContacts));
                },
                (err) => warnProd('[Firestore] /contacts (legado):', (err as Error)?.message || err)
              )
            );
          }
          void refreshContactsSavedTotalRef.current();
        }
      }
      if (needLists) {
        if (useVpsData()) {
          void reloadVpsContactListsRef.current();
        } else {
          cleanupFirestore.push(
            onSnapshot(
              query(collection(db, 'users', uid, 'contact_lists'), orderBy('createdAt', 'desc')),
              (snapshot) => {
                if (currentUidRef.current !== uid) return;
                b.userLists = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ContactList));
                setContactLists(mergeContactLists(b.userLists, b.legacyLists));
              },
              (err) => warnProd('[Firestore] contact_lists (usuario):', (err as Error)?.message || err)
            )
          );
          if (!ignoreLegacy) {
            cleanupFirestore.push(
              onSnapshot(
                query(collection(db, 'contact_lists')),
                (snapshot) => {
                  if (currentUidRef.current !== uid) return;
                  if (!allowLegacyNow()) {
                    b.legacyLists = [];
                    setContactLists(mergeContactLists(b.userLists, []));
                    return;
                  }
                  b.legacyLists = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ContactList));
                  setContactLists(mergeContactLists(b.userLists, b.legacyLists));
                },
                (err) => warnProd('[Firestore] /contact_lists (legado):', (err as Error)?.message || err)
              )
            );
          }
        }
      }
      if (needCampaigns) {
        if (useVpsData()) {
          void reloadVpsCampaignsRef.current();
        } else {
        cleanupFirestore.push(
          onSnapshot(
            query(collection(db, 'users', uid, 'campaigns'), orderBy('createdAt', 'desc')),
            (snapshot) => {
              if (currentUidRef.current !== uid) return;
              b.userCampaigns = snapshot.docs
                .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Record<string, unknown> & Campaign))
                .filter((row) => belongsToUidCampaign(uid, row))
                .map((row) => row as Campaign);
              const mergedUserLegacy = mergeCampaigns(b.userCampaigns, b.legacyCampaigns);
              syncStuckCampaignsToFirestore(mergedUserLegacy, uid);
              setCampaigns(healStuckRunningCampaignsList(mergedUserLegacy));
            },
            (err) => warnProd('[Firestore] campaigns (usuario):', (err as Error)?.message || err)
          )
        );
        if (!ignoreLegacy) {
          cleanupFirestore.push(
            onSnapshot(
              query(collection(db, 'campaigns')),
              (snapshot) => {
                if (currentUidRef.current !== uid) return;
                if (!allowLegacyNow()) {
                  b.legacyCampaigns = [];
                  const m = mergeCampaigns(b.userCampaigns, []);
                  syncStuckCampaignsToFirestore(m, uid);
                  setCampaigns(healStuckRunningCampaignsList(m));
                  return;
                }
                b.legacyCampaigns = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Campaign));
                const mergedL = mergeCampaigns(b.userCampaigns, b.legacyCampaigns);
                syncStuckCampaignsToFirestore(mergedL, uid);
                setCampaigns(healStuckRunningCampaignsList(mergedL));
              },
              (err) => warnProd('[Firestore] /campaigns (legado):', (err as Error)?.message || err)
            )
          );
        }
        }
      }
    };

    bindUserRef.current = bindUser;

    // Limpa TODOS os estados sensiveis antes de carregar dados de outro usuario.
    // Antes, conversas/metricas/funil/etc do usuario anterior persistiam por
    // alguns segundos apos troca de conta — vazamento entre sessoes em
    // browser compartilhado.
    const resetSessionState = () => {
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

    const handleAuthUser = async (user: User | null) => {
      const newAuthUid = user?.uid ?? null;
      if (prevAuthUserRef.current !== newAuthUid) {
        prevAuthUserRef.current = newAuthUid;
        resetSessionState();
      }
      // Garante que o Socket.io usa o mesmo UID que a UI — senão o servidor cria
      // conexoes "legado" (sem prefixo) e a contagem do teto fica defasada.
      const sock = socketRef.current;
      if (sock) {
        if (user) {
          try {
            const t = await user.getIdToken();
            sock.auth = { token: t };
          } catch {
            (sock as Socket & { auth: { token?: string } }).auth = {};
          }
        } else {
          (sock as Socket & { auth: { token?: string } }).auth = {};
        }
        if (sock.connected) {
          sock.disconnect();
        }
        sock.connect();
      }
      if (!user?.uid) {
        stopAll();
        resetSessionState();
        return;
      }
      if (workspaceLoading) {
        return;
      }
      const dataUid = effectiveWorkspaceUid ?? user.uid;
      currentUidRef.current = dataUid;
      bindUser(dataUid);
    };

    let unsubAuth = () => {};
    if (useVpsAuth()) {
      void handleAuthUser(sessionUser);
    } else {
      unsubAuth = onAuthStateChanged(auth, (u) => void handleAuthUser(u));
    }

    const uidNow = useVpsAuth() ? sessionUser?.uid : auth.currentUser?.uid;
    if (uidNow && !workspaceLoading) {
      bindUser(effectiveWorkspaceUid ?? uidNow);
    }

    return () => {
      unsubAuth();
      stopAll();
    };
  }, [syncStuckCampaignsToFirestore, effectiveWorkspaceUid, workspaceLoading, sessionUser]);

  const loadMoreContacts = useCallback(async (): Promise<void> => {
    const uid = currentUidRef.current;
    if (!uid) return;
    if (contactsLoadingMore) return;
    if (!contactsHasMore) return;
    const CONTACTS_PAGE_SIZE = 500;
    setContactsLoadingMore(true);
    try {
      if (useVpsData()) {
        const offset = contactsVpsOffsetRef.current;
        const { contacts: nextDocs, hasMore } = await fetchContacts({
          limit: CONTACTS_PAGE_SIZE,
          offset
        });
        contactsVpsOffsetRef.current = offset + nextDocs.length;
        setContactsHasMore(hasMore);
        if (nextDocs.length > 0) {
          setContacts((prev) => {
            const byId = new Map(prev.map((c) => [c.id, c]));
            for (const c of nextDocs) byId.set(c.id, c);
            return Array.from(byId.values()).sort((a, b) =>
              (a.name || '').localeCompare(b.name || '', 'pt-BR')
            );
          });
        }
        return;
      }
      const last = contactsLastDocRef.current;
      if (!last) return;
      const snap = await getDocs(
        query(
          collection(db, 'users', uid, 'contacts'),
          orderBy('name'),
          startAfter(last),
          limit(CONTACTS_PAGE_SIZE)
        )
      );
      const nextDocs = snap.docs.map((d) => normalizeContactDoc(d.id, d.data() as Record<string, any>));
      contactsLastDocRef.current = snap.docs.length ? snap.docs[snap.docs.length - 1] : contactsLastDocRef.current;
      setContactsHasMore(snap.docs.length >= CONTACTS_PAGE_SIZE);
      if (nextDocs.length > 0) {
        setContacts((prev) => {
          const byId = new Map(prev.map((c) => [c.id, c]));
          for (const c of nextDocs) byId.set(c.id, c);
          return Array.from(byId.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
        });
      }
    } finally {
      setContactsLoadingMore(false);
    }
  }, [contactsHasMore, contactsLoadingMore]);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u?.uid || workspaceLoading) return;
    const dataUid = effectiveWorkspaceUid ?? u.uid;
    if (currentUidRef.current !== dataUid) {
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
    const resolvedWorkspaceUid = effectiveWorkspaceUid ?? auth.currentUser?.uid ?? null;
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
      const authUid = auth.currentUser?.uid;
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
      setIsBackendConnected(false);
      return () => {
        resetCampaignRecipientErrorBurst(campaignRecipientErrorBurstRef);
      };
    }

    socketRef.current = io(BACKEND_URL, {
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

    const socket = socketRef.current;
    const syncBackendConnected = () => {
      setIsBackendConnected(!!socket.connected);
    };
    void getSessionIdToken().then((token) => {
      if (token) {
        socket.auth = { token };
        if (!socket.connected) socket.connect();
      }
    }).catch(() => {
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
        if (list.length > 0) {
          setConnections((prev) => {
            const result = mergeWhatsAppConnectionLists(list, prev, qrCodeByConnectionId.current);
            for (const conn of result) {
              if (conn.status === ConnectionStatus.CONNECTED) {
                delete qrCodeByConnectionId.current[conn.id];
              }
            }
            connectionsRef.current = result;
            return result;
          });
        }
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
      setIsBackendConnected(true);
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
        setIsBackendConnected(false);
        return; // logout / socket.disconnect() intencional — sem aviso de falha
      }
      // Badge “Offline”: só após ~3s sem reconectar (troca de aba / throttle costuma recuperar antes).
      offlineBadgeDelayRef.current = setTimeout(() => {
        offlineBadgeDelayRef.current = null;
        if (!socket.connected) setIsBackendConnected(false);
      }, 3000);
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
      setIsBackendConnected(false);
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
      if (mine.length === 0) return;
      setConnections((prev) => {
        const result = mergeWhatsAppConnectionLists(mine, prev, qrCodeByConnectionId.current);
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
        const next = {
          totalSent: Number(newFunnel?.totalSent) || 0,
          totalDelivered: Number(newFunnel?.totalDelivered) || 0,
          totalRead: Number(newFunnel?.totalRead) || 0,
          totalReplied: Number(newFunnel?.totalReplied) || 0,
          updatedAt: Number(newFunnel?.updatedAt) || Date.now(),
          clearedAt: newFunnel?.clearedAt
        };
        if (
          prev &&
          prev.totalSent === next.totalSent &&
          prev.totalDelivered === next.totalDelivered &&
          prev.totalRead === next.totalRead &&
          prev.totalReplied === next.totalReplied &&
          prev.clearedAt === next.clearedAt
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
    socket.on('pong-latency', (t0: number) => {
      const lat = Math.max(0, Date.now() - t0);
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
        setContacts((prev) => {
          const byId = new Map(prev.map((c) => [c.id, c]));
          for (const c of data.contacts!) {
            if (c?.id) byId.set(c.id, { ...(byId.get(c.id) || ({} as Contact)), ...c });
          }
          return Array.from(byId.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
        });
      }
    });

    socket.on('qr-code', (data: { connectionId: string; qrCode: string }) => {
      qrCodeByConnectionId.current[data.connectionId] = data.qrCode;
      setConnections((prev) =>
        prev.map((conn) =>
          conn.id === data.connectionId
            ? { ...conn, qrCode: data.qrCode }
            : conn
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

    socket.on('send-message-error', ({ error }: { error?: string }) => {
      const now = Date.now();
      const minGapMs = 8000;
      if (now - sendMessageErrorToastAtRef.current < minGapMs) return;
      sendMessageErrorToastAtRef.current = now;
      toast.error(error || 'Falha ao enviar mensagem.', { id: 'send-message-error', duration: 6000 });
    });

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
          payload: { message: log.message, ...log.payload }
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
            setContacts((prev) => {
              const idx = prev.findIndex((c) => normPhoneKey(c.phone) === pkey);
              if (idx < 0) return prev;
              const row = prev[idx];
              void persistCampaignDeliveryAndPreview(uid, row.id, payload.campaignId, campaignsRef.current).catch(
                () => {}
              );
              const campaignDoc = campaignsRef.current.find((x) => x.id === payload.campaignId);
              const totalStages = getCampaignStageTotal(campaignDoc);
              const cname = String(campaignDoc?.name || 'Campanha').slice(0, 120);
              const prevP = row.campaignTablePreview;
              const same = prevP?.campaignId === payload.campaignId;
              const optimisticSent = same ? (prevP?.sent ?? 0) + 1 : 1;
              const optimisticPending = Math.max(0, totalStages - optimisticSent);
              const at = new Date().toISOString();
              const next = [...prev];
              next[idx] = {
                ...row,
                campaignMessagesReceived: (row.campaignMessagesReceived || 0) + 1,
                campaignTablePreview: {
                  campaignId: payload.campaignId,
                  campaignName: cname,
                  sent: optimisticSent,
                  totalStages,
                  pending: optimisticPending,
                  updatedAt: at
                }
              };
              return next;
            });
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
          const ref = doc(db, 'users', uid, 'contacts', c.id);
          void updateDoc(ref, updates as Record<string, unknown>).catch(() => {});
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
        const u = auth.currentUser;
        if (u) {
          u.getIdToken(false)
            .then((token) => {
              (socket as Socket & { auth: { token?: string } }).auth = { token };
              if (!socket.connected) socket.connect();
            })
            .catch(() => {
              if (!socket.connected) socket.connect();
            });
        } else {
          socket.connect();
        }
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
      for (const t of bootstrapSyncTimers) clearTimeout(t);
      bootstrapSyncTimers.length = 0;
      socket.io.off('reconnect', onManagerReconnect);
      socket.disconnect();
    };
  }, [syncStuckCampaignsToFirestore, effectiveWorkspaceUid, workspaceLoading]);

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
    if (useVpsData()) {
      const { id, ...payload } = contact;
      const newId = await apiCreateContact(payload);
      await reloadVpsContactsRef.current();
      void refreshContactsSavedTotal();
      if (!options?.silent) toast.success('Contato adicionado com sucesso!');
      return newId;
    }
    const { id, ...payload } = contact;
    const ref = await addDoc(collection(db, 'users', uid, 'contacts'), payload);
    void refreshContactsSavedTotal();
    if (!options?.silent) {
      toast.success('Contato adicionado com sucesso!');
    }
    return ref.id;
  };

  const bulkAddContacts = async (contactRows: Contact[], options?: { silent?: boolean }) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para adicionar contato.');
    if (contactRows.length === 0) return [];
    if (useVpsData()) {
      const payloads = contactRows.map(({ id: _d, ...rest }) => rest);
      const ids = await apiBulkCreateContacts(payloads);
      await reloadVpsContactsRef.current();
      void refreshContactsSavedTotal();
      if (!options?.silent && contactRows.length > 0) {
        toast.success(`${contactRows.length} contato(s) gravados em lote.`);
      }
      return ids;
    }
    const ids: string[] = [];
    const collRef = collection(db, 'users', uid, 'contacts');
    let batch = writeBatch(db);
    let pending = 0;
    for (const contact of contactRows) {
      const { id: _discard, ...payload } = contact;
      const ref = doc(collRef);
      batch.set(ref, payload as Record<string, unknown>);
      ids.push(ref.id);
      pending++;
      if (pending >= FIRESTORE_BATCH_CHUNK) {
        await batch.commit();
        await yieldToUiThread();
        batch = writeBatch(db);
        pending = 0;
      }
    }
    if (pending > 0) {
      await batch.commit();
      await yieldToUiThread();
    }
    if (!options?.silent && contactRows.length > 0) {
      toast.success(`${contactRows.length} contato(s) gravados em lote.`);
    }
    void refreshContactsSavedTotal();
    return ids;
  };

  const removeContact = async (id: string, options?: { silent?: boolean }) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para remover contato.');
    if (useVpsData()) {
      await apiDeleteContact(id);
      await reloadVpsContactsRef.current();
      void refreshContactsSavedTotal();
      if (!options?.silent) toast.success('Contato removido.');
      return;
    }
    await deleteDoc(doc(db, 'users', uid, 'contacts', id)).catch(() => {});
    await deleteDoc(doc(db, 'contacts', id)).catch(() => {});
    void refreshContactsSavedTotal();
    if (!options?.silent) {
      toast.success('Contato removido.');
    }
  };

  const updateContact = async (
    id: string,
    updates: Partial<Contact>,
    options?: { silent?: boolean; assumeUserDoc?: boolean }
  ) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para atualizar contato.');
    if (useVpsData()) {
      await apiUpdateContact(id, updates);
      await reloadVpsContactsRef.current();
      if (!options?.silent) toast.success('Contato atualizado com sucesso!');
      return;
    }
    const refUser = doc(db, 'users', uid, 'contacts', id);
    if (options?.assumeUserDoc) {
      await updateDoc(refUser, updates as Record<string, unknown>);
      if (!options?.silent) {
        toast.success('Contato atualizado com sucesso!');
      }
      return;
    }
    const snapUser = await getDoc(refUser);
    if (snapUser.exists()) {
      await updateDoc(refUser, updates as Record<string, unknown>);
    } else {
      const snapRoot = await getDoc(doc(db, 'contacts', id));
      if (snapRoot.exists()) {
        const base = snapRoot.data() as Record<string, unknown>;
        await setDoc(refUser, { ...base, ...updates }, { merge: true });
      } else {
        await updateDoc(refUser, updates as Record<string, unknown>);
      }
    }
    if (!options?.silent) {
      toast.success('Contato atualizado com sucesso!');
    }
  };

  const bulkUpdateContacts = async (
    items: Array<{ id: string; updates: Partial<Contact> }>,
    options?: { silent?: boolean }
  ) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para atualizar contato.');
    if (items.length === 0) return;
    if (useVpsData()) {
      await apiBulkUpdateContacts(items);
      await reloadVpsContactsRef.current();
      if (!options?.silent) toast.success('Contatos atualizados.');
      return;
    }
    let batch = writeBatch(db);
    let pending = 0;
    for (const { id, updates } of items) {
      const refUser = doc(db, 'users', uid, 'contacts', id);
      batch.update(refUser, updates as Record<string, unknown>);
      pending++;
      if (pending >= FIRESTORE_BATCH_CHUNK) {
        await batch.commit();
        await yieldToUiThread();
        batch = writeBatch(db);
        pending = 0;
      }
    }
    if (pending > 0) {
      await batch.commit();
      await yieldToUiThread();
    }
    if (!options?.silent) {
      toast.success(`${items.length} contato(s) atualizados em lote.`);
    }
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

    const deleteCollectionDocs = async (collPath: string, counterKey?: keyof typeof summary) => {
      try {
        const snap = await getDocs(collection(db, collPath));
        if (snap.empty) return;
        if (counterKey) summary[counterKey] += snap.docs.length;
        let batch = writeBatch(db);
        let pending = 0;
        for (const row of snap.docs) {
          batch.delete(row.ref);
          pending++;
          if (pending >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            pending = 0;
          }
        }
        if (pending > 0) await batch.commit();
        hadAnySuccess = true;
      } catch (err: any) {
        errors.push(`${collPath}: ${err?.message || 'erro desconhecido'}`);
      }
    };

    // Coleções suportadas e usadas hoje no app.
    if (useVpsData()) {
      try {
        const cleared = await apiClearTenantContactsData();
        summary.contacts = cleared.contacts;
        summary.contactLists = cleared.contactLists;
        hadAnySuccess = true;
      } catch (err: unknown) {
        errors.push(`vps/contacts-data: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      await deleteCollectionDocs(`users/${uid}/contacts`, 'contacts');
      await deleteCollectionDocs(`users/${uid}/contact_lists`, 'contactLists');
    }

    // Campanhas: primeiro apaga logs de cada campanha, depois a campanha.
    try {
      if (useVpsData()) {
        summary.campaigns = await apiDeleteAllCampaigns();
        hadAnySuccess = true;
      } else {
      const campaignSnap = await getDocs(collection(db, 'users', uid, 'campaigns'));
      if (!campaignSnap.empty) {
        for (const campaignDoc of campaignSnap.docs) {
          await deleteCollectionDocs(`users/${uid}/campaigns/${campaignDoc.id}/logs`, 'campaignLogs');
        }
        summary.campaigns += campaignSnap.docs.length;
        let batch = writeBatch(db);
        let pending = 0;
        for (const campaignDoc of campaignSnap.docs) {
          batch.delete(campaignDoc.ref);
          pending++;
          if (pending >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            pending = 0;
          }
        }
        if (pending > 0) await batch.commit();
        hadAnySuccess = true;
      }
      }
    } catch (err: any) {
      errors.push(`users/${uid}/campaigns: ${err?.message || 'erro desconhecido'}`);
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
    try {
      localStorage.setItem(legacyIgnoreKey(uid), '1');
    } catch {
      /* ignore */
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

    if (useVpsData()) {
      const lists = await fetchContactLists();
      const list = lists.find((l) => l.id === listId);
      if (!list) {
        throw new Error(
          'Lista não encontrada. Recarregue a página e escolha de novo a lista em Contatos.'
        );
      }
      const mergedIds = [...new Set([...(list.contactIds || []), ...uniq])];
      await apiUpdateContactList(listId, { contactIds: mergedIds });
      await reloadVpsContactListsRef.current();
      return;
    }

    const ref = doc(db, 'users', uid, 'contact_lists', listId);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) {
        throw new Error(
          'Lista não encontrada no seu utilizador. Recarregue a página e escolha de novo a lista em Contatos.'
        );
      }
      const data = snap.data() as Record<string, unknown>;
      const rawIds = data.contactIds;
      const cur: string[] = Array.isArray(rawIds)
        ? rawIds.filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
        : [];
      const mergedIds = [...new Set([...cur, ...uniq])];

      const patch: Record<string, unknown> = {
        contactIds: mergedIds,
        lastUpdated: new Date().toISOString()
      };
      if (options?.notesLine) {
        const prevNotes = String(data.notes ?? '');
        patch.notes = `${prevNotes}\n${options.notesLine}`.trim();
      }
      transaction.update(ref, patch);
    });
  };

  const createContactList = async (name: string, contactIds: string[], description?: string): Promise<string> => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para criar lista.');
    if (useVpsData()) {
      const listId = await apiCreateContactList({
        name,
        contactIds: [],
        description: description || '',
        createdAt: new Date().toISOString()
      });
      if (contactIds.length > 0) {
        await appendContactIdsToContactList(listId, contactIds);
      }
      await reloadVpsContactListsRef.current();
      return listId;
    }
    const ref = await addDoc(collection(db, 'users', uid, 'contact_lists'), {
      name,
      contactIds: [],
      description: description || '',
      createdAt: new Date().toISOString(),
    });
    if (contactIds.length > 0) {
      await appendContactIdsToContactList(ref.id, contactIds);
    }
    return ref.id;
  };

  const deleteContactList = async (id: string) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para remover lista.');
    if (useVpsData()) {
      await apiDeleteContactList(id);
      await reloadVpsContactListsRef.current();
      return;
    }
    const refUser = doc(db, 'users', uid, 'contact_lists', id);
    const refRoot = doc(db, 'contact_lists', id);
    const [snapUser, snapRoot] = await Promise.all([getDoc(refUser), getDoc(refRoot)]);
    const errors: string[] = [];
    if (snapUser.exists()) {
      try {
        await deleteDoc(refUser);
      } catch (e: unknown) {
        errors.push(`users/${uid}/contact_lists/${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (snapRoot.exists()) {
      try {
        await deleteDoc(refRoot);
      } catch (e: unknown) {
        errors.push(`contact_lists/${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!snapUser.exists() && !snapRoot.exists()) {
      throw new Error('Lista não encontrada (Firestore).');
    }
    if (errors.length > 0) {
      throw new Error(errors.join(' · '));
    }
  };

  const updateContactList = async (id: string, updates: Partial<ContactList>) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para atualizar lista.');
    if (useVpsData()) {
      await apiUpdateContactList(id, updates);
      await reloadVpsContactListsRef.current();
      return;
    }
    const refUser = doc(db, 'users', uid, 'contact_lists', id);
    const snapUser = await getDoc(refUser);
    if (snapUser.exists()) {
      await updateDoc(refUser, updates as Record<string, unknown>);
    } else {
      const snapRoot = await getDoc(doc(db, 'contact_lists', id));
      if (snapRoot.exists()) {
        const base = snapRoot.data() as Record<string, unknown>;
        await setDoc(refUser, { ...base, ...updates }, { merge: true });
      } else {
        await updateDoc(refUser, updates as Record<string, unknown>);
      }
    }
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
          status: 'sent' as const,
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
      const next = prev.map((c) =>
        c.id === campaignId ? { ...c, status: CampaignStatus.RUNNING } : c
      );
      const u = currentUidRef.current;
      if (u) {
        patchCampaignPersist(u, campaignId, { status: CampaignStatus.RUNNING });
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
    if (useVpsData()) {
      await apiDeleteCampaign(campaignId);
      void reloadVpsCampaignsRef.current();
    } else {
      await deleteCampaignLogsForUser(uid, campaignId);
      await deleteDoc(doc(db, 'users', uid, 'campaigns', campaignId));
    }
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
    if (useVpsData()) {
      for (const id of campaignIds) {
        await apiDeleteCampaign(id);
      }
      void reloadVpsCampaignsRef.current();
    } else {
      for (const id of campaignIds) {
        await deleteCampaignLogsForUser(uid, id);
      }
      let batch = writeBatch(db);
      let pending = 0;
      for (const id of campaignIds) {
        batch.delete(doc(db, 'users', uid, 'campaigns', id));
        pending++;
        if (pending >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          pending = 0;
        }
      }
      if (pending > 0) await batch.commit();
    }
    toast.success(`${campaignIds.length} campanha${campaignIds.length > 1 ? 's removidas' : ' removida'}.`);
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

    let campaignIdCreated: string;
    if (useVpsData()) {
      campaignIdCreated = await Promise.race([
        apiCreateCampaign(campaignPayload),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Tempo esgotado ao salvar a campanha. Verifique sua conexão e tente de novo.')),
            20_000
          )
        )
      ]);
      void reloadVpsCampaignsRef.current();
    } else {
      const campaignRef = await Promise.race([
        addDoc(collection(db, 'users', uid, 'campaigns'), campaignPayload),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Tempo esgotado ao salvar a campanha. Verifique sua conexão e tente de novo.')),
            20_000
          )
        )
      ]);
      campaignIdCreated = campaignRef.id;
    }
    const campaignRef = { id: campaignIdCreated };

    try {
      const ackTimeoutMs = startCampaignAckTimeoutMs(
        options?.mediaAttachment,
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
            mediaAttachment: options?.mediaAttachment
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

      if (!response.ok) throw new Error(response.error || 'Falha ao iniciar campanha.');

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
      if (!likelyStillRunning) {
        if (useVpsData()) {
          await apiDeleteCampaign(campaignRef.id).catch(() => {});
          void reloadVpsCampaignsRef.current();
        } else {
          await deleteDoc(doc(db, 'users', uid, 'campaigns', campaignRef.id)).catch(() => {});
        }
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
    const campaignId = useVpsData()
      ? await apiCreateCampaign(schedulePayload)
      : (await addDoc(collection(db, 'users', uid, 'campaigns'), schedulePayload)).id;
    if (useVpsData()) void reloadVpsCampaignsRef.current();
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
      systemMetrics,
      sessionLiveStats
    }),
    [isBackendConnected, systemMetrics, sessionLiveStats]
  );

  const connectionsSlice = useMemo(() => ({ connections }), [connections]);

  const zapMassConversationsSlice = useMemo(() => ({ conversations }), [conversations]);

  const zapMassCoreValue = useMemo<ZapMassCoreContextValue>(
    () => ({
      socket: socketRef.current,
      connections,
      campaigns,
      contacts,
      contactsHasMore,
      contactsLoadingMore,
      loadMoreContacts,
      contactsSavedTotal,
      contactsSavedTotalLoading,
      refreshContactsSavedTotal: stableRefreshContactsSavedTotal,
      contactLists,
      metrics,
      birthdays,
      systemLogs,
      warmupQueue,
      warmedCount,
      isBackendConnected,
      sessionLiveStats,
      campaignStatus,
      systemMetrics,
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
      contactsSavedTotal,
      contactsSavedTotalLoading,
      stableRefreshContactsSavedTotal,
      contactLists,
      metrics,
      birthdays,
      systemLogs,
      warmupQueue,
      warmedCount,
      isBackendConnected,
      sessionLiveStats,
      campaignStatus,
      systemMetrics,
      funnelStats,
      campaignGeo,
      warmupChipStats,
      warmupActive,
      circuitBreakerOpenIds
    ]
  );

  return (
    <ZapMassConnectionsSliceContext.Provider value={connectionsSlice}>
      <ZapMassUiSnapshotContext.Provider value={zapMassUiSnapshot}>
        <ZapMassConversationsContext.Provider value={zapMassConversationsSlice}>
          <ZapMassCoreContext.Provider value={zapMassCoreValue}>{children}</ZapMassCoreContext.Provider>
        </ZapMassConversationsContext.Provider>
      </ZapMassUiSnapshotContext.Provider>
    </ZapMassConnectionsSliceContext.Provider>
  );
};

/** Sidebar, TopBar, banners: ignoram atualizações de conversas/contactos — menos “travar” ao sync. */
export function useZapMassUiSnapshot(): ZapMassUiSnapshot {
  const v = useContext(ZapMassUiSnapshotContext);
  if (v) return v;
  return {
    isBackendConnected: false,
    systemMetrics: INITIAL_SYS_METRICS,
    sessionLiveStats: null
  };
}

/** Lista de conversas/inbox isolada — `useZapMassCore()` não dispara quando o socket sincroniza o pipeline. */
export function useZapMassConversations(): Conversation[] {
  return useContext(ZapMassConversationsContext).conversations;
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