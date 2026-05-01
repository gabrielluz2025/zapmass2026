
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
  qrCode?: string;
  queueSize: number;
  messagesSentToday: number;
  totalMessagesSent?: number;
  connectedSince?: number;
  healthScore?: number;
  signalStrength: 'STRONG' | 'MEDIUM' | 'WEAK';
  ownerUid?: string;
  /**
   * Sessão considerada inválida: cliente autentica via LocalAuth mas o
   * WhatsApp Web nunca chega a `ready` (servidor revogou o aparelho).
   * Quando true: nenhuma reconexão automática é tentada e o boot do worker
   * NÃO restaura este canal. Utilizador tem de pedir QR/pareamento de novo.
   */
  sessionZombie?: boolean;
}

export interface SystemMetrics {
  cpu: number;
  ram: number;
  uptime: string;
  latency?: number;
  ramTotalGb?: number;
  ramFreeGb?: number;
  ramUsedGb?: number;
  platform?: string;
}

export interface NavItem {
  id: string;
  label: string;
  icon: any; 
  active?: boolean;
}

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  /** Aguardando horário (próximo disparo em nextRunAt). */
  SCHEDULED = 'SCHEDULED',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

/** Um horário por dia da semana (0 = domingo … 6 = sábado, como Date#getDay). */
export interface CampaignScheduleSlot {
  dayOfWeek: number;
  /** "HH:mm" 24h */
  time: string;
}

export interface CampaignWeeklySchedule {
  slots: CampaignScheduleSlot[];
}

