import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import {
  WhatsAppConnection, 
  ConnectionStatus, 
  CampaignStatus,
  Campaign, 
  CampaignReplyFlow,
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
import { collection, onSnapshot, addDoc, deleteDoc, doc, getDoc, query, orderBy, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../services/firebase';
import { useAppView } from './AppViewContext';
import { ownsConnectionForUid } from '../utils/connectionScope';
import { mergeCampaigns, mergeContactLists, mergeContacts } from '../utils/mergeLegacyUserDocs';

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
  addConnection: () => {},
  removeConnection: () => {},
  updateConnectionStatus: () => {},
  reconnectConnection: () => {},
  forceQr: () => {},
  addContact: async () => {},
  removeContact: async () => {},
  updateContact: async () => {},
  createContactList: async () => {},
  deleteContactList: async () => {},
  updateContactList: async () => {},
  sendMessage: () => {},
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
  funnelStats: INITIAL_FUNNEL,
  clearFunnelStats: () => {},
  campaignGeo: INITIAL_CAMPAIGN_GEO,
  warmupChipStats: {},
  clearWarmupChipStats: () => {},
  warmupActive: false,
  warmupNextRound: 0,
  startWarmupTimer: () => {},
  stopWarmupTimer: () => {}
};

const ZapMassContext = createContext<ZapMassContextWithSocket>(EMPTY_CONTEXT);

export const ZapMassProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentView } = useAppView();
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
  const reconnectingToastShownRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  const currentUidRef = useRef<string | null>(auth.currentUser?.uid ?? null);
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

  // Mantem dashboard individual por usuario sem depender de agregados globais do servidor.
  useEffect(() => {
    const totalSent = campaigns.reduce((sum, c) => sum + (Number(c.processedCount) || 0), 0);
    const totalDelivered = campaigns.reduce((sum, c) => sum + (Number(c.successCount) || 0), 0);
    const totalFailed = campaigns.reduce((sum, c) => sum + (Number(c.failedCount) || 0), 0);
    const nextMetrics: DashboardMetrics = {
      totalSent,
      totalDelivered,
      totalRead: 0,
      totalReplied: 0
    };
    setMetrics(nextMetrics);
    setFunnelStats({
      totalSent,
      totalDelivered,
      totalRead: 0,
      totalReplied: 0,
      updatedAt: Date.now(),
      clearedAt: totalSent === 0 && totalDelivered === 0 && totalFailed === 0 ? Date.now() : undefined
    });
  }, [campaigns]);

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
        lastMsg: raw.lastMsg || raw.ultimaMsg
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
              b.userContacts = snapshot.docs.map((docSnap) =>
                normalizeContactDoc(docSnap.id, docSnap.data() as Record<string, any>)
              );
              setContacts(mergeContacts(b.userContacts, b.legacyContacts));
            },
            (err) => console.warn('[Firestore] users/.../contacts:', (err as Error)?.message || err)
          )
        );
        cleanupFirestore.push(
          onSnapshot(
            query(collection(db, 'contacts')),
            (snapshot) => {
              b.legacyContacts = snapshot.docs.map((docSnap) =>
                normalizeContactDoc(docSnap.id, docSnap.data() as Record<string, any>)
              );
              setContacts(mergeContacts(b.userContacts, b.legacyContacts));
            },
            (err) => console.warn('[Firestore] /contacts (legado):', (err as Error)?.message || err)
          )
        );
      }
      if (needLists) {
        cleanupFirestore.push(
          onSnapshot(
            query(collection(db, 'users', uid, 'contact_lists'), orderBy('createdAt', 'desc')),
            (snapshot) => {
              b.userLists = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ContactList));
              setContactLists(mergeContactLists(b.userLists, b.legacyLists));
            },
            (err) => console.warn('[Firestore] contact_lists (usuario):', (err as Error)?.message || err)
          )
        );
        cleanupFirestore.push(
          onSnapshot(
            query(collection(db, 'contact_lists')),
            (snapshot) => {
              b.legacyLists = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ContactList));
              setContactLists(mergeContactLists(b.userLists, b.legacyLists));
            },
            (err) => console.warn('[Firestore] /contact_lists (legado):', (err as Error)?.message || err)
          )
        );
      }
      if (needCampaigns) {
        cleanupFirestore.push(
          onSnapshot(
            query(collection(db, 'users', uid, 'campaigns'), orderBy('createdAt', 'desc')),
            (snapshot) => {
              b.userCampaigns = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Campaign));
              setCampaigns(mergeCampaigns(b.userCampaigns, b.legacyCampaigns));
            },
            (err) => console.warn('[Firestore] campaigns (usuario):', (err as Error)?.message || err)
          )
        );
        cleanupFirestore.push(
          onSnapshot(
            query(collection(db, 'campaigns')),
            (snapshot) => {
              b.legacyCampaigns = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Campaign));
              setCampaigns(mergeCampaigns(b.userCampaigns, b.legacyCampaigns));
            },
            (err) => console.warn('[Firestore] /campaigns (legado):', (err as Error)?.message || err)
          )
        );
      }
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      currentUidRef.current = user?.uid ?? null;
      if (!user?.uid) {
        stopAll();
        setContacts([]);
        setContactLists([]);
        setCampaigns([]);
        return;
      }
      bindUser(user.uid);
    });

    const uidNow = auth.currentUser?.uid;
    if (uidNow) {
      bindUser(uidNow);
    }

    return () => {
      unsubAuth();
      stopAll();
    };
  }, [currentView, campaignStatus.isRunning]);

  // --- SOCKET.IO REAL-TIME CONNECTION ---
  useEffect(() => {
    // LÓGICA DE CONEXÃO DINÂMICA
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const BACKEND_URL = isLocalhost ? "http://localhost:3001" : undefined;
    const ownsConnectionId = (connectionId: string) =>
      ownsConnectionForUid(currentUidRef.current ?? 'anonymous', connectionId);

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
    if (auth.currentUser) {
      auth.currentUser.getIdToken().then((token) => {
        socket.auth = { token };
        if (!socket.connected) socket.connect();
      }).catch(() => {});
    } else {
      socket.connect();
    }

    socket.on('connect', () => {
      if (disconnectToastTimerRef.current) {
        clearTimeout(disconnectToastTimerRef.current);
        disconnectToastTimerRef.current = null;
      }
      reconnectingToastShownRef.current = false;
      setIsBackendConnected(true);
      if (!hasConnectedOnceRef.current) {
        hasConnectedOnceRef.current = true;
        toast.success('Servidor conectado!', {
          icon: '🟢',
          style: { borderRadius: '10px', background: '#333', color: '#fff' }
        });
      } else {
        toast.success('Reconectado ao servidor.', {
          icon: '🟢',
          style: { borderRadius: '10px', background: '#333', color: '#fff' }
        });
      }
      console.log('🔌 Conectado ao servidor Socket.io');
    });

    socket.on('disconnect', (reason) => {
      setIsBackendConnected(false);
      if (reason !== 'io client disconnect' && !reconnectingToastShownRef.current) {
        reconnectingToastShownRef.current = true;
        toast('Reconectando ao servidor...', {
          icon: '🟡',
          duration: 2500,
          style: { borderRadius: '10px', background: '#333', color: '#fff' }
        });
      }
      if (disconnectToastTimerRef.current) clearTimeout(disconnectToastTimerRef.current);
      // Evita falso positivo em quedas rápidas: só avisa erro após 6s offline contínuo.
      disconnectToastTimerRef.current = setTimeout(() => {
        if (!socket.connected) {
          toast.error('Conexão perdida com o servidor.', {
            icon: '🔴',
            style: { borderRadius: '10px', background: '#333', color: '#fff' }
          });
        }
      }, 6000);
    });

    socket.on('connect_error', (err) => {
      setIsBackendConnected(false);
      console.error('❌ Erro na conexão Socket.IO:', err.message);
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      if (!reconnectingToastShownRef.current && attempt >= 1) {
        reconnectingToastShownRef.current = true;
        toast('Tentando reconectar...', {
          icon: '🔄',
          duration: 2500,
          style: { borderRadius: '10px', background: '#333', color: '#fff' }
        });
      }
    });

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
      if (!ownsConnectionId(conversationId.split(':')[0] || '')) return;
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, profilePicUrl } : c))
      );
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
        setCampaigns(prev => prev.map(c => c.id === campaignId ? {
          ...c, status: CampaignStatus.RUNNING, processedCount: 0, successCount: 0, failedCount: 0
        } : c));
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
        setCampaigns(prev => prev.map(c => c.id === data.campaignId ? {
          ...c,
          processedCount: data.processed,
          successCount: data.successCount,
          failedCount: data.failCount,
          status: CampaignStatus.RUNNING
        } : c));
        queueCampaignProgressPersist(data.campaignId, {
          processedCount: data.processed,
          successCount: data.successCount,
          failedCount: data.failCount
        });
      }
    });

    socket.on('campaign-complete', ({ successCount, failCount, campaignId }) => {
      setCampaignStatus(prev => ({ ...prev, isRunning: false }));
      if (campaignId) {
        flushCampaignProgressToFirestore(campaignId, true);
        const uid = currentUidRef.current;
        setCampaigns(prev => prev.map(c => c.id === campaignId ? {
          ...c,
          status: CampaignStatus.COMPLETED,
          successCount,
          failedCount: failCount
        } : c));
        if (uid) updateDoc(doc(db, 'users', uid, 'campaigns', campaignId), {
          status: CampaignStatus.COMPLETED,
          successCount,
          failedCount: failCount
        }).catch(() => {});
        clearCampaignProgressPersist(campaignId);
      }
      toast.success('Campanha finalizada!');
    });

    socket.on('campaign-error', ({ error }) => {
      toast.error(error || 'Falha ao iniciar campanha.');
    });

    socket.on('send-message-error', ({ error }) => {
      toast.error(error || 'Falha ao enviar mensagem.');
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
        toast.error(log.message);
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
      setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, status: CampaignStatus.PAUSED } : c));
      toast('Campanha pausada.', { icon: '⏸️' });
    });

    socket.on('campaign-resumed', ({ campaignId }: { campaignId: string }) => {
      flushCampaignProgressToFirestore(campaignId, true);
      const uid = currentUidRef.current;
      if (uid) updateDoc(doc(db, 'users', uid, 'campaigns', campaignId), { status: CampaignStatus.RUNNING }).catch(() => {});
      clearCampaignProgressPersist(campaignId);
      setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, status: CampaignStatus.RUNNING } : c));
      toast('Campanha retomada!', { icon: '▶️' });
    });

    return () => {
      Object.values(campaignProgressPersistRef.current).forEach((entry) => {
        if (entry.timer) clearTimeout(entry.timer);
      });
      campaignProgressPersistRef.current = {};
      if (disconnectToastTimerRef.current) {
        clearTimeout(disconnectToastTimerRef.current);
        disconnectToastTimerRef.current = null;
      }
      clearInterval(pingInterval);
      socket.disconnect();
    };
  }, []);

  // --- ACTIONS ---
  const addConnection = (name: string) => {
    socketRef.current?.emit('ui-log', { action: 'create-connection', name });
    socketRef.current?.emit('create-connection', { name });
  };

  const removeConnection = (id: string) => {
    socketRef.current?.emit('ui-log', { action: 'delete-connection', id });
    socketRef.current?.emit('delete-connection', { id });
    toast.success('Conexão removida.');
  };

  const updateConnectionStatus = (id: string, status: ConnectionStatus) => {
    setConnections(prev => prev.map(c => c.id === id ? { ...c, status } : c));
  };

  const reconnectConnection = (id: string) => {
    socketRef.current?.emit('ui-log', { action: 'reconnect-connection', id });
    socketRef.current?.emit('reconnect-connection', { id });
    toast('Tentando reconectar...', { icon: '🔄' });
  };

  const forceQr = (id: string) => {
    socketRef.current?.emit('ui-log', { action: 'force-qr', id });
    socketRef.current?.emit('force-qr', { id });
    toast('Forcando novo QR...', { icon: '🧩' });
  };

  const addContact = async (contact: Contact) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para adicionar contato.');
    const { id, ...payload } = contact;
    await addDoc(collection(db, 'users', uid, 'contacts'), payload);
    toast.success('Contato adicionado com sucesso!');
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
    await deleteDoc(doc(db, 'users', uid, 'contact_lists', id)).catch(() => {});
    await deleteDoc(doc(db, 'contact_lists', id)).catch(() => {});
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
    }
  ) => {
    const uid = currentUidRef.current;
    if (!uid) throw new Error('Faça login para iniciar campanha.');
    const targetConnections = connectionIds || [sessionId];
    const socket = socketRef.current;

    if (!socket?.connected) {
      throw new Error('Servidor offline no momento. Reconecte e tente novamente.');
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
            recipients: cleanRecipients
          },
          (result?: { ok?: boolean; error?: string }) => {
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
      funnelStats,
      clearFunnelStats,
      campaignGeo,
      warmupChipStats,
      clearWarmupChipStats,
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