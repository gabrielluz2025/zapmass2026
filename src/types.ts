
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
  /** Proxy HTTP/SOCKS na Evolution API para este chip. */
  proxy?: {
    enabled: boolean;
    host?: string;
    port?: string;
    protocol?: string;
  };
  dailyLimit?: number;
  growthRate?: number;
  growthType?: 'percent' | 'fixed';
  limitAction?: 'ask' | 'redirect';
  limitExceededApproved?: boolean;
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
  /** Fila inicial concluída; aguardando respostas para etapas seguintes (reply flow / multi-etapas). */
  WAITING_REPLY = 'WAITING_REPLY',
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
  messageStages?: string[];
  connectionIds?: string[];
  delaySeconds?: number;
  recipients?: Array<{ phone: string; vars: Record<string, string> }>;
  replyFlow?: CampaignReplyFlow;
  /** Usuário confirmou envio mesmo com contatos no limite de 24 h. */
  skipFrequencyCap?: boolean;
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

// ─── Motor multi-etapas persistente ─────────────────────────────────────────

/** Define como cada etapa é disparada no motor multi-etapas. */
export type CampaignStageTriggerType = 'immediate' | 'delay' | 'any_reply' | 'conditional';

/**
 * Configuração avançada de uma etapa de campanha.
 * Presente em Campaign.stageConfigs[] quando o motor persistente estiver habilitado.
 */
export interface CampaignStageConfig {
  /** Corpo da mensagem desta etapa (suporta variáveis e spintax). */
  body: string;
  /** Como esta etapa dispara a próxima. Default: 'delay'. */
  trigger_type: CampaignStageTriggerType;
  /**
   * Condição de texto para trigger_type='conditional'.
   * Ex: { contains: 'sim' } | { regex: '^(sim|yes)$' }
   */
  trigger_condition?: { contains?: string; regex?: string };
  /** Para any_reply/conditional: horas antes de expirar sem resposta. */
  timeout_hours?: number;
  /** Ação ao expirar: 'skip' | 'complete' | índice do step (string numérica). */
  timeout_action?: 'skip' | 'complete' | string;
  /** Índice da próxima etapa quando condição BATE (trigger_type='conditional'). */
  next_step_on_match?: number;
  /** Índice da próxima etapa quando condição NÃO bate (trigger_type='conditional'). */
  next_step_on_no_match?: number;
}

