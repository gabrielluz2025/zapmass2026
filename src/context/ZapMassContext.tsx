import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
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
  SystemLog,
  WarmupItem,
  SystemMetrics,
  FunnelStats,
  WarmupChipStats,
  CampaignGeoState,
  CampaignGeoUfStats
} from '../types';
import { collection, onSnapshot, addDoc, deleteDoc, doc, getDoc, getDocs, query, orderBy, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../services/firebase';
import { useAppView } from './AppViewContext';
import { useWorkspace } from './WorkspaceContext';
import { ownsConnectionForUid } from '../utils/connectionScope';
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
  warmupNextRound: number;
  startWarmupTimer: (intervalMinutes: number, runRound: () => void) => void;
  stopWarmupTimer: () => void;
}

const INITIAL_SYS_METRICS: SystemMetrics = { cpu: 0, ram: 0, uptime: '0m', latency: 0 };

const EMPTY_CONTEXT: ZapMassContextWithSocket = {
  socket: null,
  systemMetrics: INITIAL_SYS_METRICS,
  connections: [],
  contacts: [],
  contactLists: [],
  campaigns: [],
  metrics: INITIAL_METRICS,
  birthdays: [],
  conversations: [],
  systemLogs: [],
  warmupQueue: [],
  warmedCount: 0,
  isBackendConnected: false,
  campaignStatus: { isRunning: false, total: 0, processed: 0, success: 0, failed: 0 },
  addConnection: async () => {},
  removeConnection: () => {},
  updateConnectionStatus: () => {},
  reconnectConnection: async () => {},
  forceQr: async () => {},
  addContact: async () => {},
  removeContact: async () => {},
  updateContact: async () => {},
  createContactList: async () => {},
  deleteContactList: async () => {},
  updateContactList: async () => {},
  sendMessage: () => {},
  sendMedia: async () => ({ ok: false, error: 'Sem conexao com servidor.' }),
  markAsRead: () => {},
  fetchConversationPicture: () => {},
  deleteLocalConversations: async () => 0,
  loadChatHistory: async () => ({ ok: false, total: 0 }),
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
  warmupNextRound: 0,
  startWarmupTimer: () => {},
  stopWarmupTimer: () => {}
};

const ZapMassContext = createContext<ZapMassContextWithSocket>(EMPTY_CONTEXT);
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

