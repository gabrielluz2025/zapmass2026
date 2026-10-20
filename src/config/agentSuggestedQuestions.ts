export type AgentSuggestionIcon = 'data' | 'help' | 'creative';

export type AgentSuggestion = {
  label: string;
  question: string;
  icon?: AgentSuggestionIcon;
};

const QUICK: AgentSuggestion[] = [
  { label: 'Resumo da conta', question: 'Resumo da minha conta', icon: 'data' },
  { label: 'Chips online', question: 'Quantos chips estão online?', icon: 'data' },
  { label: 'Total contatos', question: 'Quantos contatos tenho?', icon: 'data' },
  { label: 'Conectar chip', question: 'Como conectar um chip WhatsApp?', icon: 'help' },
];

const BY_SCREEN: Record<string, AgentSuggestion[]> = {
  dashboard: [
    { label: 'Campanhas ativas', question: 'Quantas campanhas estão ativas agora?', icon: 'data' },
    { label: 'Chips conectados', question: 'Quantos chips WhatsApp estão conectados?', icon: 'data' },
    { label: 'Top cidades', question: 'Quais cidades têm mais contatos?', icon: 'data' },
    { label: 'Saúde da base', question: 'Quantos contatos têm bairro preenchido?', icon: 'data' },
    { label: 'Meu plano', question: 'Qual o status da minha assinatura?', icon: 'data' },
    { label: 'Ir para campanhas', question: 'Como criar uma campanha?', icon: 'help' },
  ],
  connections: [
    { label: 'Status dos chips', question: 'Quais chips estão conectados e qual a fila de envio?', icon: 'data' },
    { label: 'Envios hoje', question: 'Quantas mensagens foram enviadas hoje pelos chips?', icon: 'data' },
    { label: 'QR Code', question: 'Como escanear o QR Code?', icon: 'help' },
    { label: 'Chip offline', question: 'O que fazer se o chip ficar offline?', icon: 'help' },
  ],
  contacts: [
    { label: 'Importar melhor', question: 'Como organizar contatos antes de importar?', icon: 'help' },
    { label: 'Duplicados', question: 'Como identificar duplicados na importação?', icon: 'help' },
    { label: 'Maiores listas', question: 'Quais são minhas maiores listas de contatos?', icon: 'data' },
    { label: 'Cidade com mais', question: 'Qual cidade tem mais contatos na base?', icon: 'data' },
    { label: 'Importar CSV', question: 'Como importar contatos do Excel?', icon: 'help' },
    { label: 'Listas', question: 'Como criar uma lista de contatos?', icon: 'help' },
  ],
  'contacts-map': [
    { label: 'Blumenau por bairro', question: 'Quantos contatos tenho em Blumenau por bairro?', icon: 'data' },
    { label: 'Bairro Água Verde', question: 'Quantos contatos tenho no bairro Água Verde?', icon: 'data' },
    { label: 'Dados incompletos', question: 'Quantos contatos estão sem bairro ou cidade?', icon: 'data' },
    { label: 'Maior concentração', question: 'Qual bairro tem mais contatos?', icon: 'data' },
  ],
  campaigns: [
    { label: 'Última campanha', question: 'Como está o desempenho da última campanha?', icon: 'data' },
    { label: 'Taxa de resposta', question: 'Qual a taxa de resposta das campanhas recentes?', icon: 'data' },
    { label: 'Campanhas agendadas', question: 'Tenho campanhas agendadas? Quais?', icon: 'data' },
    { label: 'Sugerir mensagem', question: 'Dê dicas para melhorar mensagem de campanha no WhatsApp', icon: 'creative' },
    { label: 'Nova campanha', question: 'Como criar uma campanha passo a passo?', icon: 'help' },
    { label: 'Mensagem cobrança', question: 'Sugira uma mensagem de cobrança', icon: 'creative' },
  ],
  chat: [
    { label: 'Quem escreveu', question: 'Quem me mandou mensagem mais recentemente?', icon: 'data' },
    { label: 'Não lidas', question: 'Liste conversas com mensagens não lidas', icon: 'data' },
    { label: 'Total inbox', question: 'Quantas conversas tenho no bate-papo?', icon: 'data' },
    { label: 'Usar bate-papo', question: 'Para que serve o bate-papo?', icon: 'help' },
    { label: 'Filtros inbox', question: 'Como filtrar conversas no bate-papo?', icon: 'help' },
  ],
  reports: [
    { label: 'Performance', question: 'Resuma o desempenho das minhas campanhas', icon: 'data' },
    { label: 'Contatos por UF', question: 'Como estão distribuídos meus contatos por estado?', icon: 'data' },
    { label: 'Exportar CSV', question: 'Como exportar relatórios em CSV?', icon: 'help' },
    { label: 'Ver números', question: 'O que mostra a aba relatórios?', icon: 'help' },
  ],
  warmup: [
    { label: 'Aquecimento', question: 'O que é aquecimento de chip e quando usar?', icon: 'help' },
    { label: 'Quando usar', question: 'Quando devo usar aquecimento?', icon: 'help' },
  ],
  subscription: [
    { label: 'Meu plano', question: 'Qual o status da minha assinatura?', icon: 'data' },
    { label: 'Renovar', question: 'Como renovar minha assinatura?', icon: 'help' },
  ],
  settings: [
    { label: 'Intervalo envio', question: 'Onde configuro intervalo entre envios?', icon: 'help' },
    { label: 'Tema escuro', question: 'Como mudar o tema claro/escuro?', icon: 'help' },
  ],
  help: [
    { label: 'Primeiros passos', question: 'Por onde começar no ZapMass?', icon: 'help' },
    { label: 'Boas práticas', question: 'Quais boas práticas para não ser bloqueado?', icon: 'help' },
  ],
  'ai-assistant': [
    { label: 'Blumenau bairros', question: 'Quantos contatos tenho em Blumenau por bairro?', icon: 'data' },
    { label: 'Listas', question: 'Quais são minhas listas e quantos contatos cada uma tem?', icon: 'data' },
    { label: 'Campanha ativa', question: 'Há alguma campanha ativa? Como está?', icon: 'data' },
    { label: 'Inbox', question: 'Quantas conversas não lidas tenho agora?', icon: 'data' },
  ],
};

/** Sugestões contextuais por tela + atalhos gerais (sem duplicar). */
export function getAgentSuggestions(screen: string, limit = 8): AgentSuggestion[] {
  const screenItems = BY_SCREEN[screen] ?? BY_SCREEN.dashboard ?? [];
  const seen = new Set<string>();
  const out: AgentSuggestion[] = [];
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
  'contacts-map': 'Mapa',
  reports: 'Relatórios',
  warmup: 'Aquecimento',
  subscription: 'Assinatura',
  settings: 'Configurações',
  help: 'Como usar',
  team: 'Funcionários',
  'ai-assistant': 'Assistente IA',
  'admin-ops': 'Operações servidor',
};