/** Etapa em campanha com fluxo por resposta (aguarda resposta antes da proxima). */
export interface CampaignReplyFlowStep {
  body: string;
  /** Se true, qualquer texto nao vazio do contato avanca para a proxima etapa. */
  acceptAnyReply?: boolean;
  /** Se acceptAnyReply for false: respostas aceitas (ex.: 1, 2, sim). Comparacao sem distincao de maiusculas. */
  validTokens?: string[];
  /** Enviado quando acceptAnyReply e false e a resposta nao for aceita; nao avanca de etapa. */
  invalidReplyBody?: string;
  /**
   * Quando o contato responde valido nesta etapa, aplica consentimento de marketing no CRM.
   * Nao enviado = sem efeito (equivalente a `none`).
   */
  marketingEffect?: 'none' | 'opt_in' | 'opt_out';
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
  /** Relatório consolidado (VPS) — disponível após conclusão ou via GET /report. */
  reportSnapshot?: {
    builtAt: string;
    logCount: number;
    rows: Array<{
      phone: string;
      contactName: string;
      status: string;
      sentTime: string;
      sentTimestampMs: number;
      replyText?: string;
      replyTime?: string;
      replyTimestampMs?: number;
      connectionId?: string;
      errorMessage?: string;
    }>;
    replyPhones: Record<string, { replyText?: string; replyTimestampMs: number }>;
    stageFunnels: Array<{
      stageNumber: number;
      label: string;
      sent: number;
      delivered: number;
      read: number;
      replied: number;
      deliveryPct: number;
      readPct: number;
      replyPct: number;
    }>;
    totals: { sent: number; delivered: number; read: number; replied: number };
  };
  reportSnapshotAt?: string;
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
  /**
   * Configuração avançada por etapa (motor multi-etapas persistente).
   * Quando presente, cada etapa pode ter trigger_type diferente.
   * Substitui messageStages para novas campanhas com fluxo condicional.
   */
  stageConfigs?: CampaignStageConfig[];
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
  /** Mensagens enviadas por dia (YYYY-MM-DD), contabilizadas no servidor. */
  sentByDay?: Record<string, number>;
  deliveredByDay?: Record<string, number>;
  readByDay?: Record<string, number>;
  repliedByDay?: Record<string, number>;
  /** Por dia e campanha (campaignId → quantidade). */
  sentByDayByCampaign?: Record<string, Record<string, number>>;
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
/** Provedor de cobrança ativo no produto: apenas Mercado Pago. `infinitepay` pode aparecer em docs Firestore antigos. */
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

/**
 * Ficha eclesiástica / cadastro alargado (segmento religioso).
 * Gravado em Firestore dentro do documento do contacto; a aba Contatos pode ignorar campos não mapeados.
 */
export interface ReligiousMemberProfile {
  rg?: string;
  rgIssueDate?: string;
  rgIssuer?: string;
  cpf?: string;
  nationality?: string;
  birthPlace?: string;
  gender?: 'M' | 'F' | '';
  landline?: string;
  educationLevel?: string;
  fatherName?: string;
  motherName?: string;
  maritalStatus?: string;
  spouseName?: string;
  weddingDate?: string;
  /** Funções ministeriais (ex.: Diácono, Pastor). */
  ministerRoles?: string[];
  /** Liderança de conjunto (ex.: Jovens, Irmãs). */
  leaderGroups?: string[];
  professionOfFaith?: string;
  baptismDate?: string;
  previousChurch?: string;
  previousPastor?: string;
  receivedBy?: 'faith' | 'transfer' | 'acclaim' | '';
  churchJoinDate?: string;
  baptizedHolySpirit?: 'yes' | 'no' | '';
  holySpiritDate?: string;
  country?: string;
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
  /** Coordenadas (geocodificação no CRM). */
  latitude?: number;
  longitude?: number;
  geocodedAt?: string;
  /** Qualidade da última geocodificação: street ≈ rua, cep ≈ CEP, city ≈ só cidade. */
  geocodePrecision?: 'street' | 'cep' | 'neighborhood' | 'city';
  church?: string;
  role?: string;
  profession?: string;
  birthday?: string;
  email?: string;
  notes?: string;
  tags: string[];
  status: 'VALID' | 'INVALID';
  /** Lista negra de marketing: nao recebe disparos em massa. */
  marketingOptOut?: boolean;
  /** Lead autorizou marketing (opt-in positivo ou manual). */
  marketingOptIn?: boolean;
  /** Quando o consentimento ou bloqueio foi registrado. */
  marketingConsentAt?: string;
  /** Ultima mensagem do contato ligada a autorizacao/negativa. */
  marketingConsentText?: string;
  /** Quantas mensagens de campanha ja foram enviadas a este numero (incrementado pelo app). */
  campaignMessagesReceived?: number;
  /** Resumo para lista: última campanha tocada + etapas (denormalizado no envio). */
  campaignTablePreview?: ContactCampaignTablePreview;
  lastMsg?: string;
  /** Data/hora (ISO UTC) agendada para retorno/contato de seguimento. */
  followUpAt?: string;
  /** Nota opcional ligada ao retorno (ex.: contexto para a ligação). */
  followUpNote?: string;
  /** Ficha de membro (cadastro religioso alargado). */
  religiousMemberProfile?: ReligiousMemberProfile;
  /** Foto de perfil do WhatsApp (busca via chip conectado; persistida no CRM). */
  profilePicUrl?: string;
  /** ISO UTC de quando o endereço foi normalizado automaticamente (ViaCEP + IBGE). */
  addressNormalizedAt?: string;
}

/** Uma linha em `users/{uid}/contacts/{id}/campaignDeliveries/{campaignId}` — envios por campanha. */
export interface ContactCampaignDelivery {
  campaignId: string;
  /** Nome da campanha (cache para o cartao do contato). */
  campaignName?: string;
  /** Mensagens desta campanha já entregues neste contato (Socket «Mensagem enviada»). */
  sentCount: number;
  /** Etapas previstas na campanha quando o resumo foi atualizado. */
  totalStages: number;
  updatedAt?: string;
}

/** Resumo denormalizado no documento do contato (coluna da tabela + sync com drawer). */
export interface ContactCampaignTablePreview {
  campaignId: string;
  campaignName: string;
  sent: number;
  totalStages: number;
  pending: number;
  updatedAt: string;
}

// --- CHAT TYPES ---
export interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
  sender: 'me' | 'them';
  status: 'pending' | 'sent' | 'delivered' | 'read';
  type: 'text' | 'image' | 'audio' | 'sticker' | 'video' | 'document';
  mediaUrl?: string; // URL para imagem/sticker/video/document
  fromCampaign?: boolean; // true quando a mensagem foi enviada por um disparo de campanha
  campaignId?: string;    // id da campanha que originou essa mensagem (quando aplicavel)
  timestampMs?: number;   // epoch em ms para ordenacao e comparacao precisa de respostas
  /** Metadados WA para resolver @lid → telefone no servidor. */
  waRemoteJidAlt?: string;
  waSenderPn?: string;
}