export const ZapMassProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentView } = useAppView();
  const { effectiveWorkspaceUid, loading: workspaceLoading } = useWorkspace();
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>(INITIAL_METRICS);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
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
  
  // Warmup Timer State (lives in context so it persists across tab switches)
  const [warmupActive, setWarmupActive] = useState(false);
  const [warmupNextRound, setWarmupNextRound] = useState(0);
  const warmupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warmupCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startWarmupTimer = (intervalMinutes: number, runRound: () => void) => {
    stopWarmupTimer();
    setWarmupActive(true);
    runRound();
    warmupTimerRef.current = setInterval(runRound, intervalMinutes * 60 * 1000);
    setWarmupNextRound(intervalMinutes * 60);
    warmupCountdownRef.current = setInterval(() => {
      setWarmupNextRound(prev => prev <= 1 ? intervalMinutes * 60 : prev - 1);
    }, 1000);
  };

  const stopWarmupTimer = () => {
    setWarmupActive(false);
    if (warmupTimerRef.current) clearInterval(warmupTimerRef.current);
    if (warmupCountdownRef.current) clearInterval(warmupCountdownRef.current);
    warmupTimerRef.current = null;
    warmupCountdownRef.current = null;
    setWarmupNextRound(0);
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
  const qrCodeByConnectionId = useRef<Record<string, string>>({});
  const connectionsRef = useRef<WhatsAppConnection[]>([]);
  const disconnectToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    updateDoc(doc(db, 'users', uid, 'campaigns', campaignId), {
      processedCount: entry.payload.processedCount,
      successCount: entry.payload.successCount,
      failedCount: entry.payload.failedCount
    }).catch(() => {});
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
      void updateDoc(doc(db, 'users', uid, 'campaigns', c.id), {
        status: CampaignStatus.COMPLETED,
        processedCount: m.effectiveProcessed,
        successCount: m.ok,
        failedCount: m.fail
      }).catch(() => {
        campaignFirestoreHealRef.current.delete(c.id);
      });
    }
  }, []);

  /** `campaign-progress` / Firestore defasados: ninguem a correr, mas ainda isRunning; limpa a barra de estado. */
  useEffect(() => {
    if (campaigns.some((c) => c.status === CampaignStatus.RUNNING)) return;
    setCampaignStatus((s) => (s.isRunning ? { ...s, isRunning: false } : s));
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

  // --- FIREBASE SYNC ---
  useEffect(() => {
    const normalizeContactDoc = (id: string, raw: Record<string, any>): Contact => {
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
      return {
        id,
        name: raw.name || raw.nome || 'Sem Nome',
        phone: raw.phone || raw.telefone || '',
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
        ...(followUpNote ? { followUpNote } : {})
      };
    };

    let cleanupFirestore: Array<() => void> = [];

    const stopAll = () => {
      cleanupFirestore.forEach((fn) => fn());
      cleanupFirestore = [];
    };

    const needContacts = ['dashboard', 'contacts', 'campaigns'].includes(currentView);
    const needLists = ['contacts', 'campaigns'].includes(currentView);
    const needCampaigns =
      ['dashboard', 'campaigns', 'reports'].includes(currentView) || campaignStatus.isRunning;

    const bindUser = (uid: string) => {
      stopAll();
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
            (err) => console.warn('[Firestore] users/.../contacts:', (err as Error)?.message || err)
          )
        );
        if (!ignoreLegacy) {
          cleanupFirestore.push(
            onSnapshot(
              query(collection(db, 'contacts')),
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
              (err) => console.warn('[Firestore] /contacts (legado):', (err as Error)?.message || err)
            )
          );
        }
      }
      if (needLists) {
        cleanupFirestore.push(
          onSnapshot(
            query(collection(db, 'users', uid, 'contact_lists'), orderBy('createdAt', 'desc')),
            (snapshot) => {
              if (currentUidRef.current !== uid) return;
              b.userLists = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ContactList));
              setContactLists(mergeContactLists(b.userLists, b.legacyLists));
            },
            (err) => console.warn('[Firestore] contact_lists (usuario):', (err as Error)?.message || err)
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
              (err) => console.warn('[Firestore] /contact_lists (legado):', (err as Error)?.message || err)
            )
          );
        }
      }
      if (needCampaigns) {
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
            (err) => console.warn('[Firestore] campaigns (usuario):', (err as Error)?.message || err)
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
              (err) => console.warn('[Firestore] /campaigns (legado):', (err as Error)?.message || err)
            )
          );
        }
      }
    };

    bindUserRef.current = bindUser;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      const newAuthUid = user?.uid ?? null;
      if (prevAuthUserRef.current !== newAuthUid) {
        prevAuthUserRef.current = newAuthUid;
        setContacts([]);
        setContactLists([]);
        setCampaigns([]);
        setConnections([]);
        campaignFirestoreHealRef.current.clear();
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
        setContacts([]);
        setContactLists([]);
        setCampaigns([]);
        setConnections([]);
        campaignFirestoreHealRef.current.clear();
        return;
      }
      if (workspaceLoading) {
        return;
      }
      const dataUid = effectiveWorkspaceUid ?? user.uid;
      currentUidRef.current = dataUid;
      bindUser(dataUid);
    });

    const uidNow = auth.currentUser?.uid;
    if (uidNow && !workspaceLoading) {
      bindUser(effectiveWorkspaceUid ?? uidNow);
    }

    return () => {
      unsubAuth();
      stopAll();
    };
  }, [
    currentView,
    campaignStatus.isRunning,
    syncStuckCampaignsToFirestore,
    effectiveWorkspaceUid,
    workspaceLoading
  ]);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u?.uid || workspaceLoading) return;
    const dataUid = effectiveWorkspaceUid ?? u.uid;
    if (currentUidRef.current !== dataUid) {
      setContacts([]);
      setContactLists([]);
      setCampaigns([]);
      setConnections([]);
      campaignFirestoreHealRef.current.clear();
    }
    currentUidRef.current = dataUid;
    bindUserRef.current(dataUid);
  }, [effectiveWorkspaceUid, workspaceLoading, currentView, campaignStatus.isRunning]);

  // --- SOCKET.IO REAL-TIME CONNECTION ---
  useEffect(() => {
    // LÓGICA DE CONEXÃO DINÂMICA
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const BACKEND_URL = isLocalhost ? "http://localhost:3001" : undefined;
    /** Evita corrida Firebase vs ref: o primeiro connections-update vinha antes do ref estar alinhado e esvaziava a lista (modo estrito uid__). */
    const getOwnerUidForConnectionScope = (): string =>
      currentUidRef.current ?? auth.currentUser?.uid ?? 'anonymous';
    const ownsConnectionId = (connectionId: string) =>
      ownsConnectionForUid(getOwnerUidForConnectionScope(), connectionId);

    console.log(`Iniciando conexão Socket.IO com: ${BACKEND_URL || 'origem relativa'}`);

    socketRef.current = io(BACKEND_URL || undefined, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
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
    if (auth.currentUser) {
      auth.currentUser.getIdToken().then((token) => {
        socket.auth = { token };
        if (!socket.connected) socket.connect();
      }).catch(() => {
        setIsBackendConnected(false);
      });
    }

    socket.on('connect', () => {
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
      console.log('🔌 Conectado ao servidor Socket.io');
    });

    socket.on('disconnect', (reason) => {
      setIsBackendConnected(false);
      if (disconnectToastTimerRef.current) {
        clearTimeout(disconnectToastTimerRef.current);
        disconnectToastTimerRef.current = null;
      }
      if (reason === 'io client disconnect') {
        return; // logout / socket.disconnect() intencional — sem aviso de falha
      }
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
      if (err?.message === 'unauthorized') {
        const u = auth.currentUser;
        if (u) {
          u.getIdToken(true)
            .then((token) => {
              socket.auth = { token };
              if (!socket.connected) socket.connect();
            })
            .catch(() => {
              /* sem token valido, mantem desconectado */
            });
        }
      }
    });

    // Reconexao completa do manager (cobre casos em que o handler de `connect` nao dispara
    // na ordem esperada apos retoken / reload).
    const onManagerReconnect = () => {
      syncBackendConnected();
    };
    socket.io.on('reconnect', onManagerReconnect);
    // Estado inicial: se o socket ja estiver conectado (ou reconectar muito rapido), reflete no badge.
    syncBackendConnected();
    queueMicrotask(() => syncBackendConnected());

    socket.on('connections-update', (updatedConnections: WhatsAppConnection[]) => {
      const mine = (Array.isArray(updatedConnections) ? updatedConnections : []).filter((conn) => ownsConnectionId(conn.id));
      setConnections((prev) => {
        const result = mine.map((conn) => {
          const previous = prev.find((item) => item.id === conn.id);
          const shouldClearQr = conn.status === ConnectionStatus.CONNECTED;
          if (shouldClearQr) {
            delete qrCodeByConnectionId.current[conn.id];
          }
          return {
            ...conn,
            qrCode: shouldClearQr
              ? undefined
              : qrCodeByConnectionId.current[conn.id] ?? previous?.qrCode
          };
        });
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
      setMetrics(newMetrics);
    });

    socket.on('funnel-stats-update', (newFunnel: FunnelStats) => {
      setFunnelStats({
        totalSent: Number(newFunnel?.totalSent) || 0,
        totalDelivered: Number(newFunnel?.totalDelivered) || 0,
        totalRead: Number(newFunnel?.totalRead) || 0,
        totalReplied: Number(newFunnel?.totalReplied) || 0,
        updatedAt: Number(newFunnel?.updatedAt) || Date.now(),
        clearedAt: newFunnel?.clearedAt
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
      setConversations((Array.isArray(updatedConversations) ? updatedConversations : []).filter((c) => ownsConnectionId(c.connectionId)));
    });

    socket.on('conversation-picture', ({ conversationId, profilePicUrl }: { conversationId: string; profilePicUrl?: string | null }) => {
      if (!conversationId || !profilePicUrl) return;
      setConversations((prev) => {
        const c = prev.find((x) => x.id === conversationId);
        if (!c || !ownsConnectionId(c.connectionId)) return prev;
        return prev.map((x) => (x.id === conversationId ? { ...x, profilePicUrl } : x));
      });
    });

    // Real system metrics
    socket.on('system-metrics', (data: SystemMetrics) => {
      setSystemMetrics(prev => ({ ...prev, ...data }));
    });

    // Real latency via ping/pong (a cada 5s)
    const pingInterval = setInterval(() => {
      if (!socket.connected) return;
      const t0 = Date.now();
      socket.emit('ping-latency', t0);
    }, 5000);
    socket.on('pong-latency', (t0: number) => {
      const lat = Date.now() - t0;
      setSystemMetrics(prev => ({ ...prev, latency: lat }));
    });

    socket.on('warmup-update', (data: { pending: WarmupItem[]; warmedCount: number }) => {
      setWarmupQueue(Array.isArray(data?.pending) ? data.pending : []);
      setWarmedCount(Number.isFinite(data?.warmedCount) ? data.warmedCount : 0);
    });

    socket.on('initial-data', (data: { contacts: Contact[], birthdays: BirthdayContact[] }) => {
      setContacts(data.contacts);
      setBirthdays(data.birthdays);
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
    });

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
        if (uid) updateDoc(doc(db, 'users', uid, 'campaigns', campaignId), {
          status: CampaignStatus.RUNNING,
          processedCount: 0,
          successCount: 0,
          failedCount: 0
        }).catch(() => {});
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

    socket.on('campaign-progress', (data) => {
      setCampaignStatus({
        isRunning: true,
        total: data.total,
        processed: data.processed,
        success: data.successCount,
        failed: data.failCount
      });
      // Atualizar campaigns localmente para dados em tempo real na UI
      if (data.campaignId) {
        setCampaigns((prev) => {
          const next = prev.map((c) =>
            c.id === data.campaignId
              ? {
                  ...c,
                  processedCount: data.processed,
                  successCount: data.successCount,
                  failedCount: data.failCount,
                  status: CampaignStatus.RUNNING
                }
              : c
          );
          const u = currentUidRef.current;
          if (u) syncStuckCampaignsToFirestore(next, u);
          return healStuckRunningCampaignsList(next);
        });
        queueCampaignProgressPersist(data.campaignId, {
          processedCount: data.processed,
          successCount: data.successCount,
          failedCount: data.failCount
        });
      }
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
                updateDoc(doc(db, 'users', uid, 'campaigns', campaignId), {
                  status: CampaignStatus.SCHEDULED,
                  nextRunAt: nextIso,
                  lastRunAt: new Date().toISOString(),
                  processedCount: 0,
                  successCount: 0,
                  failedCount: 0
                }).catch(() => {});
              } else {
                updateDoc(doc(db, 'users', uid, 'campaigns', campaignId), {
                  status: CampaignStatus.COMPLETED,
                  successCount,
                  failedCount: failCount,
                  processedCount
                }).catch(() => {});
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

    socket.on('campaign-error', ({ error }: { error?: string }) => {
      toast.error(error || 'Falha ao iniciar campanha.', {
        id: 'campaign-bootstrap',
        duration: 7500
      });
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
      toast.error(msg, { id: 'socket-operation-error', duration: 6500 });
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

      if (log.level === 'ERROR' && log.payload?.campaignId) {
        const uid = currentUidRef.current;
        const payload = log.payload as {
          campaignId: string;
          to?: string;
          connectionId?: string;
          error?: string;
          message?: string;
        };
        if (uid) {
          addDoc(collection(db, 'users', uid, 'campaigns', payload.campaignId, 'logs'), {
            level: log.level,
            message: log.message,
            to: payload.to || '',
            connectionId: payload.connectionId || '',
            error: payload.error || '',
            createdAt: new Date().toISOString()
          }).catch(() => {});
        }
      }
    });

    socket.on('system-log', (log: SystemLog) => {
      setSystemLogs(prev => [log, ...prev].slice(0, 200));
    });

    socket.on('campaign-paused', ({ campaignId }: { campaignId: string }) => {
      flushCampaignProgressToFirestore(campaignId, true);
      const uid = currentUidRef.current;
      if (uid) updateDoc(doc(db, 'users', uid, 'campaigns', campaignId), { status: CampaignStatus.PAUSED }).catch(() => {});
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
      if (uid) updateDoc(doc(db, 'users', uid, 'campaigns', campaignId), { status: CampaignStatus.RUNNING }).catch(() => {});
      clearCampaignProgressPersist(campaignId);
      setCampaigns((prev) => {
        const next = prev.map((c) => (c.id === campaignId ? { ...c, status: CampaignStatus.RUNNING } : c));
        const u = currentUidRef.current;
        if (u) syncStuckCampaignsToFirestore(next, u);
        return healStuckRunningCampaignsList(next);
      });
      toast('Campanha retomada!', { icon: '▶️' });
    });

    return () => {
      resetCampaignRecipientErrorBurst(campaignRecipientErrorBurstRef);
      Object.values(campaignProgressPersistRef.current).forEach((entry) => {
        if (entry.timer) clearTimeout(entry.timer);
      });
      campaignProgressPersistRef.current = {};
      if (disconnectToastTimerRef.current) {
        clearTimeout(disconnectToastTimerRef.current);
        disconnectToastTimerRef.current = null;
      }
      clearInterval(pingInterval);
      socket.io.off('reconnect', onManagerReconnect);
      socket.disconnect();
    };
  }, [syncStuckCampaignsToFirestore]);

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
    const u = auth.currentUser;
    if (u) {
      try {
        const token = await u.getIdToken(forceRefresh);
        (sock as Socket & { auth: { token?: string } }).auth = { token };
      } catch {
        (sock as Socket & { auth: { token?: string } }).auth = {};
      }
    } else {
      (sock as Socket & { auth: { token?: string } }).auth = {};
    }
  };

  const addConnection = async (name: string) => {
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
    sock.emit('ui-log', { action: 'create-connection', name });
    sock.emit('create-connection', { name });
  };

  const removeConnection = (id: string) => {
    socketRef.current?.emit('ui-log', { action: 'delete-connection', id });
    socketRef.current?.emit('delete-connection', { id });
    toast.success('Conexão removida.');
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

  const addContact = async (contact: Contact) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para adicionar contato.');
    const { id, ...payload } = contact;
    const ref = await addDoc(collection(db, 'users', uid, 'contacts'), payload);
    toast.success('Contato adicionado com sucesso!');
    return ref.id;
  };

  const removeContact = async (id: string, options?: { silent?: boolean }) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para remover contato.');
    await deleteDoc(doc(db, 'users', uid, 'contacts', id)).catch(() => {});
    await deleteDoc(doc(db, 'contacts', id)).catch(() => {});
    if (!options?.silent) {
      toast.success('Contato removido.');
    }
  };

  const updateContact = async (id: string, updates: Partial<Contact>) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para atualizar contato.');
    const refUser = doc(db, 'users', uid, 'contacts', id);
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
    toast.success('Contato atualizado com sucesso!');
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
    await deleteCollectionDocs(`users/${uid}/contacts`, 'contacts');
    await deleteCollectionDocs(`users/${uid}/contact_lists`, 'contactLists');

    // Campanhas: primeiro apaga logs de cada campanha, depois a campanha.
    try {
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
    setWarmupActive(false);
    setWarmupNextRound(0);

    // Limpa preferências locais ligadas ao workspace atual do usuário.
    const storageKeys = [
      'zapmass_settings',
      'zapmass.contactsFilter',
      'zapmass.pendingCampaignDraft',
      'zapmass.openChatByPhone'
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
    return summary;
  };

  const createContactList = async (name: string, contactIds: string[], description?: string) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para criar lista.');
    await addDoc(collection(db, 'users', uid, 'contact_lists'), {
      name,
      contactIds,
      description: description || '',
      createdAt: new Date().toISOString()
    });
  };

  const deleteContactList = async (id: string) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para remover lista.');
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
    socketRef.current?.emit('ui-log', { action: 'send-message', conversationId });
    socketRef.current?.emit('send-message', { conversationId, text });
    // Feedback visual imediato, embora o real venha do evento 'conversations-update'
    toast.success('Mensagem enviada', { duration: 2000, position: 'bottom-right' });
  };

  const sendMedia = (
    conversationId: string,
    payload: { dataBase64: string; mimeType: string; fileName: string; caption?: string }
  ): Promise<{ ok: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket) {
        resolve({ ok: false, error: 'Sem conexao com servidor.' });
        return;
      }
      socket.emit('send-media', { conversationId, ...payload }, (resp?: { ok: boolean; error?: string }) => {
        resolve(resp || { ok: false, error: 'Sem resposta do servidor.' });
      });
    });
  };

  const markAsRead = (conversationId: string) => {
    socketRef.current?.emit('ui-log', { action: 'mark-as-read', conversationId });
    socketRef.current?.emit('mark-as-read', { conversationId });
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
      socket.emit(
        'load-chat-history',
        { conversationId, limit, includeMedia },
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
    socketRef.current?.emit('pause-campaign', { campaignId });
  };

  const resumeCampaign = (campaignId: string) => {
    socketRef.current?.emit('resume-campaign', { campaignId });
  };

  const deleteCampaign = async (campaignId: string) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para remover campanha.');
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (campaign?.status === CampaignStatus.RUNNING) {
      socketRef.current?.emit('pause-campaign', { campaignId });
    }
    await deleteDoc(doc(db, 'users', uid, 'campaigns', campaignId)).catch(() => {});
    await deleteDoc(doc(db, 'campaigns', campaignId)).catch(() => {});
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
    const batch = writeBatch(db);
    campaignIds.forEach((id) => {
      batch.delete(doc(db, 'users', uid, 'campaigns', id));
      batch.delete(doc(db, 'campaigns', id));
    });
    await batch.commit();
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

    const campaignRef = await addDoc(collection(db, 'users', uid, 'campaigns'), {
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
    });

    try {
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
          if (!data?.campaignId || data.campaignId === campaignRef.id) {
            finish({ ok: false, error: data?.error || 'Falha ao iniciar campanha.' });
          }
        };

        const timeoutId = setTimeout(() => {
          finish({ ok: false, error: 'Tempo esgotado ao iniciar campanha. Tente novamente.' });
        }, 20000);

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
            channelWeights: options?.channelWeights
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
      await deleteDoc(doc(db, 'users', uid, 'campaigns', campaignRef.id)).catch(() => {});
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

    const campaignRef = await addDoc(collection(db, 'users', uid, 'campaigns'), {
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
    });
    toast.success('Campanha agendada. O disparo ocorre no horário escolhido (servidor online).');
    return campaignRef.id;
  };

  return (
    <ZapMassContext.Provider value={{
      socket: socketRef.current,
      connections,
      campaigns,
      contacts,
      contactLists,
      metrics,
      birthdays,
      conversations,
      systemLogs,
      warmupQueue,
      warmedCount,
      isBackendConnected,
      campaignStatus,
      systemMetrics,
      addConnection,
      removeConnection,
      updateConnectionStatus,
      reconnectConnection,
      forceQr,
      addContact,
      removeContact,
      updateContact,
      createContactList,
      deleteContactList,
      updateContactList,
      sendMessage,
      sendMedia,
      markAsRead,
      fetchConversationPicture,
      deleteLocalConversations,
      loadChatHistory,
      loadMessageMedia,
      markWarmupReady,
      pauseCampaign,
      resumeCampaign,
      deleteCampaign,
      deleteCampaigns,
      startCampaign,
      scheduleCampaign,
      funnelStats,
      clearFunnelStats,
      campaignGeo,
      warmupChipStats,
      clearWarmupChipStats,
      clearAllUserData,
      warmupActive,
      warmupNextRound,
      startWarmupTimer,
      stopWarmupTimer
    }}>
      {children}
    </ZapMassContext.Provider>
  );
};

export const useZapMass = () => {
  const context = useContext(ZapMassContext);
  if (context === EMPTY_CONTEXT) {
    console.warn('useZapMass usado fora do ZapMassProvider. Retornando contexto vazio.');
  }
  return context;
};