/** Snapshot usado pelo servidor para disparo agendado (espelha o payload de start-campaign). */
export interface CampaignScheduleStartSnapshot {
  numbers: string[];
  message: string;
  messageStages: string[];
  connectionIds: string[];
  delaySeconds?: number;
  recipients?: Array<{ phone: string; vars: Record<string, string> }>;
  replyFlow?: CampaignReplyFlow;
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

/** Etapa em campanha com fluxo por resposta (aguarda resposta antes da proxima). */
export interface CampaignReplyFlowStep {
  body: string;
  /** Se true, qualquer texto nao vazio do contato avanca para a proxima etapa. */
  acceptAnyReply: boolean;
  /** Se acceptAnyReply for false: respostas aceitas (ex.: 1, 2, sim). Comparacao sem distincao de maiusculas. */
  validTokens?: string[];
  /** Enviado quando acceptAnyReply e false e a resposta nao for aceita; nao avanca de etapa. */
  invalidReplyBody?: string;
}

/** Fluxo conversacional: etapa 1 enviada na abertura; proximas apos resposta do contato. */
export interface CampaignReplyFlow {
  enabled: boolean;
  steps: CampaignReplyFlowStep[];
}

export interface Campaign {
  id: string;
  name: string;
  message: string;
  /** Varias mensagens por contato, na ordem (etapa 1, 2, ...). O intervalo entre envios vale entre cada etapa. */
  messageStages?: string[];
  /** Quando enabled, o servidor nao envia etapas 2+ em sequencia: aguarda resposta conforme cada etapa. */
  replyFlow?: CampaignReplyFlow;
  totalContacts: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  status: CampaignStatus;
  selectedConnectionIds: string[];
  /** Peso relativo por chip (1 = base) para distribuir envios; opcional. */
  channelWeights?: Record<string, number>;
  contactListId?: string; 
  contactListName?: string; 
  logs?: CampaignLog[];
  createdAt: string;
  delaySeconds?: number;
  /** IANA, ex. America/Sao_Paulo — usado com weeklySchedule. */
  scheduleTimeZone?: string;
  /** Janelas semanais quando status é SCHEDULED. */
  weeklySchedule?: CampaignWeeklySchedule;
  /** Se true, após cada conclusão recalcula nextRunAt; se false, uma execução e depois COMPLETED. */
  scheduleRepeatWeekly?: boolean;
  /** Quando definido com scheduleRepeatWeekly false: data do calendário (YYYY-MM-DD) no fuso scheduleTimeZone. */
  scheduleOnceLocalDate?: string;
  /** Horário HH:mm no mesmo dia (um disparo pontual coordenado com scheduleOnceLocalDate). */
  scheduleOnceLocalTime?: string;
  /** Próximo disparo (ISO 8601 UTC). */
  nextRunAt?: string;
  lastRunAt?: string;
  /** Preenchido em campanhas agendadas para o worker disparar sem depender do cliente. */
  scheduleStartSnapshot?: CampaignScheduleStartSnapshot;
}

export interface DashboardMetrics {
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalReplied: number;
}

// Contadores acumulados do "Funil de Desempenho" — persistidos no servidor.
// Sao independentes de campanhas individuais: quando uma campanha e excluida,
// estes numeros NAO mudam (preservam o historico). Podem ser zerados manualmente
// pelo usuario via botao "Limpar" no painel.
export interface FunnelStats {
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalReplied: number;
  updatedAt: number;
  clearedAt?: number;
}

/** Agregação por UF (DDD) para mapa de campanha — entregue / lido / resposta */
export interface CampaignGeoUfStats {
  delivered: number;
  read: number;
  replied: number;
}

export interface CampaignGeoState {
  campaignId: string | null;
  byUf: Record<string, CampaignGeoUfStats>;
  updatedAt: number;
}

// Estatisticas de aquecimento por chip (persistente no servidor)
export interface WarmupDailyEntry {
  date: string; // YYYY-MM-DD
  sent: number;
  received: number;
  failed: number;
}
export interface WarmupChipStats {
  connectionId: string;
  firstWarmedAt?: number;
  lastActiveAt?: number;
  totalSent: number;
  totalReceived: number;
  totalFailed: number;
  dailyHistory: WarmupDailyEntry[];
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

/** Estado da assinatura (Firestore `userSubscriptions/{uid}`), atualizado pelos webhooks no servidor. */
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
export type SubscriptionProvider = 'mercadopago' | 'infinitepay' | 'none';

export interface UserSubscription {
  status: SubscriptionStatus;
  provider: SubscriptionProvider;
  plan: 'monthly' | 'annual' | null;
  mercadoPagoPreapprovalId?: string;
  mercadoPagoLastPaymentId?: string;
  infinitePayReference?: string;
  /** Fim do teste gratuito (1h), Timestamp Firestore. */
  trialEndsAt?: unknown;
  /** Fim do periodo pago (mensal = +1 mes calendario; anual = +12 meses a partir da renovacao). */
  accessEndsAt?: unknown;
  /** Quantidade de canais incluídos no plano contratado (1–5). */
  includedChannels?: number;
  /** Evita segundo teste de 1h na mesma conta. */
  freeTrialUsed?: boolean;
  /** Id da NFS-e mais recente emitida (NFE.io). */
  nfeLastInvoiceId?: string;
  /** Status (Processing|Issued|Cancelled|Error). */
  nfeLastInvoiceStatus?: string;
  /** URL publica do PDF da NFS-e emitida (disponivel apos aprovacao da prefeitura). */
  nfeLastInvoicePdfUrl?: string;
  /** Liberacao manual concedida pelo admin (independente de contrato). */
  manualGrant?: boolean;
  /** Fim da liberacao manual (Timestamp Firestore). Se vazio, sem prazo. */
  manualAccessEndsAt?: unknown;
  /** Conta bloqueada manualmente pelo admin. */
  blocked?: boolean;
  /** Observacao administrativa sobre acesso manual/bloqueio. */
  adminNote?: string;
  /** Legado: canais além do incluído (modelo antigo base 2 + add-on). */
  extraChannelSlots?: number;
  /** Assinatura MP do pacote de canais extras (débito recorrente). */
  mercadoPagoChannelAddonPreapprovalId?: string;
  /** Pagamento MP que aprovou add-on de canais avulso (uma vez). */
  mercadoPagoChannelAddonOneTimePaymentId?: string;
  /** Canais extras liberados manualmente pelo criador (0–3), além dos 2 incluídos. */
  manualExtraChannelSlots?: number;
  /** Vencimento da liberação manual de canais extras. */
  manualExtraChannelSlotsEndsAt?: unknown;
  updatedAt?: unknown;
}

export interface Contact {
  id: string;
  /** IDs de documento legados (ex.: /contacts) que foram unidos a este contato pelo mesmo telefone — listas antigas ainda referenciam esses IDs. */
  aliasContactIds?: string[];
  name: string;
  phone: string;
  city?: string;
  state?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  zipCode?: string;
  church?: string;
  role?: string;
  profession?: string;
  birthday?: string;
  email?: string;
  notes?: string;
  tags: string[];
  status: 'VALID' | 'INVALID';
  lastMsg?: string;
  /** Data/hora (ISO UTC) agendada para retorno/contato de seguimento. */
  followUpAt?: string;
  /** Nota opcional ligada ao retorno (ex.: contexto para a ligação). */
  followUpNote?: string;
}

// --- CHAT TYPES ---
export interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
  sender: 'me' | 'them';
  status: 'sent' | 'delivered' | 'read';
  type: 'text' | 'image' | 'audio' | 'sticker' | 'video' | 'document';
  mediaUrl?: string; // URL para imagem/sticker/video/document
  fromCampaign?: boolean; // true quando a mensagem foi enviada por um disparo de campanha
  campaignId?: string;    // id da campanha que originou essa mensagem (quando aplicavel)
  timestampMs?: number;   // epoch em ms para ordenacao e comparacao precisa de respostas
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
  lastMessageTimestamp?: number; // Unix ms — ordenação real
  messages: ChatMessage[];
  tags: string[];
}

export interface SystemLog {
  timestamp: string;
  event: string;
  payload?: Record<string, unknown>;
}

export interface WarmupItem {
  to: string;
  connectionId: string;
  message: string;
  campaignId?: string;
  createdAt: string;
  reason: string;
}

// Context Type Definition
export interface ZapMassContextType {
  connections: WhatsAppConnection[];
  contacts: Contact[];
  contactLists: ContactList[]; // Nova propriedade
  campaigns: Campaign[];
  metrics: DashboardMetrics;
  birthdays: BirthdayContact[];
  conversations: Conversation[];
  systemLogs: SystemLog[];
  warmupQueue: WarmupItem[];
  warmedCount: number;
  isBackendConnected: boolean;
  /** Carga de sessão (workers/concorrência) recebida via socket; undefined enquanto não chega. */
  sessionLiveStats?: {
    workersAlive: number;
    inFlight: number;
    waiting: number;
    maxConcurrent: number;
    pendingAssignments: number;
    busRemote: boolean;
  } | null;
  
