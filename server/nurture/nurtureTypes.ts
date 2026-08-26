export type NurtureStepKind = 'message' | 'wait_reply';

export type NurtureStepMedia = {
  url: string;
  mimeType: string;
  fileName: string;
  sendAsDocument?: boolean;
};

export type NurtureStepOption = {
  id: string;
  tokens: string[];
  reply: string;
  handoff?: boolean;
};

export type NurtureStep = {
  id: string;
  label?: string;
  kind: NurtureStepKind;
  body: string;
  /** Horas após o passo anterior (modo relativo). */
  delayHours?: number;
  /** Dia 0=Dom … 6=Sáb e hora HH:mm (modo calendário). */
  calendar?: { weekday: number; time: string };
  options?: NurtureStepOption[];
  timeoutHours?: number;
  timeoutMessage?: string;
  /** Imagem/vídeo/arquivo enviado com legenda = body. */
  media?: NurtureStepMedia;
  /** Link extra no final da mensagem (preview no WhatsApp). */
  linkUrl?: string;
};

export type NurtureSocialLinks = {
  instagram?: string;
  facebook?: string;
  youtube?: string;
  tiktok?: string;
  linkedin?: string;
  website?: string;
};

export type NurtureBusinessHours = {
  enabled: boolean;
  timezone: string;
  weekdays: number[];
  start: string;
  end: string;
};

export type NurtureJourneyDoc = {
  enabled: boolean;
  name: string;
  connectionIds: string[];
  scheduleMode: 'relative' | 'calendar';
  entryRules: {
    autoEnrollOnOptIn: boolean;
    /** Inscreve quem respondeu / está quente no engajamento (temperatura hot). */
    autoEnrollOnHotLead: boolean;
    requireMarketingOptIn: boolean;
    /** Chip usado na auto-inscrição (CRM) quando não veio de uma conversa. */
    defaultConnectionId?: string;
  };
  steps: NurtureStep[];
  businessHours: NurtureBusinessHours;
  stopOnHumanClaim: boolean;
  globalOptOutKeywords: string[];
  maxMessagesPerDayPerContact: number;
  socialLinks?: NurtureSocialLinks;
};

export type NurtureJourneyRow = {
  id: string;
  name: string;
  enabled: boolean;
  doc: NurtureJourneyDoc;
  createdAt: string;
  updatedAt: string;
};

export type NurtureEnrollmentStatus =
  | 'enrolled'
  | 'active'
  | 'waiting_reply'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type NurtureEnrollmentRow = {
  id: string;
  journeyId: string;
  contactPhone: string;
  connectionId: string;
  conversationId: string;
  status: NurtureEnrollmentStatus;
  currentStepIndex: number;
  stepEnteredAt: string;
  nextRunAt: string | null;
  enrolledAt: string;
  completedAt: string | null;
  pauseReason: string | null;
  contactName?: string | null;
};

export type NurtureMetrics = {
  materialsSent: number;
  repliesReceived: number;
  handoffs: number;
  optOuts: number;
  completed: number;
  activeEnrollments: number;
};

export const DEFAULT_NURTURE_JOURNEY_DOC: NurtureJourneyDoc = {
  enabled: true,
  name: 'Material para leads quentes',
  connectionIds: [],
  scheduleMode: 'relative',
  entryRules: {
    autoEnrollOnOptIn: true,
    autoEnrollOnHotLead: true,
    requireMarketingOptIn: true
  },
  steps: [
    {
      id: 'welcome',
      label: 'Boas-vindas',
      kind: 'message',
      body:
        'Olá, {nome}! 👋 Vou te enviar conteúdo ao longo da semana. Digite PARAR a qualquer momento para sair.',
      delayHours: 0
    },
    {
      id: 'day1',
      label: 'Material 1',
      kind: 'message',
      body: 'Confira este material de hoje 📎\n\nQualquer dúvida, é só responder aqui.',
      delayHours: 24
    },
    {
      id: 'day3',
      label: 'Material 2',
      kind: 'message',
      body: 'Seguindo nossa conversa — aqui está mais um conteúdo para você.',
      delayHours: 48
    },
    {
      id: 'cta',
      label: 'Chamada final',
      kind: 'wait_reply',
      body: 'Quer falar com alguém da equipe?\n\n1 — Sim, quero conversar\n2 — Depois',
      delayHours: 48,
      options: [
        { id: '1', tokens: ['1', 'sim', 'quero'], reply: 'Perfeito! Vou avisar a equipe — alguém fala com você em breve. 🙏', handoff: true },
        { id: '2', tokens: ['2', 'depois', 'nao', 'não'], reply: 'Sem problemas! Continuamos por aqui quando quiser.' }
      ],
      timeoutHours: 72,
      timeoutMessage: 'Quando quiser conversar, é só responder aqui. Até breve!'
    }
  ],
  businessHours: {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    weekdays: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '20:00'
  },
  stopOnHumanClaim: true,
  globalOptOutKeywords: ['parar', 'sair', 'cancelar', 'stop'],
  maxMessagesPerDayPerContact: 1
};
