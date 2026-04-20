
import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { 
  WhatsAppConnection, 
  ConnectionStatus, 
  Contact, 
  DashboardMetrics, 
  ZapMassContextType,
  BirthdayContact,
  Conversation,
  ContactList,
  Campaign 
} from '../types';

const INITIAL_METRICS: DashboardMetrics = {
  totalSent: 0, totalDelivered: 0, totalRead: 0, totalReplied: 0
};

// Extender o tipo para incluir o socket
interface ZapMassContextWithSocket extends ZapMassContextType {
  socket: Socket | null;
}

const ZapMassContext = createContext<ZapMassContextWithSocket | undefined>(undefined);

export const ZapMassProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>(INITIAL_METRICS);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [birthdays, setBirthdays] = useState<BirthdayContact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [campaignsHistory, setCampaignsHistory] = useState<Campaign[]>([]); 
  
  const [campaignStatus, setCampaignStatus] = useState({
    isRunning: false,
    total: 0,
    processed: 0,
    success: 0,
    failed: 0
  });

  const socketRef = useRef<Socket | null>(null);

  // --- FIREBASE SYNC ---
  useEffect(() => {
    const unsubscribeContacts = onSnapshot(query(collection(db, "contacts"), orderBy("name")), (snapshot) => {
      setContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact)));
    });
    const unsubscribeLists = onSnapshot(query(collection(db, "contact_lists"), orderBy("createdAt", "desc")), (snapshot) => {
      setContactLists(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ContactList)));
    });
    return () => { unsubscribeContacts(); unsubscribeLists(); };
  }, []);

  // --- SOCKET.IO ---
  useEffect(() => {
    // CORREÇÃO: Não definir URL hardcoded. Deixar vazio para usar o proxy do Vite.
    // Isso resolve o erro "xhr poll error" pois a requisição será Same-Origin.
    
    socketRef.current = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'], // Prioriza Websocket
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      setIsBackendConnected(true);
      // Toast silencioso para reconexões rápidas, ou descomente abaixo se quiser ver
      // toast.success('Sistema Conectado', { id: 'conn-success', icon: '🟢', duration: 2000 });
      console.log('🔌 Conectado ao servidor via Proxy');
    });

    socket.on('disconnect', () => setIsBackendConnected(false));
    
    // Tratamento de erro silencioso para evitar spam no console
    socket.on('connect_error', (err) => {
        // Apenas loga se for erro crítico, ignora poll error temporário
        if (err.message !== 'xhr poll error') {
            console.warn('Socket status:', err.message);
        }
        setIsBackendConnected(false);
    });

    socket.on('connections-update', (data) => setConnections(data));
    socket.on('metrics-update', (data) => setMetrics(data));
    
    // Campaign Real-time Events
    socket.on('campaign-started', ({ total }) => {
        setCampaignStatus({ isRunning: true, total, processed: 0, success: 0, failed: 0 });
        toast.success(`Disparo iniciado para ${total} contatos!`);
    });

    socket.on('campaign-progress', (data) => {
        setCampaignStatus({
            isRunning: true,
            total: data.total,
            processed: data.processed,
            success: data.successCount,
            failed: data.failCount
        });
    });

    socket.on('campaign-complete', ({ successCount, failCount }) => {
        setCampaignStatus(prev => ({ ...prev, isRunning: false }));
        toast.success(`Campanha finalizada! ✅ ${successCount} / ❌ ${failCount}`);
    });

    return () => { socket.disconnect(); };
  }, []);

  // --- ACTIONS ---
  const addConnection = (name: string) => socketRef.current?.emit('create-connection', { name });
  const removeConnection = (id: string) => socketRef.current?.emit('delete-connection', { id });
  
  // Start Campaign: Agora envia connectionIds para o backend
  const startCampaign = async (sessionId: string, numbers: string[], message: string, connectionIds?: string[]) => {
    const targetConnections = connectionIds || [sessionId];
    
    // Salva histórico no Firebase
    try {
      await addDoc(collection(db, "campaigns"), {
          name: `Disparo ${new Date().toLocaleString()}`,
          message,
          total: numbers.length,
          status: 'STARTED',
          createdAt: new Date(),
          connectionIds: targetConnections
      });
    } catch(e) { console.error("Erro ao salvar log", e); }
    
    // Dispara evento real para o backend processar
    socketRef.current?.emit('start-campaign', { 
        numbers, 
        message, 
        connectionIds: targetConnections 
    });
  };

  // Resto das funções auxiliares...
  const updateConnectionStatus = (id: string, status: ConnectionStatus) => setConnections(prev => prev.map(c => c.id === id ? { ...c, status } : c));
  const reconnectConnection = (id: string) => toast('Recurso não implementado no demo');
  const addContact = async (contact: Contact) => { const {id, ...d} = contact; const ref = await addDoc(collection(db, "contacts"), d); return ref.id; };
  const removeContact = async (id: string) => { await deleteDoc(doc(db, "contacts", id)); };
  const createContactList = async (name: string, contactIds: string[], description?: string) => { const ref = await addDoc(collection(db, "contact_lists"), { name, contactIds, description: description||'', createdAt: new Date().toISOString() }); return ref.id; };
  const deleteContactList = async (id: string) => { await deleteDoc(doc(db, "contact_lists", id)); };
  const sendMessage = (conversationId: string, text: string) => socketRef.current?.emit('send-message', { conversationId, text });
  const markAsRead = (conversationId: string) => {};
  const addCampaignToHistory = (c: Campaign) => setCampaignsHistory(prev => [c, ...prev]);

  return (
    <ZapMassContext.Provider value={{
      socket: socketRef.current,
      connections, contacts, contactLists, metrics, birthdays, conversations, isBackendConnected,
      campaignStatus, campaignsHistory, addCampaignToHistory,
      addConnection, removeConnection, updateConnectionStatus, reconnectConnection,
      addContact, removeContact, createContactList, deleteContactList,
      sendMessage, markAsRead, startCampaign
    }}>
      {children}
    </ZapMassContext.Provider>
  );
};

export const useZapMass = () => {
  const context = useContext(ZapMassContext);
  if (context === undefined) throw new Error('useZapMass must be used within a ZapMassProvider');
  return context;
};
