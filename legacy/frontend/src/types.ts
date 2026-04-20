
export enum ConnectionStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  QR_READY = 'QR_READY',
  SUSPENDED = 'SUSPENDED', 
  BUSY = 'BUSY'
}

export interface WhatsAppConnection {
  id: string;
  name: string;
  phoneNumber: string | null; 
  status: ConnectionStatus;
  lastActivity: string;
  batteryLevel?: number;
  profilePicUrl?: string;
  queueSize: number;
  messagesSentToday: number;
  signalStrength: 'STRONG' | 'MEDIUM' | 'WEAK';
}

export interface NavItem {
  id: string;
  label: string;
  icon: any; 
  active?: boolean;
}

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SCHEDULED = 'SCHEDULED'
}

export interface CampaignLog {
  id: string;
  timestamp: Date;
  message: string;
  type: 'INFO' | 'ERROR' | 'SUCCESS' | 'WARNING';
}

export interface ContactList {
  id: string;
  name: string;
  contactIds: string[]; // IDs dos contatos que pertencem a esta lista
  description?: string;
  createdAt: string;
  tags?: string[];
  count?: number;
  lastUpdated?: string;
}

export interface Campaign {
  id: string;
  name: string;
  message: string;
  totalContacts: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  status: CampaignStatus;
  selectedConnectionIds: string[]; 
  contactListId?: string; 
  contactListName?: string; 
  logs: CampaignLog[];
  createdAt: string;
  scheduledFor?: string; // Data ISO
}

export interface DashboardMetrics {
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalReplied: number;
}

export interface BirthdayContact {
  id: string;
  name: string;
  phoneNumber: string;
  birthDate: string; 
  daysRemaining: number; 
  profilePicUrl?: string;
  lastConnectionId?: string; 
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  city?: string;          
  church?: string;        
  role?: string;          
  tags: string[];
  status: 'VALID' | 'INVALID';
  lastMsg?: string;
  source?: 'MANUAL' | 'IMPORT' | 'SYNC'; // Origem do contato
}

// --- CHAT TYPES ---
export interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
  sender: 'me' | 'them';
  status: 'sent' | 'delivered' | 'read';
  type: 'text' | 'image' | 'audio';
}

export interface Conversation {
  id: string;
  contactName: string;
  contactPhone: string;
  profilePicUrl?: string;
  connectionId: string; // Qual chip está conversando
  unreadCount: number;
  lastMessage: string;
  lastMessageTime: string;
  messages: ChatMessage[];
  tags: string[];
}

// Context Type Definition
export interface ZapMassContextType {
  connections: WhatsAppConnection[];
  contacts: Contact[];
  contactLists: ContactList[]; 
  metrics: DashboardMetrics;
  birthdays: BirthdayContact[];
  conversations: Conversation[];
  isBackendConnected: boolean;
  
  // Campaign State
  campaignStatus: {
    isRunning: boolean;
    total: number;
    processed: number;
    success: number;
    failed: number;
  };
  campaignsHistory: Campaign[];
  addCampaignToHistory: (c: Campaign) => void;

  // Actions
  addConnection: (name: string) => void;
  removeConnection: (id: string) => void;
  updateConnectionStatus: (id: string, status: ConnectionStatus) => void;
  reconnectConnection: (id: string) => void;
  addContact: (contact: Contact) => Promise<string | null>; 
  removeContact: (id: string) => Promise<void> | void;
  createContactList: (name: string, contactIds: string[], description?: string) => Promise<string | null>;
  deleteContactList: (id: string) => Promise<void>;
  sendMessage: (conversationId: string, text: string) => void;
  markAsRead: (conversationId: string) => void;
  startCampaign: (sessionId: string, numbers: string[], message: string, connectionIds?: string[]) => void;
}