  // Campaign State
  campaignStatus: {
    isRunning: boolean;
    total: number;
    processed: number;
    success: number;
    failed: number;
  };

  // Actions
  addConnection: (name: string) => void | Promise<void>;
  removeConnection: (id: string) => void;
  updateConnectionStatus: (id: string, status: ConnectionStatus) => void;
  reconnectConnection: (id: string) => void | Promise<void>;
  forceQr: (id: string) => void | Promise<void>;
  renameConnection: (id: string, name: string) => void | Promise<void>;
  addContact: (contact: Contact) => Promise<string | void> | void;
  removeContact: (id: string, options?: { silent?: boolean }) => Promise<void> | void;
  updateContact: (id: string, updates: Partial<Contact>) => Promise<void>;
  createContactList: (name: string, contactIds: string[], description?: string) => Promise<void>;
  deleteContactList: (id: string) => Promise<void>;
  updateContactList: (id: string, updates: Partial<ContactList>) => Promise<void>;
  sendMessage: (conversationId: string, text: string) => void;
  sendMedia: (
    conversationId: string,
    payload: { dataBase64: string; mimeType: string; fileName: string; caption?: string }
  ) => Promise<{ ok: boolean; error?: string }>;
  markAsRead: (conversationId: string) => void;
  fetchConversationPicture: (conversationId: string) => void;
  deleteLocalConversations: (conversationIds: string[]) => Promise<number>;
  loadChatHistory: (conversationId: string, limit?: number, includeMedia?: boolean) => Promise<{ ok: boolean; total: number; error?: string }>;
  loadMessageMedia: (conversationId: string, messageId: string) => Promise<{ ok: boolean; mediaUrl?: string; error?: string }>;
  markWarmupReady: (numbers: string[]) => void;
  pauseCampaign: (campaignId: string) => void;
  resumeCampaign: (campaignId: string) => void;
  deleteCampaign: (campaignId: string) => Promise<void>;
  deleteCampaigns: (campaignIds: string[]) => Promise<void>;
  startCampaign: (
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
  ) => Promise<string>;
  /** Grava campanha como agendada (sem socket); o servidor dispara no horário. */
  scheduleCampaign: (
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
  ) => Promise<string>;
  funnelStats: FunnelStats;
  clearFunnelStats: () => void;
  campaignGeo: CampaignGeoState;
  warmupChipStats: Record<string, WarmupChipStats>;
  clearWarmupChipStats: (connectionId?: string) => void;
  clearAllUserData: () => Promise<{
    contacts: number;
    contactLists: number;
    campaigns: number;
    campaignLogs: number;
    errors: number;
  }>;
}
