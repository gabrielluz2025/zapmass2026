export type SupportBotMenuOption = {
  id: string;
  label: string;
  reply: string;
  handoff?: boolean;
};

export type SupportBotBusinessHours = {
  enabled: boolean;
  timezone: string;
  /** 0=dom … 6=sáb */
  weekdays: number[];
  start: string;
  end: string;
};

export type SupportBotConfig = {
  enabled: boolean;
  /** Vazio = todos os chips do tenant */
  connectionIds: string[];
  welcomeMessage: string;
  menuPrompt: string;
  options: SupportBotMenuOption[];
  offHoursMessage: string;
  handoffMessage: string;
  invalidOptionMessage: string;
  humanKeywords: string[];
  businessHours: SupportBotBusinessHours;
  /** Bot só responde fora do horário comercial */
  botOnlyOutsideHours: boolean;
  menuCooldownMinutes: number;
};

export type SupportBotMetrics = {
  botReplies: number;
  handoffs: number;
  menuShown: number;
};

export const DEFAULT_SUPPORT_BOT_CONFIG: SupportBotConfig = {
  enabled: false,
  connectionIds: [],
  welcomeMessage: 'Olá! 👋 Sou o assistente automático. Como posso ajudar?',
  menuPrompt: 'Digite o número da opção:',
  options: [
    {
      id: '1',
      label: 'Horário de atendimento',
      reply: 'Atendemos de segunda a sexta, das 9h às 18h (horário de Brasília).'
    },
    {
      id: '2',
      label: 'Endereço / localização',
      reply: 'Informe sua cidade na mensagem seguinte que encaminhamos ao time.'
    },
    {
      id: '3',
      label: 'Falar com atendente',
      reply: '',
      handoff: true
    }
  ],
  offHoursMessage:
    'No momento estamos fora do horário de atendimento. Deixe sua mensagem — retornamos assim que possível.',
  handoffMessage: 'Certo! Vou chamar um atendente humano. Aguarde um instante, por favor. 🙏',
  invalidOptionMessage: 'Não entendi essa opção. Escolha um número do menu abaixo:',
  humanKeywords: ['atendente', 'humano', 'pessoa', 'falar com alguem', 'falar com alguém'],
  businessHours: {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    weekdays: [1, 2, 3, 4, 5],
    start: '09:00',
    end: '18:00'
  },
  botOnlyOutsideHours: false,
  menuCooldownMinutes: 20
};
