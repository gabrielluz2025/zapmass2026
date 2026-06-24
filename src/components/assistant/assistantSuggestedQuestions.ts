export type AssistantSuggestion = {
  label: string;
  question: string;
  icon?: 'data' | 'help' | 'creative';
};

const QUICK: AssistantSuggestion[] = [
  { label: 'Resumo da conta', question: 'Resumo da minha conta', icon: 'data' },
  { label: 'Chips online', question: 'Quantos chips estão online?', icon: 'data' },
  { label: 'Total contatos', question: 'Quantos contatos tenho?', icon: 'data' },
  { label: 'Conectar chip', question: 'Como conectar um chip WhatsApp?', icon: 'help' }
];

const BY_SCREEN: Record<string, AssistantSuggestion[]> = {
  dashboard: [
    { label: 'Campanhas ativas', question: 'Quantas campanhas estão ativas?', icon: 'data' },
    { label: 'Meu plano', question: 'Qual o status da minha assinatura?', icon: 'data' },
    { label: 'Ir para campanhas', question: 'Como criar uma campanha?', icon: 'help' }
  ],
  connections: [
    { label: 'Status dos chips', question: 'Quais chips estão conectados?', icon: 'data' },
    { label: 'QR Code', question: 'Como escanear o QR Code?', icon: 'help' },
    { label: 'Chip offline', question: 'O que fazer se o chip ficar offline?', icon: 'help' }
  ],
  contacts: [
    { label: 'Total na base', question: 'Quantos contatos tenho?', icon: 'data' },
    { label: 'Importar CSV', question: 'Como importar contatos do Excel?', icon: 'help' },
    { label: 'Listas', question: 'Como criar uma lista de contatos?', icon: 'help' }
  ],
  campaigns: [
    { label: 'Campanhas recentes', question: 'Quais são minhas campanhas recentes?', icon: 'data' },
    { label: 'Nova campanha', question: 'Como criar uma campanha passo a passo?', icon: 'help' },
    { label: 'Mensagem cobrança', question: 'Sugira uma mensagem de cobrança', icon: 'creative' }
  ],
  chat: [
    { label: 'Usar bate-papo', question: 'Para que serve o bate-papo?', icon: 'help' },
    { label: 'Filtros inbox', question: 'Como filtrar conversas no bate-papo?', icon: 'help' }
  ],
  reports: [
    { label: 'Exportar CSV', question: 'Como exportar relatórios em CSV?', icon: 'help' },
    { label: 'Ver números', question: 'O que mostra a aba relatórios?', icon: 'help' }
  ],
  warmup: [
    { label: 'O que é aquecimento', question: 'O que é aquecimento de chip?', icon: 'help' },
    { label: 'Quando usar', question: 'Quando devo usar aquecimento?', icon: 'help' }
  ],
  subscription: [
    { label: 'Meu plano', question: 'Qual o status da minha assinatura?', icon: 'data' },
    { label: 'Renovar', question: 'Como renovar minha assinatura?', icon: 'help' }
  ],
  settings: [
    { label: 'Intervalo envio', question: 'Onde configuro intervalo entre envios?', icon: 'help' },
    { label: 'Tema escuro', question: 'Como mudar o tema claro/escuro?', icon: 'help' }
  ],
  help: [
    { label: 'Primeiros passos', question: 'Por onde começar no ZapMass?', icon: 'help' },
    { label: 'Boas práticas', question: 'Quais boas práticas para não ser bloqueado?', icon: 'help' }
  ]
};

export function getAssistantSuggestions(screen: string, limit = 6): AssistantSuggestion[] {
  const screenItems = BY_SCREEN[screen] ?? BY_SCREEN.dashboard ?? [];
  const seen = new Set<string>();
  const out: AssistantSuggestion[] = [];
  for (const item of [...screenItems, ...QUICK]) {
    const key = item.question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export const VIEW_LABEL_PT: Record<string, string> = {
  dashboard: 'Painel',
  connections: 'Conexões',
  chat: 'Bate-papo',
  campaigns: 'Campanhas',
  contacts: 'Contatos',
  reports: 'Relatórios',
  warmup: 'Aquecimento',
  subscription: 'Assinatura',
  settings: 'Configurações',
  help: 'Como usar',
  team: 'Funcionários'
};