export interface Conversation {
  id: string;
  contactName: string;
  /** Nome salvo no celular/WhatsApp antes de substituir por `contactName` da base. */
  waContactName?: string;
  contactPhone: string;
  /** JID @s.whatsapp.net quando o chat principal é @lid (agenda / CRM). */
  waJidAlt?: string;
  profilePicUrl?: string;
  connectionId: string; // Qual chip está conversando
  /** Dono do canal (ids legados `conn_*`); enviado pelo servidor para escopo antes de `connections-update`. */
  connectionOwnerUid?: string;
  unreadCount: number;
  lastMessage: string;
  lastMessageTime: string;
  lastMessageTimestamp?: number; // Unix ms — ordenação real
  messages: ChatMessage[];
  tags: string[];
  /** Quem assumiu o atendimento (UID Firebase); definido pelo servidor na lista do inbox. */
  inboxClaimedByAuthUid?: string;
  /** Presença WhatsApp (webhook PRESENCE_UPDATE). */
  waPresence?: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';
  /** Última vez visto (ms), quando `waPresence` é unavailable ou expirou. */
  waLastSeenMs?: number;
  /** Timestamp (ms) do último evento de presença recebido. */
  waPresenceUpdatedAt?: number;
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
  /** Paginação de contatos (Firestore). `contacts` contém apenas o que já foi carregado. */
  contactsHasMore?: boolean;
  contactsLoadingMore?: boolean;
  loadMoreContacts?: () => Promise<void>;
  /** Carrega todas as páginas restantes em lotes grandes (background). */
  loadAllContacts?: () => Promise<void>;
  /** Total de documentos em `users/{uid}/contacts` (agregado Firestore), independente do que está em memória. */
  contactsSavedTotal?: number | null;
  contactsSavedTotalLoading?: boolean;
  refreshContactsSavedTotal?: () => Promise<void>;
  contactLists: ContactList[]; // Nova propriedade
  campaigns: Campaign[];
  metrics: DashboardMetrics;
  birthdays: BirthdayContact[];
  conversations: Conversation[];
  /** Paginação da inbox (socket `inbox-page`). */
  inboxHasMore?: boolean;
  inboxLoadingMore?: boolean;
  inboxTotal?: number;
  loadMoreInbox?: () => void;
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
  addConnection: (
    name: string,
    proxy?: { host: string; port: string | number; protocol?: string; username?: string; password?: string }
  ) => void | Promise<void>;
  setConnectionProxy: (
    id: string,
    proxy: { host: string; port: string | number; protocol?: string; username?: string; password?: string } | null
  ) => void | Promise<void>;
  removeConnection: (id: string) => void;
  updateConnectionStatus: (id: string, status: ConnectionStatus) => void;
  reconnectConnection: (id: string) => void | Promise<void>;
  forceQr: (id: string) => void | Promise<void>;
  renameConnection: (id: string, name: string) => void | Promise<void>;
  updateConnectionSettings: (
    id: string,
    settings: {
      dailyLimit?: number;
      growthRate?: number;
      growthType?: 'percent' | 'fixed';
      limitAction?: 'ask' | 'redirect';
      limitExceededApproved?: boolean;
    }
  ) => void | Promise<void>;
  addContact: (contact: Contact, options?: { silent?: boolean }) => Promise<string | void> | void;
  /** Grava vários contactos novos em lotes; ordem dos IDs corresponde à dos elementos. */
  bulkAddContacts: (
    contacts: Contact[],
    options?: { silent?: boolean; skipReload?: boolean }
  ) => Promise<string[]>;
  removeContact: (id: string, options?: { silent?: boolean }) => Promise<void> | void;
  /** assumeUserDoc: só `users/{uid}/contacts/{id}` — sem getDoc (rápido para importação em massa). */
  updateContact: (
    id: string,
    updates: Partial<Contact>,
    options?: { silent?: boolean; assumeUserDoc?: boolean }
  ) => Promise<void>;
  /** Atualizações em batch na coleção do utilizador (sem getDoc por documento). */
  bulkUpdateContacts: (
    items: Array<{ id: string; updates: Partial<Contact> }>,
    options?: { silent?: boolean; skipReload?: boolean }
  ) => Promise<void>;
  /** Recarrega a lista de contatos do servidor (útil após importação em massa). */
  refreshContacts: () => Promise<void>;
  createContactList: (name: string, contactIds: string[], description?: string) => Promise<string>;
  /** Acrescenta IDs à lista (`users/{uid}/contact_lists`) com transação — merge com `contactIds` actuais. */
  appendContactIdsToContactList: (
    listId: string,
    contactIds: string[],
    options?: { notesLine?: string }
  ) => Promise<void>;
  deleteContactList: (id: string) => Promise<void>;
  updateContactList: (id: string, updates: Partial<ContactList>) => Promise<void>;
  sendMessage: (conversationId: string, text: string) => void;
  sendMedia: (
    conversationId: string,
    payload: {
      dataBase64: string;
      mimeType: string;
      fileName: string;
      caption?: string;
      sendMediaAsDocument?: boolean;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  markAsRead: (conversationId: string) => void;
  fetchConversationPicture: (conversationId: string) => void;
  deleteLocalConversations: (conversationIds: string[]) => Promise<number>;
  loadChatHistory: (conversationId: string, limit?: number, includeMedia?: boolean) => Promise<{ ok: boolean; total: number; error?: string }>;
  /** Une só o arquivo Firestore na conversa (sem fetch WhatsApp); ao abrir o chat. */
  hydrateFirestoreChatArchive: (
    conversationId: string,
    limit?: number
  ) => Promise<{ ok: boolean; total: number; error?: string }>;
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
      stageConfigs?: CampaignStageConfig[];
      /** Anexo unico (foto, video ou arquivo) que vai com a 1a etapa. */
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
      /** Ignora limite de 24 h — só após confirmação explícita na triagem. */
      skipFrequencyCap?: boolean;
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
      skipFrequencyCap?: boolean;
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
  /** Actualização optimista da reivindicação de inbox (claim/transfer) antes ou além do `conversations-update`. */
  patchConversationInboxClaim: (conversationId: string, inboxClaimedByAuthUid: string | undefined) => void;
  /** Conexões com circuit-breaker aberto no servidor (envios temporariamente bloqueados). */
  circuitBreakerOpenConnectionIds: string[];
}
